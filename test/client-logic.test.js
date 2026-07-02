import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanRoomCode,
  createJoinRequest,
  normalizeBlankTileInput,
  shouldAutoJoinAfterReconnect,
  timerDisplayState
} from "../src/shared/client-logic.js";

test("create-room request clears previous room and reconnect credentials", () => {
  const join = createJoinRequest({
    name: " Ada ",
    roomCode: "OLD99",
    sessionId: "session-1",
    reconnectToken: "token-1",
    createNewRoom: true
  });

  assert.equal(join.playerName, "Ada");
  assert.equal(join.roomCode, "");
  assert.equal(join.isNewRoomRequest, true);
  assert.equal(join.shouldClearStoredSession, true);
  assert.deepEqual(join.message, {
    type: "join",
    name: "Ada",
    roomCode: "",
    sessionId: undefined,
    reconnectToken: undefined
  });
});

test("join existing room preserves reconnect credentials", () => {
  const join = createJoinRequest({
    name: "Ada",
    roomCode: " ab-12 ",
    sessionId: "session-1",
    reconnectToken: "token-1"
  });

  assert.equal(cleanRoomCode(" ab-12 "), "AB12");
  assert.equal(join.roomCode, "AB12");
  assert.equal(join.isNewRoomRequest, false);
  assert.equal(join.shouldClearStoredSession, false);
  assert.equal(join.message.sessionId, "session-1");
  assert.equal(join.message.reconnectToken, "token-1");
});

test("reconnect auto-join requires a complete stored session", () => {
  assert.equal(
    shouldAutoJoinAfterReconnect({
      sessionId: "s",
      reconnectToken: "t",
      roomCode: "ROOM1",
      playerName: "Ada"
    }),
    true
  );
  assert.equal(
    shouldAutoJoinAfterReconnect({
      sessionId: "s",
      reconnectToken: "",
      roomCode: "ROOM1",
      playerName: "Ada"
    }),
    false
  );
});

test("blank tile input accepts Turkish letters and rejects symbols", () => {
  assert.equal(normalizeBlankTileInput("i"), "İ");
  assert.equal(normalizeBlankTileInput("ı"), "I");
  assert.equal(normalizeBlankTileInput("ç"), "Ç");
  assert.equal(normalizeBlankTileInput("?"), "");
  assert.equal(normalizeBlankTileInput("-"), "");
});

test("timer display handles normal, urgent, and AFK countdown states", () => {
  assert.deepEqual(timerDisplayState(null, 1000), { text: "Süre: --", danger: false });
  assert.deepEqual(
    timerDisplayState({ status: "playing", turnRemainingMs: 20_000, currentPlayerAfkRemainingMs: null, receivedAt: 1_000 }, 5_000),
    { text: "Süre: 16s", danger: false }
  );
  assert.deepEqual(
    timerDisplayState({ status: "playing", turnRemainingMs: 11_000, currentPlayerAfkRemainingMs: null, receivedAt: 1_000 }, 2_000),
    { text: "Süre: 10s", danger: true }
  );
  assert.deepEqual(
    timerDisplayState({ status: "playing", turnRemainingMs: 60_000, currentPlayerAfkRemainingMs: 15_000, receivedAt: 1_000 }, 6_000),
    { text: "AFK: 10s", danger: true }
  );
});
