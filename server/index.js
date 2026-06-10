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
  normalizeWord,
  passTurn,
  serializeGame,
  setGameSettings,
  setPlayerConnection,
  setReady,
  startGame
} from "../src/shared/game-core.js";

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
const HEARTBEAT_MS = 30 * 1000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const rooms = new Map();
const connections = new Set();
const dictionary = loadDictionary();

if (STRICT_DICTIONARY && dictionary.size === 0) {
  console.error("Strict dictionary mode is enabled, but data/dictionary.tr.txt is empty or missing.");
  process.exit(1);
}

const server = http.createServer(handleHttpRequest);
server.on("upgrade", handleUpgrade);

server.listen(PORT, HOST, () => {
  console.log(`Kelime Meydanı running at http://localhost:${PORT}`);
  console.log(`LAN clients can use http://<this-computer-ip>:${PORT}`);
  console.log(`Dictionary mode: ${STRICT_DICTIONARY ? "strict" : "open"} (${dictionary.size} words)`);
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
    if (!hasConnections && now - room.updatedAt > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
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
      dictionaryMode: STRICT_DICTIONARY ? "strict" : "open",
      dictionaryCount: dictionary.size
    });
    return;
  }

  const route = resolveStaticPath(url.pathname);
  if (!route) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(route.filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, securityHeaders(route.filePath));
    fs.createReadStream(route.filePath).pipe(res);
  });
}

function handleUpgrade(req, socket) {
  const url = safeUrl(req);
  if (!url || url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!isAllowedWebSocketOrigin(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
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
    messageWindowStart: Date.now(),
    messageCount: 0
  };

  socket.setNoDelay(true);
  connections.add(connection);

  socket.on("data", (chunk) => handleSocketData(connection, chunk));
  socket.on("close", () => detachConnection(connection));
  socket.on("error", () => detachConnection(connection));
}

function handleSocketData(connection, chunk) {
  connection.buffer = Buffer.concat([connection.buffer, chunk]);

  while (connection.buffer.length >= 2) {
    const first = connection.buffer[0];
    const second = connection.buffer[1];
    const fin = Boolean(first & 0x80);
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (!fin) {
      closeConnection(connection, 1003, "Fragmented frames are not supported");
      return;
    }

    if (payloadLength === 126) {
      if (connection.buffer.length < offset + 2) {
        return;
      }
      payloadLength = connection.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (connection.buffer.length < offset + 8) {
        return;
      }
      const bigLength = connection.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(MAX_MESSAGE_BYTES)) {
        closeConnection(connection, 1009, "Message too large");
        return;
      }
      payloadLength = Number(bigLength);
      offset += 8;
    }

    if (!masked) {
      closeConnection(connection, 1002, "Client frames must be masked");
      return;
    }

    if (payloadLength > MAX_MESSAGE_BYTES) {
      closeConnection(connection, 1009, "Message too large");
      return;
    }

    if (connection.buffer.length < offset + 4 + payloadLength) {
      return;
    }

    const mask = connection.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(connection.buffer.subarray(offset, offset + payloadLength));
    connection.buffer = connection.buffer.subarray(offset + payloadLength);

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      closeConnection(connection, 1000, "Closed");
      return;
    }
    if (opcode === 0x9) {
      sendFrame(connection, payload, 0xA);
      continue;
    }
    if (opcode === 0xA) {
      connection.alive = true;
      continue;
    }
    if (opcode !== 0x1) {
      closeConnection(connection, 1003, "Unsupported frame type");
      return;
    }

    handleClientMessage(connection, payload.toString("utf8"));
  }
}

function handleClientMessage(connection, rawMessage) {
  if (!checkRateLimit(connection)) {
    sendError(connection, "Çok hızlı mesaj gönderildi; lütfen yavaşla.");
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
      case "ready":
        handleReady(connection, message);
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
  const playerId = typeof message.playerId === "string" && message.playerId.length <= 80 ? message.playerId : crypto.randomUUID();
  let room = rooms.get(code);

  if (!room) {
    room = createGame({
      code,
      dictionary,
      strictDictionary: STRICT_DICTIONARY
    });
    rooms.set(code, room);
  }

  if (connection.roomCode && connection.playerId) {
    detachConnection(connection);
  }

  const player = addPlayer(room, {
    id: playerId,
    name: message.name,
    connected: true
  });

  connection.roomCode = code;
  connection.playerId = player.id;
  sendJsonFrame(connection, {
    type: "joined",
    roomCode: code,
    playerId: player.id
  });
  broadcastRoom(room);
}

function handleReady(connection, message) {
  const room = requireConnectionRoom(connection);
  setReady(room, connection.playerId, message.ready !== false);
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
  const wasPresent = connections.delete(connection);
  if (!wasPresent) {
    return;
  }

  if (connection.roomCode && connection.playerId) {
    const room = rooms.get(connection.roomCode);
    if (room && setPlayerConnection(room, connection.playerId, false)) {
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

function sendFrame(connection, payload, opcode = 0x1) {
  if (connection.socket.destroyed) {
    return;
  }

  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  connection.socket.write(Buffer.concat([header, payload]));
}

function closeConnection(connection, code, reason) {
  if (!connection.socket.destroyed) {
    const reasonBuffer = Buffer.from(reason || "", "utf8");
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    sendFrame(connection, payload, 0x8);
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

function resolveStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  if (decodedPath.startsWith("/shared/")) {
    return resolveFromRoot(SHARED_DIR, decodedPath.slice("/shared/".length));
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  return resolveFromRoot(PUBLIC_DIR, relativePath);
}

function resolveFromRoot(root, relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.resolve(root, normalized);
  if (!filePath.startsWith(root)) {
    return null;
  }
  return { filePath };
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

function loadDictionary() {
  const dictionaryPath = path.join(DATA_DIR, "dictionary.tr.txt");
  try {
    const contents = fs.readFileSync(dictionaryPath, "utf8");
    return new Set(
      contents
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*/, "").trim())
        .filter(Boolean)
        .map(normalizeWord)
        .filter(Boolean)
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Dictionary could not be loaded: ${error.message}`);
    }
    return new Set();
  }
}
