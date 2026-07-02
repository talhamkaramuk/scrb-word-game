import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLOSE_CODES, OPCODES } from "../server/websocket-protocol.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_TIMEOUT_MS = 5_000;
let serverContext;

before(async () => {
  serverContext = await startTestServer();
});

after(async () => {
  await stopTestServer(serverContext);
});

test("HTTP rejects malformed paths and serves static files with security headers", async () => {
  const malformed = await httpRequest("/%E0%A4%A");
  assert.equal(malformed.statusCode, 400);

  const traversal = await httpRequest("/..%2Fserver%2Findex.js");
  assert.equal(traversal.statusCode, 404);

  const method = await httpRequest("/", { method: "POST" });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET, HEAD");

  const index = await httpRequest("/");
  assert.equal(index.statusCode, 200);
  assert.match(index.headers["content-type"], /^text\/html/);
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  assert.match(index.headers["content-security-policy"], /default-src 'self'/);

  const css = await httpRequest("/styles.css");
  assert.equal(css.statusCode, 200);
  assert.match(css.headers["content-type"], /^text\/css/);
});

test("WebSocket handshake rejects invalid version and key", async () => {
  const badVersion = await rawUpgradeResponse({ version: "12" });
  assert.match(badVersion, /^HTTP\/1\.1 426 Upgrade Required/);
  assert.match(badVersion, /Sec-WebSocket-Version: 13/);

  const badKey = await rawUpgradeResponse({ key: "not-a-valid-key" });
  assert.match(badKey, /^HTTP\/1\.1 400 Bad Request/);
});

test("WebSocket closes malformed and oversized frames before game handling", async () => {
  const unmasked = await RawWsClient.connect(serverContext.port);
  unmasked.sendRaw(Buffer.from([0x81, 0x00]));
  const protocolClose = await unmasked.readFrame();
  assert.equal(protocolClose.opcode, OPCODES.CLOSE);
  assert.equal(protocolClose.closeCode, CLOSE_CODES.PROTOCOL_ERROR);
  unmasked.destroy();

  const oversized = await RawWsClient.connect(serverContext.port);
  oversized.sendRaw(Buffer.from([0x81, 0x80 | 126, 0x40, 0x01]));
  const sizeClose = await oversized.readFrame();
  assert.equal(sizeClose.opcode, OPCODES.CLOSE);
  assert.equal(sizeClose.closeCode, CLOSE_CODES.TOO_LARGE);
  oversized.destroy();
});

test("WebSocket rate limit is visible as a structured error", async () => {
  const client = await RawWsClient.connect(serverContext.port);
  for (let index = 0; index < 45; index += 1) {
    client.sendJson({ type: "noop" });
  }

  const message = await client.readJsonMessage((candidate) => candidate.code === "rate_limited");
  assert.equal(message.type, "error");
  assert.equal(message.code, "rate_limited");
  client.destroy();
});

test("WebSocket reconnect keeps the same public player identity", async () => {
  const first = await RawWsClient.connect(serverContext.port);
  first.sendJson({ type: "join", name: "Ada", roomCode: "" });
  const joined = await first.readJsonMessage((message) => message.type === "joined");
  const firstState = await first.readJsonMessage((message) => message.type === "state");
  const publicPlayerId = firstState.state.me.id;
  first.destroy();

  const second = await RawWsClient.connect(serverContext.port);
  second.sendJson({
    type: "join",
    name: "Ada Yeni",
    roomCode: joined.roomCode,
    sessionId: joined.sessionId,
    reconnectToken: joined.reconnectToken
  });

  await second.readJsonMessage((message) => message.type === "joined");
  const secondState = await second.readJsonMessage((message) => message.type === "state");
  assert.equal(secondState.state.me.id, publicPlayerId);
  assert.equal(secondState.state.me.name, "Ada Yeni");
  assert.equal(secondState.state.players.length, 1);
  second.destroy();
});

test("room join flow enforces maximum players over WebSocket", async () => {
  const isolatedServer = await startTestServer();
  const clients = [];
  try {
    const host = await RawWsClient.connect(isolatedServer.port);
    clients.push(host);
    host.sendJson({ type: "join", name: "P1", roomCode: "" });
    const joined = await host.readJsonMessage((message) => message.type === "joined");
    await host.readJsonMessage((message) => message.type === "state");

    for (let index = 2; index <= 10; index += 1) {
      const client = await RawWsClient.connect(isolatedServer.port);
      clients.push(client);
      client.sendJson({ type: "join", name: `P${index}`, roomCode: joined.roomCode });
      await client.readJsonMessage((message) => message.type === "joined");
    }

    const extra = await RawWsClient.connect(isolatedServer.port);
    clients.push(extra);
    extra.sendJson({ type: "join", name: "P11", roomCode: joined.roomCode });
    const error = await extra.readJsonMessage((message) => message.type === "error");
    assert.equal(error.code, "room_full");
  } finally {
    for (const client of clients) {
      client.destroy();
    }
    await stopTestServer(isolatedServer);
  }
});

async function startTestServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  await waitForHealth(port, child, () => output);
  return { child, port, output: () => output };
}

async function stopTestServer(context) {
  if (!context?.child || context.child.exitCode !== null) {
    return;
  }

  context.child.kill();
  await Promise.race([once(context.child, "exit"), timeout(1_000).catch(() => null)]);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < TEST_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early:\n${output()}`);
    }

    try {
      const response = await httpRequest("/health", { port });
      if (response.statusCode === 200) {
        return;
      }
    } catch {
      await timeout(50);
    }
  }
  throw new Error(`Test server did not start:\n${output()}`);
}

function httpRequest(requestPath, { method = "GET", port = serverContext.port } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

function rawUpgradeResponse({ key = validWebSocketKey(), version = "13", requestPath = "/ws", port = serverContext.port } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1");
    const chunks = [];
    socket.setTimeout(TEST_TIMEOUT_MS);
    socket.on("connect", () => {
      socket.write(webSocketUpgradeRequest({ key, version, requestPath, port }));
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out waiting for raw upgrade response"));
    });
    socket.on("error", reject);
  });
}

class RawWsClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.pumpWaiters();
    });
    socket.on("close", () => this.rejectWaiters(new Error("Socket closed")));
    socket.on("error", (error) => this.rejectWaiters(error));
  }

  static async connect(port) {
    const socket = net.createConnection(port, "127.0.0.1");
    const client = new RawWsClient(socket);
    await once(socket, "connect");
    socket.write(webSocketUpgradeRequest({ key: validWebSocketKey(), version: "13", port }));
    await client.waitFor((buffer) => buffer.includes(Buffer.from("\r\n\r\n")));

    const headerEnd = client.buffer.indexOf("\r\n\r\n");
    const response = client.buffer.subarray(0, headerEnd).toString("utf8");
    client.buffer = client.buffer.subarray(headerEnd + 4);
    assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
    return client;
  }

  sendRaw(buffer) {
    this.socket.write(buffer);
  }

  sendJson(payload) {
    this.socket.write(maskedClientFrame(Buffer.from(JSON.stringify(payload), "utf8")));
  }

  async readJsonMessage(predicate) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < TEST_TIMEOUT_MS) {
      const frame = await this.readFrame();
      if (frame.opcode !== OPCODES.TEXT) {
        continue;
      }
      const message = JSON.parse(frame.payload.toString("utf8"));
      if (predicate(message)) {
        return message;
      }
    }
    throw new Error("Timed out waiting for matching JSON message");
  }

  async readFrame() {
    await this.waitFor((buffer) => buffer.length >= 2);
    const second = this.buffer[1];
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      await this.waitFor((buffer) => buffer.length >= 4);
      payloadLength = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      await this.waitFor((buffer) => buffer.length >= 10);
      payloadLength = Number(this.buffer.readBigUInt64BE(2));
      offset = 10;
    }

    await this.waitFor((buffer) => buffer.length >= offset + payloadLength);
    const first = this.buffer[0];
    const opcode = first & 0x0f;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLength));
    this.buffer = this.buffer.subarray(offset + payloadLength);
    const closeCode = opcode === OPCODES.CLOSE && payload.length >= 2 ? payload.readUInt16BE(0) : null;
    return { opcode, payload, closeCode };
  }

  waitFor(predicate) {
    if (predicate(this.buffer)) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
          reject(new Error("Timed out waiting for socket data"));
        }, TEST_TIMEOUT_MS)
      };
      this.waiters.push(waiter);
    });
  }

  pumpWaiters() {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(this.buffer)) {
        continue;
      }
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
      waiter.resolve();
    }
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  destroy() {
    this.socket.destroy();
  }
}

function webSocketUpgradeRequest({ key, version, requestPath = "/ws", port = serverContext.port }) {
  return [
    `GET ${requestPath} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    `Sec-WebSocket-Version: ${version}`,
    "\r\n"
  ].join("\r\n");
}

function validWebSocketKey() {
  return crypto.randomBytes(16).toString("base64");
}

function maskedClientFrame(payload, { opcode = OPCODES.TEXT, mask = Buffer.from([1, 2, 3, 4]) } = {}) {
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
