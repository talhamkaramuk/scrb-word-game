import crypto from "node:crypto";

export const OPCODES = Object.freeze({
  TEXT: 0x1,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xA
});

export const CLOSE_CODES = Object.freeze({
  NORMAL: 1000,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  TOO_LARGE: 1009
});

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CONTROL_PAYLOAD_BYTES = 125;
const MAX_FRAME_HEADER_BYTES = 14;
const CLIENT_OPCODES = new Set([OPCODES.TEXT, OPCODES.CLOSE, OPCODES.PING, OPCODES.PONG]);

export function validateWebSocketHandshakeHeaders(headers) {
  const version = singleHeaderValue(headers["sec-websocket-version"]);
  if (version !== "13") {
    return {
      ok: false,
      status: 426,
      headers: { "Sec-WebSocket-Version": "13" },
      reason: "Unsupported WebSocket version"
    };
  }

  const key = normalizeWebSocketKey(headers["sec-websocket-key"]);
  if (!key) {
    return {
      ok: false,
      status: 400,
      headers: {},
      reason: "Bad WebSocket key"
    };
  }

  return { ok: true, key };
}

export function createWebSocketAccept(key) {
  return crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

export function maxFrameBufferBytes(maxPayloadBytes) {
  return maxPayloadBytes + MAX_FRAME_HEADER_BYTES;
}

export function parseWebSocketFrames(existingBuffer, chunk, { maxPayloadBytes, maxBufferedBytes } = {}) {
  const payloadLimit = Number(maxPayloadBytes);
  const bufferedLimit = Number(maxBufferedBytes ?? maxFrameBufferBytes(payloadLimit));
  if (!Number.isSafeInteger(payloadLimit) || payloadLimit < 0) {
    throw new TypeError("maxPayloadBytes must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(bufferedLimit) || bufferedLimit < MAX_FRAME_HEADER_BYTES) {
    throw new TypeError("maxBufferedBytes must be at least the maximum frame header size");
  }

  let buffer = Buffer.concat([existingBuffer || Buffer.alloc(0), chunk || Buffer.alloc(0)]);
  const frames = [];

  while (buffer.length >= 2) {
    const first = buffer[0];
    const second = buffer[1];
    const fin = Boolean(first & 0x80);
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (rsv !== 0) {
      return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Reserved WebSocket bits are not supported");
    }
    if (!CLIENT_OPCODES.has(opcode)) {
      return parseError(buffer, CLOSE_CODES.UNSUPPORTED_DATA, "Unsupported frame type");
    }
    if (!fin) {
      return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Fragmented frames are not supported");
    }

    const controlFrame = opcode >= 0x8;
    if (payloadLength === 126) {
      if (buffer.length < offset + 2) {
        return partialResult(frames, buffer, bufferedLimit);
      }
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
      if (payloadLength < 126) {
        return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Non-minimal WebSocket length encoding");
      }
    } else if (payloadLength === 127) {
      if (buffer.length < offset + 8) {
        return partialResult(frames, buffer, bufferedLimit);
      }
      const bigLength = buffer.readBigUInt64BE(offset);
      offset += 8;
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        return parseError(buffer, CLOSE_CODES.TOO_LARGE, "Message too large");
      }
      payloadLength = Number(bigLength);
      if (payloadLength < 65536) {
        return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Non-minimal WebSocket length encoding");
      }
    }

    if (!masked) {
      return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Client frames must be masked");
    }
    if (controlFrame && payloadLength > MAX_CONTROL_PAYLOAD_BYTES) {
      return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Control frame payload is too large");
    }
    if (payloadLength > payloadLimit) {
      return parseError(buffer, CLOSE_CODES.TOO_LARGE, "Message too large");
    }

    const frameLength = offset + 4 + payloadLength;
    if (buffer.length < frameLength) {
      return partialResult(frames, buffer, bufferedLimit);
    }

    const mask = buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
    buffer = buffer.subarray(frameLength);

    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === OPCODES.CLOSE && payload.length === 1) {
      return parseError(buffer, CLOSE_CODES.PROTOCOL_ERROR, "Invalid close frame payload");
    }

    frames.push({ opcode, payload });
  }

  return partialResult(frames, buffer, bufferedLimit);
}

export function encodeWebSocketFrame(payload, opcode = OPCODES.TEXT) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "");
  const length = payloadBuffer.length;
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

  return Buffer.concat([header, payloadBuffer]);
}

export function encodeWebSocketClosePayload(code, reason = "") {
  const reasonBuffer = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  return payload;
}

function partialResult(frames, buffer, bufferedLimit) {
  if (buffer.length > bufferedLimit) {
    return parseError(buffer, CLOSE_CODES.TOO_LARGE, "Buffered frame is too large");
  }
  return { frames, remainingBuffer: buffer, error: null };
}

function parseError(buffer, code, reason) {
  return {
    frames: [],
    remainingBuffer: buffer,
    error: { code, reason }
  };
}

function normalizeWebSocketKey(value) {
  const raw = singleHeaderValue(value);
  if (!raw) {
    return null;
  }

  const key = raw.trim();
  if (key.includes(",") || key.length !== 24) {
    return null;
  }

  let decoded;
  try {
    decoded = Buffer.from(key, "base64");
  } catch {
    return null;
  }

  if (decoded.length !== 16 || decoded.toString("base64") !== key) {
    return null;
  }
  return key;
}

function singleHeaderValue(value) {
  return typeof value === "string" ? value : null;
}
