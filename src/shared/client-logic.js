import { isPlayableLetter, normalizeLetter } from "./game-core.js";

export function cleanRoomCode(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

export function createJoinRequest({ name, roomCode, sessionId, reconnectToken, createNewRoom = false } = {}) {
  const playerName = String(name || "").trim();
  const requestedRoomCode = createNewRoom ? "" : cleanRoomCode(roomCode);
  const isNewRoomRequest = requestedRoomCode === "";

  return {
    playerName,
    roomCode: requestedRoomCode,
    isNewRoomRequest,
    shouldClearStoredSession: isNewRoomRequest,
    message: {
      type: "join",
      name: playerName,
      roomCode: requestedRoomCode,
      sessionId: isNewRoomRequest ? undefined : sessionId || undefined,
      reconnectToken: isNewRoomRequest ? undefined : reconnectToken || undefined
    }
  };
}

export function shouldAutoJoinAfterReconnect({ sessionId, reconnectToken, roomCode, playerName } = {}) {
  return Boolean(sessionId && reconnectToken && roomCode && playerName);
}

export function normalizeBlankTileInput(value) {
  const letter = normalizeLetter(value);
  return isPlayableLetter(letter) ? letter : "";
}

export function timerDisplayState(game, now) {
  if (!game || game.status !== "playing" || game.turnRemainingMs === null) {
    return { text: "Süre: --", danger: false };
  }

  const timestamp = Number.isFinite(now) ? now : 0;
  const receivedAt = Number.isFinite(game.receivedAt) ? game.receivedAt : timestamp;
  const afkCountdown = game.currentPlayerAfkRemainingMs !== null;
  const baseRemainingMs = afkCountdown ? game.currentPlayerAfkRemainingMs : game.turnRemainingMs;
  const elapsed = timestamp - receivedAt;
  const remainingMs = Math.max(0, baseRemainingMs - elapsed);
  const seconds = Math.ceil(remainingMs / 1000);

  return {
    text: `${afkCountdown ? "AFK" : "Süre"}: ${seconds}s`,
    danger: afkCountdown || seconds <= 10
  };
}
