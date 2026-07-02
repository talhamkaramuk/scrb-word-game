import assert from "node:assert/strict";
import test from "node:test";
import {
  AFK_GRACE_MS,
  CENTER_INDEX,
  MAX_PLAYERS,
  addPlayer,
  applyMove,
  createGame,
  createSeededRandom,
  exchangeTiles,
  expireTurnIfNeeded,
  passTurn,
  serializeGame,
  setGameSettings,
  setPlayerConnection,
  startGame
} from "../src/shared/game-core.js";

test("starts a room and deals private racks", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(11) });
  addPlayer(game, { id: "p1", name: "Ada" });
  addPlayer(game, { id: "p2", name: "Bora" });

  startGame(game, "p1");
  const stateForP1 = serializeGame(game, "p1");
  const stateForP2 = serializeGame(game, "p2");

  assert.equal(game.status, "playing");
  assert.equal(stateForP1.me.rack.length, 7);
  assert.equal(stateForP2.me.rack.length, 7);
  assert.equal(stateForP1.players[1].rackCount, 7);
  assert.notEqual(stateForP1.me.id, "p1");
  assert.equal(stateForP1.players.some((player) => player.id === "p1" || player.id === "p2"), false);
  assert.notDeepEqual(stateForP1.me.rack, stateForP2.me.rack);
});

test("requires at least two players to start", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(12) });
  addPlayer(game, { id: "p1", name: "Ada" });

  assert.throws(() => startGame(game, "p1"), /en az 2 oyuncu/);
});

test("simple host-start model does not expose player readiness", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(14) });
  addPlayer(game, { id: "p1", name: "Ada" });
  addPlayer(game, { id: "p2", name: "Bora" });

  const waitingState = serializeGame(game, "p1");
  assert.equal(Object.hasOwn(waitingState.players[0], "ready"), false);

  startGame(game, "p1");
  assert.equal(Object.hasOwn(game.players[0], "ready"), false);
  assert.equal(Object.hasOwn(serializeGame(game, "p1").players[0], "ready"), false);
});

test("first move must cross center", () => {
  const game = preparedGame();
  assert.throws(
    () =>
      applyMove(game, "p1", [
        { row: 0, col: 0, tileId: "K1" },
        { row: 0, col: 1, tileId: "E1" }
      ]),
    /merkez/
  );
});

test("applies a valid opening move and advances turn", () => {
  const game = preparedGame();
  const result = applyMove(game, "p1", [
    { row: CENTER_INDEX, col: CENTER_INDEX - 2, tileId: "K1" },
    { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "E1" },
    { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "L1" },
    { row: CENTER_INDEX, col: CENTER_INDEX + 1, tileId: "I1" },
    { row: CENTER_INDEX, col: CENTER_INDEX + 2, tileId: "M1" },
    { row: CENTER_INDEX, col: CENTER_INDEX + 3, tileId: "E2" }
  ]);

  assert.equal(result.words[0].text, "KELIME");
  assert.equal(game.board[CENTER_INDEX][CENTER_INDEX].tile.letter, "L");
  assert.equal(game.players[0].score, result.totalScore);
  assert.equal(game.currentPlayerId, "p2");
});

test("rejects disconnected follow-up moves", () => {
  const game = preparedGame();
  applyMove(game, "p1", [
    { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "E1" },
    { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "L1" }
  ]);

  assert.throws(
    () =>
      applyMove(game, "p2", [
        { row: 1, col: 1, tileId: "A2" },
        { row: 1, col: 2, tileId: "T2" }
      ]),
    /temas/
  );
});

test("exchange and pass rotate the active player", () => {
  const game = preparedGame();
  exchangeTiles(game, "p1", ["K1", "E1"]);
  assert.equal(game.currentPlayerId, "p2");
  passTurn(game, "p2");
  assert.equal(game.currentPlayerId, "p1");
});

test("strict dictionary rejects made-up words even when placement is legal", () => {
  const game = preparedGame({ strictDictionary: true, dictionary: new Set(["EL", "KELİME"]) });

  assert.throws(
    () =>
      applyMove(game, "p1", [
        { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "K1" },
        { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "Z1" }
      ]),
    /Sözlükte olmayan kelime/
  );
});

test("strict dictionary accepts real words from the configured word list", () => {
  const game = preparedGame({ strictDictionary: true, dictionary: new Set(["EL", "KELİME"]) });

  const result = applyMove(game, "p1", [
    { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "E1" },
    { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "L1" }
  ]);

  assert.equal(result.words[0].text, "EL");
  assert.equal(game.currentPlayerId, "p2");
});

test("host can configure game mode and turn duration before start", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(13) });
  addPlayer(game, { id: "p1", name: "Ada" });
  addPlayer(game, { id: "p2", name: "Bora" });

  setGameSettings(game, "p1", { gameMode: "timed15", turnSeconds: 60 });
  startGame(game, "p1");

  assert.equal(game.settings.gameMode, "timed15");
  assert.equal(game.settings.turnSeconds, 60);
  assert.equal(game.gameDeadlineAt - game.gameStartedAt, 15 * 60_000);
  assert.equal(game.turnDeadlineAt - game.turnStartedAt, 60_000);
});

test("classic mode does not end from an arbitrary word count", () => {
  const game = preparedGame();
  game.wordsPlayed = 999;

  applyMove(game, "p1", [
    { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "E1" },
    { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "L1" }
  ]);

  assert.equal(game.status, "playing");
  assert.equal(game.wordsPlayed, 1000);
});

test("score target mode finishes when a player reaches the target", () => {
  const game = preparedGame({ settings: { gameMode: "score250" } });
  game.players[0].score = 248;

  applyMove(game, "p1", [
    { row: CENTER_INDEX, col: CENTER_INDEX - 1, tileId: "E1" },
    { row: CENTER_INDEX, col: CENTER_INDEX, tileId: "L1" }
  ]);

  assert.equal(game.status, "finished");
  assert.match(game.finishReason, /250 puan/);
  assert.equal(game.players[0].score >= 250, true);
});

test("timed mode finishes when the match clock expires", () => {
  const game = preparedGame({ settings: { gameMode: "timed15" } });
  const expiredAt = game.gameDeadlineAt + 1;

  const expired = expireTurnIfNeeded(game, expiredAt);

  assert.equal(expired, true);
  assert.equal(game.status, "finished");
  assert.equal(game.currentPlayerId, null);
  assert.match(game.finishReason, /süresi/);
});

test("expired turn is passed automatically", () => {
  const game = preparedGame({ settings: { turnSeconds: 60 } });
  const expiredAt = game.turnDeadlineAt + 1;

  const expired = expireTurnIfNeeded(game, expiredAt);

  assert.equal(expired, true);
  assert.equal(game.currentPlayerId, "p2");
  assert.equal(game.turnStartedAt, expiredAt);
});

test("disconnected active player is passed after AFK grace", () => {
  const game = preparedGame({ settings: { turnSeconds: 60 } });
  const disconnectedAt = game.turnStartedAt + 1000;

  setPlayerConnection(game, "p1", false, disconnectedAt);

  assert.equal(expireTurnIfNeeded(game, disconnectedAt + AFK_GRACE_MS - 1), false);
  assert.equal(game.currentPlayerId, "p1");
  assert.equal(expireTurnIfNeeded(game, disconnectedAt + AFK_GRACE_MS), true);
  assert.equal(game.currentPlayerId, "p2");
  assert.match(game.moveLog.at(-1).text, /AFK/);
});

test("reconnected active player keeps the current turn before AFK grace expires", () => {
  const game = preparedGame({ settings: { turnSeconds: 60 } });
  const disconnectedAt = game.turnStartedAt + 1000;

  setPlayerConnection(game, "p1", false, disconnectedAt);
  setPlayerConnection(game, "p1", true, disconnectedAt + 10_000);

  assert.equal(expireTurnIfNeeded(game, disconnectedAt + AFK_GRACE_MS + 1000), false);
  assert.equal(game.currentPlayerId, "p1");
});

test("room model keeps host authority while the host is disconnected", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(15) });
  addPlayer(game, { id: "p1", name: "Ada" });
  addPlayer(game, { id: "p2", name: "Bora" });

  setPlayerConnection(game, "p1", false, Date.now());

  assert.equal(game.hostId, "p1");
  assert.equal(game.players[0].connected, false);
  assert.throws(() => startGame(game, "p2"), /yalnızca oda sahibi/);
});

test("room model rejects players above the configured maximum", () => {
  const game = createGame({ code: "TST", random: createSeededRandom(16) });
  for (let index = 1; index <= MAX_PLAYERS; index += 1) {
    addPlayer(game, { id: `p${index}`, name: `P${index}` });
  }

  assert.throws(() => addPlayer(game, { id: "p-over", name: "Fazla" }), /en fazla/);
});

function preparedGame(overrides = {}) {
  const game = createGame({ code: "TST", random: createSeededRandom(7), ...overrides });
  addPlayer(game, { id: "p1", name: "Ada" });
  addPlayer(game, { id: "p2", name: "Bora" });
  startGame(game, "p1");
  game.players[0].rack = [
    tile("K", "K1", 2),
    tile("E", "E1", 1),
    tile("L", "L1", 1),
    tile("I", "I1", 2),
    tile("M", "M1", 2),
    tile("E", "E2", 1),
    tile("Z", "Z1", 5)
  ];
  game.players[1].rack = [
    tile("A", "A2", 1),
    tile("T", "T2", 2),
    tile("K", "K2", 2),
    tile("E", "E3", 1),
    tile("L", "L2", 1),
    tile("I", "I2", 2),
    tile("M", "M2", 2)
  ];
  return game;
}

function tile(letter, id, value) {
  return { id, letter, value, blank: false };
}
