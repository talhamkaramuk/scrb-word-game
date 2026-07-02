import crypto from "node:crypto";

const TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSessionStore({ ttlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map();

  function createSession({ roomCode, playerId }) {
    const sessionId = crypto.randomUUID();
    const reconnectToken = createToken();
    const createdAt = now();
    const session = {
      sessionId,
      roomCode,
      playerId,
      reconnectTokenHash: hashToken(reconnectToken),
      createdAt,
      expiresAt: createdAt + ttlMs
    };

    sessions.set(sessionId, session);
    return {
      sessionId,
      reconnectToken,
      expiresAt: session.expiresAt
    };
  }

  function verifySession({ sessionId, reconnectToken, roomCode }) {
    const session = typeof sessionId === "string" ? sessions.get(sessionId) : null;
    if (!session) {
      return null;
    }

    if (session.expiresAt <= now()) {
      sessions.delete(session.sessionId);
      return null;
    }

    if (session.roomCode !== roomCode || typeof reconnectToken !== "string") {
      return null;
    }

    if (!timingSafeEqual(session.reconnectTokenHash, hashToken(reconnectToken))) {
      return null;
    }

    return publicSession(session);
  }

  function pruneExpired() {
    const currentTime = now();
    for (const [sessionId, session] of sessions) {
      if (session.expiresAt <= currentTime) {
        sessions.delete(sessionId);
      }
    }
  }

  function deleteRoomSessions(roomCode) {
    for (const [sessionId, session] of sessions) {
      if (session.roomCode === roomCode) {
        sessions.delete(sessionId);
      }
    }
  }

  return {
    createSession,
    verifySession,
    pruneExpired,
    deleteRoomSessions,
    get size() {
      return sessions.size;
    }
  };
}

function publicSession(session) {
  return {
    sessionId: session.sessionId,
    roomCode: session.roomCode,
    playerId: session.playerId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt
  };
}

function createToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("base64url");
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
