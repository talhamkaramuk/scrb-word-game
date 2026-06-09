export const BOARD_SIZE = 15;
export const CENTER_INDEX = Math.floor(BOARD_SIZE / 2);
export const RACK_SIZE = 7;
export const MAX_PLAYERS = 10;
export const MAX_NAME_LENGTH = 24;
export const BINGO_BONUS = 35;
export const WORD_TARGET_OPTIONS = Object.freeze([50, 100, 150, 200]);
export const TURN_SECONDS_OPTIONS = Object.freeze([60, 90, 120]);
export const DEFAULT_WORD_TARGET = 100;
export const DEFAULT_TURN_SECONDS = 90;

export const PREMIUMS = Object.freeze({
  NONE: "NONE",
  DL: "DL",
  TL: "TL",
  DW: "DW",
  TW: "TW"
});

const TILE_DISTRIBUTION = Object.freeze([
  { letter: "A", count: 12, value: 1 },
  { letter: "E", count: 8, value: 1 },
  { letter: "İ", count: 7, value: 1 },
  { letter: "N", count: 6, value: 1 },
  { letter: "R", count: 6, value: 1 },
  { letter: "L", count: 5, value: 1 },
  { letter: "K", count: 5, value: 2 },
  { letter: "I", count: 4, value: 2 },
  { letter: "D", count: 4, value: 2 },
  { letter: "M", count: 4, value: 2 },
  { letter: "T", count: 4, value: 2 },
  { letter: "B", count: 3, value: 3 },
  { letter: "U", count: 3, value: 3 },
  { letter: "S", count: 3, value: 3 },
  { letter: "O", count: 3, value: 3 },
  { letter: "Y", count: 3, value: 3 },
  { letter: "C", count: 2, value: 4 },
  { letter: "Ç", count: 2, value: 4 },
  { letter: "G", count: 2, value: 4 },
  { letter: "H", count: 2, value: 4 },
  { letter: "P", count: 2, value: 5 },
  { letter: "Ş", count: 2, value: 5 },
  { letter: "Z", count: 2, value: 5 },
  { letter: "F", count: 1, value: 7 },
  { letter: "Ğ", count: 1, value: 7 },
  { letter: "Ö", count: 1, value: 7 },
  { letter: "V", count: 1, value: 7 },
  { letter: "Ü", count: 1, value: 7 },
  { letter: "J", count: 1, value: 10 },
  { letter: "?", count: 2, value: 0, blank: true }
]);

const TILE_VALUE_BY_LETTER = new Map(
  TILE_DISTRIBUTION.filter((entry) => !entry.blank).map((entry) => [entry.letter, entry.value])
);

const TURKISH_UPPER = new Map([
  ["a", "A"],
  ["b", "B"],
  ["c", "C"],
  ["ç", "Ç"],
  ["d", "D"],
  ["e", "E"],
  ["f", "F"],
  ["g", "G"],
  ["ğ", "Ğ"],
  ["h", "H"],
  ["ı", "I"],
  ["i", "İ"],
  ["j", "J"],
  ["k", "K"],
  ["l", "L"],
  ["m", "M"],
  ["n", "N"],
  ["o", "O"],
  ["ö", "Ö"],
  ["p", "P"],
  ["r", "R"],
  ["s", "S"],
  ["ş", "Ş"],
  ["t", "T"],
  ["u", "U"],
  ["ü", "Ü"],
  ["v", "V"],
  ["y", "Y"],
  ["z", "Z"]
]);

const WORD_TRIPLE = [
  [0, 0],
  [0, 7],
  [0, 14],
  [7, 0],
  [7, 14],
  [14, 0],
  [14, 7],
  [14, 14]
];

const WORD_DOUBLE = [
  [1, 1],
  [1, 13],
  [2, 2],
  [2, 12],
  [3, 3],
  [3, 11],
  [4, 4],
  [4, 10],
  [7, 7],
  [10, 4],
  [10, 10],
  [11, 3],
  [11, 11],
  [12, 2],
  [12, 12],
  [13, 1],
  [13, 13]
];

const LETTER_TRIPLE = [
  [1, 5],
  [1, 9],
  [5, 1],
  [5, 5],
  [5, 9],
  [5, 13],
  [9, 1],
  [9, 5],
  [9, 9],
  [9, 13],
  [13, 5],
  [13, 9]
];

const LETTER_DOUBLE = [
  [0, 3],
  [0, 11],
  [2, 6],
  [2, 8],
  [3, 0],
  [3, 7],
  [3, 14],
  [6, 2],
  [6, 6],
  [6, 8],
  [6, 12],
  [7, 3],
  [7, 11],
  [8, 2],
  [8, 6],
  [8, 8],
  [8, 12],
  [11, 0],
  [11, 7],
  [11, 14],
  [12, 6],
  [12, 8],
  [14, 3],
  [14, 11]
];

const PREMIUM_BY_COORD = buildPremiumMap();

export class GameRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameRuleError";
    this.code = code;
  }
}

export function createSeededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeLetter(value) {
  const [first] = Array.from(String(value ?? "").trim());
  if (!first) {
    return "";
  }
  return TURKISH_UPPER.get(first) ?? first.toUpperCase();
}

export function normalizeWord(value) {
  return Array.from(String(value ?? ""))
    .map((letter) => normalizeLetter(letter))
    .filter((letter) => isPlayableLetter(letter))
    .join("");
}

export function isPlayableLetter(letter) {
  return TILE_VALUE_BY_LETTER.has(letter);
}

export function sanitizeName(name) {
  const cleaned = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || "Oyuncu";
}

export function createBoard() {
  return Array.from({ length: BOARD_SIZE }, (_, row) =>
    Array.from({ length: BOARD_SIZE }, (_, col) => ({
      row,
      col,
      premium: premiumAt(row, col),
      tile: null
    }))
  );
}

export function createTileBag(random = Math.random) {
  const tiles = [];
  let sequence = 1;

  for (const entry of TILE_DISTRIBUTION) {
    for (let index = 0; index < entry.count; index += 1) {
      tiles.push({
        id: `T${String(sequence).padStart(3, "0")}`,
        letter: entry.letter,
        value: entry.value,
        blank: Boolean(entry.blank)
      });
      sequence += 1;
    }
  }

  shuffleInPlace(tiles, random);
  return tiles;
}

export function createGame({
  code,
  random = Math.random,
  dictionary = new Set(),
  strictDictionary = false,
  settings = {}
} = {}) {
  const safeSettings = normalizeSettings(settings);
  return {
    code: code || "LOCAL",
    status: "waiting",
    board: createBoard(),
    bag: createTileBag(random),
    players: [],
    hostId: null,
    turnIndex: 0,
    currentPlayerId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    consecutivePasses: 0,
    wordsPlayed: 0,
    settings: safeSettings,
    moveLog: [],
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    random,
    dictionary,
    strictDictionary,
    finishReason: null,
    lastMoveCells: []
  };
}

export function addPlayer(game, { id, name, connected = true } = {}) {
  if (!id) {
    throw new GameRuleError("missing_player_id", "Oyuncu kimliği eksik.");
  }

  const existing = game.players.find((player) => player.id === id);
  if (existing) {
    existing.name = sanitizeName(name || existing.name);
    existing.connected = connected;
    touch(game);
    return existing;
  }

  if (game.status !== "waiting") {
    throw new GameRuleError("game_started", "Oyun başladıktan sonra yeni oyuncu alınamaz.");
  }

  if (game.players.length >= MAX_PLAYERS) {
    throw new GameRuleError("room_full", `Oda en fazla ${MAX_PLAYERS} oyuncu alır.`);
  }

  const player = {
    id,
    name: sanitizeName(name),
    score: 0,
    rack: [],
    connected,
    ready: false,
    joinedAt: Date.now()
  };

  game.players.push(player);
  game.hostId ||= player.id;
  logMove(game, `${player.name} odaya katıldı.`);
  touch(game);
  return player;
}

export function setPlayerConnection(game, playerId, connected) {
  const player = getPlayer(game, playerId);
  if (!player) {
    return false;
  }
  player.connected = connected;
  touch(game);
  return true;
}

export function setReady(game, playerId, ready) {
  const player = requirePlayer(game, playerId);
  player.ready = Boolean(ready);
  touch(game);
  return player.ready;
}

export function setGameSettings(game, actorPlayerId, settings = {}) {
  if (game.status !== "waiting") {
    throw new GameRuleError("settings_locked", "Oyun başladıktan sonra ayarlar değiştirilemez.");
  }
  if (actorPlayerId && game.hostId !== actorPlayerId) {
    throw new GameRuleError("host_only", "Ayarları yalnızca oda sahibi değiştirebilir.");
  }

  game.settings = normalizeSettings({ ...game.settings, ...settings });
  logMove(
    game,
    `Ayarlar güncellendi: ${game.settings.targetWordCount} kelime hedefi, ${game.settings.turnSeconds} saniye hamle süresi.`
  );
  touch(game);
  return game.settings;
}

export function startGame(game, actorPlayerId) {
  if (game.status !== "waiting") {
    throw new GameRuleError("already_started", "Oyun zaten başladı.");
  }
  if (game.players.length < 1) {
    throw new GameRuleError("no_players", "Oyunu başlatmak için en az bir oyuncu gerekir.");
  }
  if (actorPlayerId && game.hostId !== actorPlayerId) {
    throw new GameRuleError("host_only", "Oyunu yalnızca oda sahibi başlatabilir.");
  }

  for (const player of game.players) {
    drawTiles(game, player);
    player.ready = true;
  }

  game.status = "playing";
  game.turnIndex = 0;
  game.currentPlayerId = game.players[0].id;
  beginTurn(game, Date.now());
  game.consecutivePasses = 0;
  game.wordsPlayed = 0;
  logMove(game, "Oyun başladı.");
  touch(game);
}

export function applyMove(game, playerId, placements) {
  expireTurnIfNeeded(game);
  assertCurrentTurn(game, playerId);
  const player = requirePlayer(game, playerId);
  const pendingTiles = validatePlacementPayload(game, player, placements);
  const analysis = analyzeMove(game, pendingTiles);

  for (const pending of pendingTiles) {
    game.board[pending.row][pending.col].tile = pending.tile;
  }

  game.lastMoveCells = pendingTiles.map((pending) => ({
    row: pending.row,
    col: pending.col
  }));

  const usedTileIds = new Set(pendingTiles.map((pending) => pending.tile.id));
  player.rack = player.rack.filter((tile) => !usedTileIds.has(tile.id));
  drawTiles(game, player);
  player.score += analysis.totalScore;
  game.wordsPlayed += analysis.words.length;
  game.consecutivePasses = 0;

  const wordSummary = analysis.words.map((word) => word.text).join(", ");
  const bonusSummary = analysis.bingoBonus > 0 ? ` +${analysis.bingoBonus} seri bonusu` : "";
  logMove(game, `${player.name}: ${wordSummary} (${analysis.totalScore} puan${bonusSummary}).`);

  if (game.wordsPlayed >= game.settings.targetWordCount) {
    finishGame(game, `${game.settings.targetWordCount} kelimelik oyun hedefi tamamlandı.`);
  } else if (game.bag.length === 0 && player.rack.length === 0) {
    finishGame(game, `${player.name} rafını bitirdi.`);
  } else {
    advanceTurn(game);
  }

  touch(game);
  return analysis;
}

export function passTurn(game, playerId) {
  expireTurnIfNeeded(game);
  assertCurrentTurn(game, playerId);
  const player = requirePlayer(game, playerId);
  game.lastMoveCells = [];
  game.consecutivePasses += 1;
  logMove(game, `${player.name} pas geçti.`);

  if (game.consecutivePasses >= Math.max(2, game.players.length * 2)) {
    finishGame(game, "Arka arkaya pas sınırı doldu.");
  } else {
    advanceTurn(game);
  }

  touch(game);
}

export function exchangeTiles(game, playerId, tileIds) {
  expireTurnIfNeeded(game);
  assertCurrentTurn(game, playerId);
  const player = requirePlayer(game, playerId);

  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    throw new GameRuleError("empty_exchange", "Değiştirilecek taş seçilmedi.");
  }
  if (tileIds.length > player.rack.length) {
    throw new GameRuleError("too_many_tiles", "Rafında olmayan taşlar seçildi.");
  }
  if (game.bag.length < tileIds.length) {
    throw new GameRuleError("bag_too_small", "Torbada değişim için yeterli taş yok.");
  }

  const requested = new Set(tileIds.map(String));
  if (requested.size !== tileIds.length) {
    throw new GameRuleError("duplicate_tile", "Aynı taş birden fazla seçilemez.");
  }

  const removed = [];
  const nextRack = [];
  for (const tile of player.rack) {
    if (requested.has(tile.id)) {
      removed.push(tile);
    } else {
      nextRack.push(tile);
    }
  }

  if (removed.length !== requested.size) {
    throw new GameRuleError("tile_not_owned", "Seçilen taşlardan biri rafta değil.");
  }

  player.rack = nextRack;
  game.bag.push(...removed);
  shuffleInPlace(game.bag, game.random);
  drawTiles(game, player);
  game.lastMoveCells = [];
  game.consecutivePasses = 0;
  logMove(game, `${player.name} ${removed.length} taş değiştirdi.`);
  advanceTurn(game);
  touch(game);
}

export function serializeGame(game, viewerId) {
  const now = Date.now();
  const me = game.players.find((player) => player.id === viewerId) || null;
  return {
    code: game.code,
    status: game.status,
    boardSize: BOARD_SIZE,
    rackSize: RACK_SIZE,
    maxPlayers: MAX_PLAYERS,
    board: game.board.map((row) =>
      row.map((cell) => ({
        premium: cell.premium,
        tile: cell.tile ? publicTile(cell.tile) : null
      }))
    ),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      rackCount: player.rack.length,
      connected: player.connected,
      ready: player.ready,
      host: player.id === game.hostId
    })),
    me: me
      ? {
          id: me.id,
          name: me.name,
          score: me.score,
          rack: me.rack.map(publicTile),
          host: me.id === game.hostId
        }
      : null,
    hostId: game.hostId,
    currentPlayerId: game.currentPlayerId,
    currentPlayerName: game.players.find((player) => player.id === game.currentPlayerId)?.name || null,
    bagCount: game.bag.length,
    settings: { ...game.settings },
    wordsPlayed: game.wordsPlayed,
    moveLog: game.moveLog.slice(-24),
    revision: game.revision,
    turnStartedAt: game.turnStartedAt,
    turnDeadlineAt: game.turnDeadlineAt,
    turnRemainingMs: game.turnDeadlineAt ? Math.max(0, game.turnDeadlineAt - now) : null,
    serverNow: now,
    dictionaryMode: game.strictDictionary ? "strict" : "open",
    dictionaryCount: game.dictionary?.size || 0,
    finishReason: game.finishReason,
    lastMoveCells: game.lastMoveCells || []
  };
}

export function expireTurnIfNeeded(game, now = Date.now()) {
  if (game.status !== "playing" || !game.turnDeadlineAt || now < game.turnDeadlineAt) {
    return false;
  }

  const player = game.players[game.turnIndex];
  if (!player) {
    return false;
  }

  game.lastMoveCells = [];
  game.consecutivePasses += 1;
  logMove(game, `${player.name} süre dolduğu için pas geçti.`);

  if (game.consecutivePasses >= Math.max(2, game.players.length * 2)) {
    finishGame(game, "Arka arkaya pas sınırı doldu.");
  } else {
    advanceTurn(game, now);
  }

  touch(game);
  return true;
}

export function premiumLabel(premium) {
  switch (premium) {
    case PREMIUMS.DL:
      return "2H";
    case PREMIUMS.TL:
      return "3H";
    case PREMIUMS.DW:
      return "2K";
    case PREMIUMS.TW:
      return "3K";
    default:
      return "";
  }
}

function analyzeMove(game, pendingTiles) {
  const boardHasExistingTiles = hasAnyBoardTile(game.board);
  const pendingMap = new Map(pendingTiles.map((pending) => [coordKey(pending.row, pending.col), pending]));

  if (!boardHasExistingTiles && !pendingTiles.some((pending) => pending.row === CENTER_INDEX && pending.col === CENTER_INDEX)) {
    throw new GameRuleError("first_move_center", "İlk hamle merkez karesinden geçmelidir.");
  }

  if (boardHasExistingTiles && !touchesExistingTile(game.board, pendingTiles)) {
    throw new GameRuleError("move_disconnected", "Yeni taşlar tahtadaki kelimelere temas etmelidir.");
  }

  const direction = inferDirection(game.board, pendingTiles);
  ensureContinuousLine(game.board, pendingMap, pendingTiles, direction);

  const words = collectWords(game.board, pendingMap, pendingTiles, direction);
  if (words.length === 0 || words[0].cells.length < 2) {
    throw new GameRuleError("word_too_short", "Hamle en az iki harfli bir kelime oluşturmalıdır.");
  }

  validateDictionary(game, words);
  const { totalScore, bingoBonus } = scoreWords(game.board, words, pendingTiles.length);
  return { direction, words, totalScore, bingoBonus };
}

function validatePlacementPayload(game, player, placements) {
  if (!Array.isArray(placements) || placements.length === 0) {
    throw new GameRuleError("empty_move", "Yerleştirilecek taş yok.");
  }
  if (placements.length > RACK_SIZE) {
    throw new GameRuleError("too_many_tiles", `Bir hamlede en fazla ${RACK_SIZE} taş oynanabilir.`);
  }

  const rackById = new Map(player.rack.map((tile) => [tile.id, tile]));
  const usedTileIds = new Set();
  const usedCells = new Set();

  return placements.map((raw) => {
    const row = Number(raw?.row);
    const col = Number(raw?.col);
    const tileId = String(raw?.tileId ?? "");

    if (!Number.isInteger(row) || !Number.isInteger(col) || !isInsideBoard(row, col)) {
      throw new GameRuleError("invalid_cell", "Geçersiz tahta karesi.");
    }
    if (game.board[row][col].tile) {
      throw new GameRuleError("occupied_cell", "Dolu bir kareye taş konamaz.");
    }

    const cellKey = coordKey(row, col);
    if (usedCells.has(cellKey)) {
      throw new GameRuleError("duplicate_cell", "Aynı kareye birden fazla taş konamaz.");
    }
    usedCells.add(cellKey);

    const rackTile = rackById.get(tileId);
    if (!rackTile) {
      throw new GameRuleError("tile_not_owned", "Seçilen taş rafta bulunamadı.");
    }
    if (usedTileIds.has(tileId)) {
      throw new GameRuleError("duplicate_tile", "Aynı taş birden fazla oynanamaz.");
    }
    usedTileIds.add(tileId);

    const letter = rackTile.blank ? normalizeLetter(raw?.letter) : rackTile.letter;
    if (!isPlayableLetter(letter)) {
      throw new GameRuleError("invalid_blank_letter", "Boş taş için geçerli bir harf seçilmelidir.");
    }

    return {
      row,
      col,
      tile: {
        id: rackTile.id,
        letter,
        value: rackTile.blank ? 0 : rackTile.value,
        blank: rackTile.blank
      }
    };
  });
}

function inferDirection(board, pendingTiles) {
  if (pendingTiles.length > 1) {
    const sameRow = pendingTiles.every((pending) => pending.row === pendingTiles[0].row);
    const sameCol = pendingTiles.every((pending) => pending.col === pendingTiles[0].col);
    if (sameRow) {
      return "H";
    }
    if (sameCol) {
      return "V";
    }
    throw new GameRuleError("not_in_line", "Oynanan taşlar aynı satırda ya da sütunda olmalıdır.");
  }

  const [{ row, col }] = pendingTiles;
  const hasHorizontalNeighbor = hasTile(board, row, col - 1) || hasTile(board, row, col + 1);
  const hasVerticalNeighbor = hasTile(board, row - 1, col) || hasTile(board, row + 1, col);
  if (hasHorizontalNeighbor) {
    return "H";
  }
  if (hasVerticalNeighbor) {
    return "V";
  }
  return "H";
}

function ensureContinuousLine(board, pendingMap, pendingTiles, direction) {
  if (pendingTiles.length === 1) {
    return;
  }

  const fixed = direction === "H" ? "row" : "col";
  const moving = direction === "H" ? "col" : "row";
  const fixedValue = pendingTiles[0][fixed];
  const min = Math.min(...pendingTiles.map((pending) => pending[moving]));
  const max = Math.max(...pendingTiles.map((pending) => pending[moving]));

  for (let value = min; value <= max; value += 1) {
    const row = direction === "H" ? fixedValue : value;
    const col = direction === "H" ? value : fixedValue;
    if (!getTile(board, pendingMap, row, col)) {
      throw new GameRuleError("gap_in_line", "Oynanan taşlar arasında boşluk kalamaz.");
    }
  }
}

function collectWords(board, pendingMap, pendingTiles, direction) {
  const mainWord = scanWord(board, pendingMap, pendingTiles[0].row, pendingTiles[0].col, direction);
  const words = mainWord.cells.length > 1 ? [mainWord] : [];
  const crossDirection = direction === "H" ? "V" : "H";

  for (const pending of pendingTiles) {
    const crossWord = scanWord(board, pendingMap, pending.row, pending.col, crossDirection);
    if (crossWord.cells.length > 1) {
      words.push(crossWord);
    }
  }

  return words;
}

function scanWord(board, pendingMap, row, col, direction) {
  const rowStep = direction === "V" ? 1 : 0;
  const colStep = direction === "H" ? 1 : 0;
  let startRow = row;
  let startCol = col;

  while (getTile(board, pendingMap, startRow - rowStep, startCol - colStep)) {
    startRow -= rowStep;
    startCol -= colStep;
  }

  const cells = [];
  let cursorRow = startRow;
  let cursorCol = startCol;
  while (true) {
    const tile = getTile(board, pendingMap, cursorRow, cursorCol);
    if (!tile) {
      break;
    }
    cells.push({
      row: cursorRow,
      col: cursorCol,
      tile,
      isNew: pendingMap.has(coordKey(cursorRow, cursorCol))
    });
    cursorRow += rowStep;
    cursorCol += colStep;
  }

  return {
    text: cells.map((cell) => cell.tile.letter).join(""),
    cells
  };
}

function validateDictionary(game, words) {
  if (!game.strictDictionary) {
    return;
  }
  if (!game.dictionary || game.dictionary.size === 0) {
    throw new GameRuleError("dictionary_empty", "Sıkı sözlük modu açık ama sözlük boş.");
  }

  const invalidWords = words
    .map((word) => word.text)
    .filter((word) => !game.dictionary.has(normalizeWord(word)));

  if (invalidWords.length > 0) {
    throw new GameRuleError(
      "invalid_word",
      `Sözlükte olmayan kelime: ${invalidWords.join(", ")}. Uydurma kelimeler kabul edilmez.`
    );
  }
}

function scoreWords(board, words, playedTileCount) {
  let totalScore = 0;

  for (const word of words) {
    let baseScore = 0;
    let wordMultiplier = 1;

    for (const cell of word.cells) {
      const premium = board[cell.row][cell.col].premium;
      let letterScore = cell.tile.value;

      if (cell.isNew) {
        if (premium === PREMIUMS.DL) {
          letterScore *= 2;
        } else if (premium === PREMIUMS.TL) {
          letterScore *= 3;
        } else if (premium === PREMIUMS.DW) {
          wordMultiplier *= 2;
        } else if (premium === PREMIUMS.TW) {
          wordMultiplier *= 3;
        }
      }

      baseScore += letterScore;
    }

    totalScore += baseScore * wordMultiplier;
  }

  const bingoBonus = playedTileCount === RACK_SIZE ? BINGO_BONUS : 0;
  return {
    totalScore: totalScore + bingoBonus,
    bingoBonus
  };
}

function finishGame(game, reason) {
  if (game.status === "finished") {
    return;
  }

  const remainingScores = new Map(
    game.players.map((player) => [player.id, player.rack.reduce((sum, tile) => sum + tile.value, 0)])
  );
  const emptyRackPlayer = game.players.find((player) => player.rack.length === 0);
  const totalRemaining = [...remainingScores.values()].reduce((sum, value) => sum + value, 0);

  for (const player of game.players) {
    player.score -= remainingScores.get(player.id) ?? 0;
    if (emptyRackPlayer && player.id === emptyRackPlayer.id) {
      player.score += totalRemaining;
    }
  }

  game.status = "finished";
  game.currentPlayerId = null;
  game.turnStartedAt = null;
  game.turnDeadlineAt = null;
  game.finishReason = reason;
  logMove(game, `Oyun bitti: ${reason}`);
}

function assertCurrentTurn(game, playerId) {
  if (game.status !== "playing") {
    throw new GameRuleError("not_playing", "Oyun henüz aktif değil.");
  }
  if (game.currentPlayerId !== playerId) {
    throw new GameRuleError("not_your_turn", "Sıra sende değil.");
  }
}

function requirePlayer(game, playerId) {
  const player = getPlayer(game, playerId);
  if (!player) {
    throw new GameRuleError("unknown_player", "Oyuncu bulunamadı.");
  }
  return player;
}

function getPlayer(game, playerId) {
  return game.players.find((player) => player.id === playerId) || null;
}

function drawTiles(game, player) {
  while (player.rack.length < RACK_SIZE && game.bag.length > 0) {
    player.rack.push(game.bag.shift());
  }
}

function advanceTurn(game, now = Date.now()) {
  if (game.status !== "playing") {
    return;
  }
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  game.currentPlayerId = game.players[game.turnIndex].id;
  beginTurn(game, now);
}

function touchesExistingTile(board, pendingTiles) {
  return pendingTiles.some(({ row, col }) =>
    [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1]
    ].some(([nextRow, nextCol]) => hasTile(board, nextRow, nextCol))
  );
}

function hasAnyBoardTile(board) {
  return board.some((row) => row.some((cell) => Boolean(cell.tile)));
}

function hasTile(board, row, col) {
  return Boolean(isInsideBoard(row, col) && board[row][col].tile);
}

function getTile(board, pendingMap, row, col) {
  if (!isInsideBoard(row, col)) {
    return null;
  }
  return pendingMap.get(coordKey(row, col))?.tile || board[row][col].tile || null;
}

function isInsideBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function publicTile(tile) {
  return {
    id: tile.id,
    letter: tile.letter,
    value: tile.value,
    blank: Boolean(tile.blank)
  };
}

function logMove(game, text) {
  game.moveLog.push({
    id: `${Date.now()}-${game.moveLog.length + 1}`,
    at: Date.now(),
    text
  });
  if (game.moveLog.length > 80) {
    game.moveLog.splice(0, game.moveLog.length - 80);
  }
}

function touch(game) {
  game.updatedAt = Date.now();
  game.revision += 1;
}

function beginTurn(game, now = Date.now()) {
  game.turnStartedAt = now;
  game.turnDeadlineAt = now + game.settings.turnSeconds * 1000;
}

function normalizeSettings(settings = {}) {
  const targetWordCount = Number(settings.targetWordCount ?? DEFAULT_WORD_TARGET);
  const turnSeconds = Number(settings.turnSeconds ?? DEFAULT_TURN_SECONDS);

  return {
    targetWordCount: WORD_TARGET_OPTIONS.includes(targetWordCount) ? targetWordCount : DEFAULT_WORD_TARGET,
    turnSeconds: TURN_SECONDS_OPTIONS.includes(turnSeconds) ? turnSeconds : DEFAULT_TURN_SECONDS
  };
}

function coordKey(row, col) {
  return `${row},${col}`;
}

function buildPremiumMap() {
  const map = new Map();
  for (const [row, col] of WORD_TRIPLE) {
    map.set(coordKey(row, col), PREMIUMS.TW);
  }
  for (const [row, col] of WORD_DOUBLE) {
    map.set(coordKey(row, col), PREMIUMS.DW);
  }
  for (const [row, col] of LETTER_TRIPLE) {
    map.set(coordKey(row, col), PREMIUMS.TL);
  }
  for (const [row, col] of LETTER_DOUBLE) {
    map.set(coordKey(row, col), PREMIUMS.DL);
  }
  return map;
}

function premiumAt(row, col) {
  return PREMIUM_BY_COORD.get(coordKey(row, col)) || PREMIUMS.NONE;
}

function shuffleInPlace(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
}
