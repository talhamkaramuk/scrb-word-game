import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameRuleError,
  addPlayer,
  applyMove,
  createGame,
  exchangeTiles,
  expireTurnIfNeeded,
  passTurn,
  serializeGame,
  setGameSettings,
  setPlayerConnection,
  startGame
} from "../src/shared/game-core.js";
import { loadDictionaryFile } from "./dictionary.js";
import {
  clientIpFromRequest,
  connectionLimitStatus,
  createWindowedActionLimiter,
  shouldPruneRoom
} from "./lifecycle-limits.js";
import { createSessionStore } from "./sessions.js";
import { resolveStaticPath } from "./static-paths.js";
import {
  CLOSE_CODES,
  OPCODES,
  createWebSocketAccept,
  encodeWebSocketClosePayload,
  encodeWebSocketFrame,
  parseWebSocketFrames,
  validateWebSocketHandshakeHeaders
} from "./websocket-protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SHARED_DIR = path.join(ROOT, "src", "shared");
const DATA_DIR = path.join(ROOT, "data");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const STRICT_DICTIONARY = process.env.STRICT_DICTIONARY !== "0";
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MESSAGES_PER_WINDOW = 40;
const RATE_WINDOW_MS = 1000;
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
const WAITING_ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_ACTIVE_ROOMS = 50;
const MAX_CONNECTIONS_PER_IP = 12;
const MAX_CONNECTIONS_PER_SUBNET = 40;
const MAX_ROOM_CREATES_PER_IP = 6;
const ROOM_CREATE_WINDOW_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const rooms = new Map();
const connections = new Set();
const sessionStore = createSessionStore();
const roomCreateLimiter = createWindowedActionLimiter({
  limit: MAX_ROOM_CREATES_PER_IP,
  windowMs: ROOM_CREATE_WINDOW_MS
});
const dictionary = loadDictionaryFile(path.join(DATA_DIR, "dictionary.tr.txt"));

if (STRICT_DICTIONARY && dictionary.words.size === 0) {
  console.error("Strict dictionary mode is enabled, but data/dictionary.tr.txt is empty or missing.");
  process.exit(1);
}

for (const warning of dictionary.warnings.slice(0, 5)) {
  console.warn(warning);
}
if (dictionary.warnings.length > 5) {
  console.warn(`Dictionary has ${dictionary.warnings.length - 5} more warnings.`);
}

const server = http.createServer(handleHttpRequest);
server.on("upgrade", handleUpgrade);

server.listen(PORT, HOST, () => {
  console.log(`Kelime Meydanı running at http://localhost:${PORT}`);
  console.log(`LAN clients can use http://<this-computer-ip>:${PORT}`);
  console.log(
    `Dictionary mode: ${STRICT_DICTIONARY ? "strict" : "open"} (${dictionary.words.size} playable words, ${dictionary.stats.rejected} rejected metadata entries)`
  );
});

setInterval(() => {
  for (const connection of connections) {
    if (!connection.alive) {
      closeConnection(connection, 1001, "Heartbeat timeout");
      continue;
    }
    connection.alive = false;
    sendFrame(connection, Buffer.alloc(0), 0x9);
  }
}, HEARTBEAT_MS).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    if (expireTurnIfNeeded(room)) {
      broadcastRoom(room);
    }
  }
}, 500).unref();

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const hasConnections = [...connections].some((connection) => connection.roomCode === code);
    if (
      shouldPruneRoom(room, {
        hasConnections,
        now,
        idleRoomMs: ROOM_IDLE_MS,
        waitingRoomIdleMs: WAITING_ROOM_IDLE_MS
      })
    ) {
      rooms.delete(code);
      sessionStore.deleteRoomSessions(code);
    }
  }
  sessionStore.pruneExpired();
  roomCreateLimiter.prune();
}, 10 * 60 * 1000).unref();

function handleHttpRequest(req, res) {
  const url = safeUrl(req);
  if (!url) {
    sendText(res, 400, "Bad request");
    return;
  }

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      connections: connections.size,
      sessions: sessionStore.size,
      dictionaryMode: STRICT_DICTIONARY ? "strict" : "open",
      dictionaryCount: dictionary.words.size,
      dictionaryStats: dictionary.stats
    });
    return;
  }

  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    res.end("Method not allowed");
    return;
  }

  const route = resolveStaticPath(url.pathname, {
    publicDir: PUBLIC_DIR,
    sharedDir: SHARED_DIR
  });
  if (route.status !== 200) {
    sendText(res, route.status, route.status === 400 ? "Bad request" : "Not found");
    return;
  }

  fs.stat(route.filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, securityHeaders(route.filePath));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(route.filePath).pipe(res);
  });
}

function handleUpgrade(req, socket) {
  const url = safeUrl(req);
  if (!url || url.pathname !== "/ws") {
    rejectSocketUpgrade(socket, 404);
    return;
  }

  if (!isAllowedWebSocketOrigin(req)) {
    rejectSocketUpgrade(socket, 403);
    return;
  }

  const handshake = validateWebSocketHandshakeHeaders(req.headers);
  if (!handshake.ok) {
    rejectSocketUpgrade(socket, handshake.status, handshake.headers);
    return;
  }

  const clientIp = clientIpFromRequest(req);
  const connectionLimit = connectionLimitStatus(connections, clientIp, {
    maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
    maxConnectionsPerSubnet: MAX_CONNECTIONS_PER_SUBNET
  });
  if (!connectionLimit.allowed) {
    rejectSocketUpgrade(socket, 429);
    return;
  }

  const accept = createWebSocketAccept(handshake.key);
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  const connection = {
    id: crypto.randomUUID(),
    socket,
    buffer: Buffer.alloc(0),
    alive: true,
    roomCode: null,
    playerId: null,
    clientIp,
    clientSubnet: connectionLimit.clientSubnet,
    messageWindowStart: Date.now(),
    messageCount: 0
  };

  socket.setNoDelay(true);
  connections.add(connection);

  socket.on("data", (chunk) => handleSocketData(connection, chunk));
  socket.on("close", () => detachConnection(connection));
  socket.on("error", () => detachConnection(connection));
}

function rejectSocketUpgrade(socket, status, headers = {}) {
  const statusText = {
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    426: "Upgrade Required",
    429: "Too Many Requests"
  }[status] || "Error";
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  socket.write([`HTTP/1.1 ${status} ${statusText}`, ...headerLines, "\r\n"].join("\r\n"));
  socket.destroy();
}

function handleSocketData(connection, chunk) {
  const parsed = parseWebSocketFrames(connection.buffer, chunk, {
    maxPayloadBytes: MAX_MESSAGE_BYTES
  });
  connection.buffer = parsed.remainingBuffer;

  if (parsed.error) {
    closeConnection(connection, parsed.error.code, parsed.error.reason);
    return;
  }

  for (const frame of parsed.frames) {
    if (frame.opcode === OPCODES.CLOSE) {
      closeConnection(connection, CLOSE_CODES.NORMAL, "Closed");
      return;
    }
    if (frame.opcode === OPCODES.PING) {
      sendFrame(connection, frame.payload, OPCODES.PONG);
      continue;
    }
    if (frame.opcode === OPCODES.PONG) {
      connection.alive = true;
      continue;
    }

    handleClientMessage(connection, frame.payload.toString("utf8"));
  }
}

function handleClientMessage(connection, rawMessage) {
  if (!checkRateLimit(connection)) {
    sendError(connection, "Çok hızlı mesaj gönderildi; lütfen yavaşla.", "rate_limited");
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    sendError(connection, "Geçersiz mesaj formatı.");
    return;
  }

  try {
    switch (message.type) {
      case "join":
        handleJoin(connection, message);
        break;
      case "settings":
        handleSettings(connection, message);
        break;
      case "start":
        handleStart(connection);
        break;
      case "move":
        handleMove(connection, message);
        break;
      case "pass":
        handlePass(connection);
        break;
      case "exchange":
        handleExchange(connection, message);
        break;
      default:
        sendError(connection, "Bilinmeyen komut.");
        break;
    }
  } catch (error) {
    if (error instanceof GameRuleError) {
      sendError(connection, error.message, error.code);
      return;
    }
    console.error(error);
    sendError(connection, "Sunucu hamleyi işleyemedi.");
  }
}

function handleJoin(connection, message) {
  const code = normalizeRoomCode(message.roomCode) || createRoomCode();
  let room = rooms.get(code);

  if (!room) {
    if (rooms.size >= MAX_ACTIVE_ROOMS) {
      throw new GameRuleError("room_limit", "Sunucu aktif oda sınırına ulaştı; lütfen biraz sonra tekrar dene.");
    }
    if (!roomCreateLimiter.allow(connection.clientIp)) {
      throw new GameRuleError("room_create_limited", "Çok hızlı oda oluşturuldu; lütfen biraz sonra tekrar dene.");
    }
    room = createGame({
      code,
      dictionary: dictionary.words,
      strictDictionary: STRICT_DICTIONARY
    });
    rooms.set(code, room);
  }

  const reconnectSession = sessionStore.verifySession({
    sessionId: message.sessionId,
    reconnectToken: message.reconnectToken,
    roomCode: code
  });
  const playerId = reconnectSession?.playerId || crypto.randomUUID();

  if (connection.roomCode && connection.playerId) {
    detachConnection(connection);
  }

  const player = addPlayer(room, {
    id: playerId,
    name: message.name,
    connected: true
  });
  const issuedSession = reconnectSession
    ? null
    : sessionStore.createSession({
        roomCode: code,
        playerId: player.id
      });

  connection.roomCode = code;
  connection.playerId = player.id;
  sendJsonFrame(connection, {
    type: "joined",
    roomCode: code,
    sessionId: reconnectSession?.sessionId || issuedSession.sessionId,
    reconnectToken: issuedSession?.reconnectToken,
    sessionExpiresAt: reconnectSession?.expiresAt || issuedSession.expiresAt
  });
  broadcastRoom(room);
}

function handleSettings(connection, message) {
  const room = requireConnectionRoom(connection);
  setGameSettings(room, connection.playerId, {
    gameMode: message.gameMode,
    turnSeconds: message.turnSeconds
  });
  broadcastRoom(room);
}

function handleStart(connection) {
  const room = requireConnectionRoom(connection);
  startGame(room, connection.playerId);
  broadcastRoom(room);
}

function handleMove(connection, message) {
  const room = requireConnectionRoom(connection);
  if (expireTurnIfNeeded(room)) {
    broadcastRoom(room);
    if (room.status !== "playing") {
      return;
    }
  }
  applyMove(room, connection.playerId, message.placements);
  broadcastRoom(room);
}

function handlePass(connection) {
  const room = requireConnectionRoom(connection);
  if (expireTurnIfNeeded(room)) {
    broadcastRoom(room);
    if (room.status !== "playing") {
      return;
    }
  }
  passTurn(room, connection.playerId);
  broadcastRoom(room);
}

function handleExchange(connection, message) {
  const room = requireConnectionRoom(connection);
  if (expireTurnIfNeeded(room)) {
    broadcastRoom(room);
    if (room.status !== "playing") {
      return;
    }
  }
  exchangeTiles(room, connection.playerId, Array.isArray(message.tileIds) ? message.tileIds : []);
  broadcastRoom(room);
}

function requireConnectionRoom(connection) {
  if (!connection.roomCode || !connection.playerId) {
    throw new GameRuleError("not_joined", "Önce bir odaya katılmalısın.");
  }
  const room = rooms.get(connection.roomCode);
  if (!room) {
    throw new GameRuleError("room_missing", "Oda bulunamadı.");
  }
  return room;
}

function broadcastRoom(room) {
  for (const connection of connections) {
    if (connection.roomCode === room.code) {
      sendJsonFrame(connection, {
        type: "state",
        state: serializeGame(room, connection.playerId)
      });
    }
  }
}

function detachConnection(connection) {
  const roomCode = connection.roomCode;
  const playerId = connection.playerId;
  const wasPresent = connections.delete(connection);
  if (!wasPresent) {
    return;
  }

  if (roomCode && playerId) {
    const hasAnotherConnection = [...connections].some(
      (candidate) => candidate.roomCode === roomCode && candidate.playerId === playerId
    );
    const room = rooms.get(roomCode);
    if (!hasAnotherConnection && room && setPlayerConnection(room, playerId, false)) {
      broadcastRoom(room);
    }
  }
}

function checkRateLimit(connection) {
  const now = Date.now();
  if (now - connection.messageWindowStart > RATE_WINDOW_MS) {
    connection.messageWindowStart = now;
    connection.messageCount = 0;
  }
  connection.messageCount += 1;
  return connection.messageCount <= MAX_MESSAGES_PER_WINDOW;
}

function sendJsonFrame(connection, payload) {
  sendFrame(connection, Buffer.from(JSON.stringify(payload), "utf8"), 0x1);
}

function sendError(connection, message, code = "bad_request") {
  sendJsonFrame(connection, {
    type: "error",
    code,
    message
  });
}

function sendFrame(connection, payload, opcode = OPCODES.TEXT) {
  if (connection.socket.destroyed) {
    return;
  }

  connection.socket.write(encodeWebSocketFrame(payload, opcode));
}

function closeConnection(connection, code, reason) {
  if (!connection.socket.destroyed) {
    sendFrame(connection, encodeWebSocketClosePayload(code, reason), OPCODES.CLOSE);
    connection.socket.end();
  }
  detachConnection(connection);
}

function safeUrl(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  } catch {
    return null;
  }
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

function securityHeaders(filePath) {
  return {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; form-action 'self'"
  };
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(text);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function normalizeRoomCode(value) {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
