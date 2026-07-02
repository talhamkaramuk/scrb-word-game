import assert from "node:assert/strict";
import test from "node:test";
import { createSessionStore } from "../server/sessions.js";

test("session store verifies only matching reconnect credentials", () => {
  let now = 1_000;
  const sessions = createSessionStore({ ttlMs: 60_000, now: () => now });
  const issued = sessions.createSession({ roomCode: "ROOM1", playerId: "internal-player-1" });

  const verified = sessions.verifySession({
    sessionId: issued.sessionId,
    reconnectToken: issued.reconnectToken,
    roomCode: "ROOM1"
  });

  assert.equal(verified.playerId, "internal-player-1");
  assert.equal(sessions.verifySession({ sessionId: issued.sessionId, reconnectToken: "wrong", roomCode: "ROOM1" }), null);
  assert.equal(
    sessions.verifySession({ sessionId: issued.sessionId, reconnectToken: issued.reconnectToken, roomCode: "OTHER" }),
    null
  );

  now = issued.expiresAt + 1;
  assert.equal(
    sessions.verifySession({ sessionId: issued.sessionId, reconnectToken: issued.reconnectToken, roomCode: "ROOM1" }),
    null
  );
});

test("session store prunes room sessions", () => {
  const sessions = createSessionStore();
  sessions.createSession({ roomCode: "ROOM1", playerId: "p1" });
  sessions.createSession({ roomCode: "ROOM1", playerId: "p2" });
  sessions.createSession({ roomCode: "ROOM2", playerId: "p3" });

  sessions.deleteRoomSessions("ROOM1");

  assert.equal(sessions.size, 1);
});
