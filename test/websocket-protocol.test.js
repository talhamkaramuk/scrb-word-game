import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSE_CODES,
  OPCODES,
  createWebSocketAccept,
  encodeWebSocketFrame,
  maxFrameBufferBytes,
  parseWebSocketFrames,
  validateWebSocketHandshakeHeaders
} from "../server/websocket-protocol.js";

test("validates WebSocket version and key format", () => {
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  assert.deepEqual(
    validateWebSocketHandshakeHeaders({
      "sec-websocket-version": "13",
      "sec-websocket-key": key
    }),
    { ok: true, key }
  );
  assert.equal(createWebSocketAccept(key), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");

  assert.equal(
    validateWebSocketHandshakeHeaders({
      "sec-websocket-version": "12",
      "sec-websocket-key": key
    }).status,
    426
  );
  assert.equal(
    validateWebSocketHandshakeHeaders({
      "sec-websocket-version": "13",
      "sec-websocket-key": "not-a-valid-key"
    }).status,
    400
  );
});

test("parses masked text frames across chunks", () => {
  const frame = maskedClientFrame(Buffer.from('{"type":"ping"}'));
  const first = parseWebSocketFrames(Buffer.alloc(0), frame.subarray(0, 3), { maxPayloadBytes: 1024 });
  assert.equal(first.error, null);
  assert.equal(first.frames.length, 0);

  const second = parseWebSocketFrames(first.remainingBuffer, frame.subarray(3), { maxPayloadBytes: 1024 });
  assert.equal(second.error, null);
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0].opcode, OPCODES.TEXT);
  assert.equal(second.frames[0].payload.toString("utf8"), '{"type":"ping"}');
  assert.equal(second.remainingBuffer.length, 0);
});

test("rejects malformed client frames before game message handling", () => {
  assert.equal(parseWebSocketFrames(Buffer.alloc(0), Buffer.from([0x81, 0x00]), { maxPayloadBytes: 1024 }).error.code, 1002);
  assert.equal(
    parseWebSocketFrames(Buffer.alloc(0), maskedClientFrame(Buffer.from("{}"), { rsv: 0x40 }), {
      maxPayloadBytes: 1024
    }).error.code,
    1002
  );
  assert.equal(
    parseWebSocketFrames(Buffer.alloc(0), Buffer.from([0x89, 0x80 | 126, 0x00, 0x7e]), {
      maxPayloadBytes: 1024
    }).error.code,
    1002
  );
});

test("rejects oversized payload headers and bounded partial buffers", () => {
  const oversizedHeader = Buffer.from([0x81, 0x80 | 126, 0x40, 0x01]);
  assert.equal(
    parseWebSocketFrames(Buffer.alloc(0), oversizedHeader, { maxPayloadBytes: 16 * 1024 }).error.code,
    CLOSE_CODES.TOO_LARGE
  );

  const incompleteFrame = Buffer.concat([
    Buffer.from([0x81, 0x80 | 126, 0x04, 0x00]),
    Buffer.from([1, 2, 3, 4]),
    Buffer.alloc(8)
  ]);
  const bounded = parseWebSocketFrames(Buffer.alloc(0), incompleteFrame, {
    maxPayloadBytes: 1024,
    maxBufferedBytes: 14
  });
  assert.equal(bounded.error.code, CLOSE_CODES.TOO_LARGE);
  assert.equal(maxFrameBufferBytes(1024), 1038);
});

test("encodes server frames without client masking", () => {
  const frame = encodeWebSocketFrame(Buffer.from("ok"), OPCODES.TEXT);
  assert.equal(frame[0], 0x80 | OPCODES.TEXT);
  assert.equal(frame[1], 2);
  assert.equal(frame.subarray(2).toString("utf8"), "ok");
});

function maskedClientFrame(payload, { opcode = OPCODES.TEXT, rsv = 0, mask = Buffer.from([1, 2, 3, 4]) } = {}) {
  const first = 0x80 | rsv | opcode;
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([first, 0x80 | length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}
