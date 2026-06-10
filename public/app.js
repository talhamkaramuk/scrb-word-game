import { CENTER_INDEX, gameModeDurationMs, gameModeLabel, gameModeScoreTarget, premiumLabel, normalizeLetter } from "/shared/game-core.js";

const STORAGE_KEYS = {
  playerId: "kelime-meydani.playerId",
  playerName: "kelime-meydani.playerName",
  roomCode: "kelime-meydani.roomCode",
  sound: "kelime-meydani.sound"
};

const app = {
  socket: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  playerId: localStorage.getItem(STORAGE_KEYS.playerId) || "",
  playerName: localStorage.getItem(STORAGE_KEYS.playerName) || "",
  roomCode: localStorage.getItem(STORAGE_KEYS.roomCode) || "",
  game: null,
  mode: "place",
  selectedTileId: null,
  dragTileId: null,
  rackOrder: [],
  dropFeedbackCells: new Set(),
  exchangeIds: new Set(),
  pendingPlacements: [],
  toastTimer: null,
  audio: {
    enabled: localStorage.getItem(STORAGE_KEYS.sound) !== "0",
    context: null
  }
};

const dom = {
  joinView: document.querySelector("#joinView"),
  gameView: document.querySelector("#gameView"),
  joinForm: document.querySelector("#joinForm"),
  createRoomButton: document.querySelector("#createRoomButton"),
  playerName: document.querySelector("#playerName"),
  roomCode: document.querySelector("#roomCode"),
  roomBadge: document.querySelector("#roomBadge"),
  copyRoomButton: document.querySelector("#copyRoomButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  turnStatus: document.querySelector("#turnStatus"),
  timerStatus: document.querySelector("#timerStatus"),
  goalStatus: document.querySelector("#goalStatus"),
  bagStatus: document.querySelector("#bagStatus"),
  soundButton: document.querySelector("#soundButton"),
  board: document.querySelector("#board"),
  playersList: document.querySelector("#playersList"),
  startButton: document.querySelector("#startButton"),
  settingsCard: document.querySelector(".settings-card"),
  settingsPanel: document.querySelector("#settingsPanel"),
  gameMode: document.querySelector("#gameMode"),
  turnSeconds: document.querySelector("#turnSeconds"),
  dictionaryMode: document.querySelector("#dictionaryMode"),
  moveLog: document.querySelector("#moveLog"),
  movePreview: document.querySelector("#movePreview"),
  rack: document.querySelector("#rack"),
  placeModeButton: document.querySelector("#placeModeButton"),
  exchangeModeButton: document.querySelector("#exchangeModeButton"),
  clearButton: document.querySelector("#clearButton"),
  shuffleRackButton: document.querySelector("#shuffleRackButton"),
  submitButton: document.querySelector("#submitButton"),
  exchangeButton: document.querySelector("#exchangeButton"),
  passButton: document.querySelector("#passButton"),
  toast: document.querySelector("#toast")
};

dom.playerName.value = app.playerName;
dom.roomCode.value = app.roomCode;

dom.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinRoom(dom.roomCode.value);
});

dom.createRoomButton.addEventListener("click", () => {
  joinRoom(dom.roomCode.value);
});

dom.startButton.addEventListener("click", () => send({ type: "start" }));
dom.gameMode.addEventListener("change", sendSettings);
dom.turnSeconds.addEventListener("change", sendSettings);
dom.copyRoomButton.addEventListener("click", copyRoomCode);
dom.soundButton.addEventListener("click", toggleSound);
dom.placeModeButton.addEventListener("click", () => setMode("place"));
dom.exchangeModeButton.addEventListener("click", () => setMode("exchange"));
dom.clearButton.addEventListener("click", clearPending);
dom.shuffleRackButton.addEventListener("click", shuffleRack);
dom.submitButton.addEventListener("click", submitMove);
dom.exchangeButton.addEventListener("click", exchangeSelectedTiles);
dom.passButton.addEventListener("click", () => {
  playSound("submit");
  send({ type: "pass" });
});
document.addEventListener("pointerdown", unlockAudioOnce, { once: true });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearPending();
  }
});

connect();
renderSoundButton();
window.setInterval(updateTimerDisplay, 250);

function connect() {
  updateConnectionStatus("Bağlanıyor", false);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  app.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  app.socket.addEventListener("open", () => {
    app.reconnectAttempts = 0;
    updateConnectionStatus("Bağlı", true);
  });

  app.socket.addEventListener("message", (event) => {
    handleServerMessage(event.data);
  });

  app.socket.addEventListener("close", () => {
    updateConnectionStatus("Koptu", false);
    scheduleReconnect();
  });

  app.socket.addEventListener("error", () => {
    updateConnectionStatus("Bağlantı hatası", false);
  });
}

function scheduleReconnect() {
  if (app.reconnectTimer) {
    return;
  }

  const delay = Math.min(5000, 700 + app.reconnectAttempts * 500);
  app.reconnectAttempts += 1;
  app.reconnectTimer = window.setTimeout(() => {
    app.reconnectTimer = null;
    connect();
    if (app.playerId && app.roomCode && app.playerName) {
      window.setTimeout(() => joinRoom(app.roomCode), 250);
    }
  }, delay);
}

function joinRoom(roomCode) {
  const name = dom.playerName.value.trim();
  if (!name) {
    showToast("Oyuncu adı gerekli.");
    dom.playerName.focus();
    return;
  }

  app.playerName = name;
  app.roomCode = cleanRoomCode(roomCode);
  localStorage.setItem(STORAGE_KEYS.playerName, app.playerName);
  if (app.roomCode) {
    localStorage.setItem(STORAGE_KEYS.roomCode, app.roomCode);
  }

  send({
    type: "join",
    name: app.playerName,
    roomCode: app.roomCode,
    playerId: app.playerId || undefined
  });
}

function handleServerMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    showToast("Sunucudan geçersiz veri geldi.");
    return;
  }

  if (message.type === "joined") {
    app.playerId = message.playerId;
    app.roomCode = message.roomCode;
    localStorage.setItem(STORAGE_KEYS.playerId, app.playerId);
    localStorage.setItem(STORAGE_KEYS.roomCode, app.roomCode);
    dom.joinView.classList.add("hidden");
    dom.gameView.classList.remove("hidden");
    dom.roomCode.value = app.roomCode;
    playSound("join");
    return;
  }

  if (message.type === "state") {
    const previousState = app.game;
    const previousRevision = previousState?.revision;
    app.game = message.state;
    app.game.receivedAt = performance.now();
    syncRackOrder();
    handleStateEffects(previousState, app.game);
    if (previousRevision && previousRevision !== app.game.revision) {
      discardPlacementsNoLongerInRack();
    }
    render();
    return;
  }

  if (message.type === "error") {
    playSound("error");
    showToast(message.message || "İşlem reddedildi.", "error");
  }
}

function render() {
  if (!app.game) {
    return;
  }

  renderHeader();
  renderSettings();
  renderBoard();
  renderPlayers();
  renderLog();
  renderRack();
  renderMovePreview();
  renderControls();
}

function renderHeader() {
  dom.roomBadge.textContent = `Oda ${app.game.code}`;
  dom.bagStatus.textContent = `Torba: ${app.game.bagCount}`;
  updateModeStatus();
  dom.dictionaryMode.textContent =
    app.game.dictionaryMode === "strict" ? `Sözlük: ${app.game.dictionaryCount}` : "Sözlük: esnek";
  renderSoundButton();
  updateTimerDisplay();

  if (app.game.status === "waiting") {
    dom.turnStatus.textContent = "Oyuncular bekleniyor";
  } else if (app.game.status === "finished") {
    dom.turnStatus.textContent = "Oyun bitti";
  } else if (isMyTurn()) {
    dom.turnStatus.textContent = "Sıra sende";
  } else {
    dom.turnStatus.textContent = `Sıra: ${app.game.currentPlayerName || "-"}`;
  }
}

function renderSettings() {
  const waiting = app.game.status === "waiting";
  const host = Boolean(app.game.me?.host);
  dom.settingsCard.hidden = !waiting;
  dom.settingsPanel.hidden = !waiting;
  dom.gameMode.value = String(app.game.settings.gameMode);
  dom.turnSeconds.value = String(app.game.settings.turnSeconds);
  dom.gameMode.disabled = !waiting || !host;
  dom.turnSeconds.disabled = !waiting || !host;
}

function renderBoard() {
  dom.board.style.setProperty("--board-cells", app.game.boardSize);
  const pendingByCell = new Map(app.pendingPlacements.map((placement) => [cellKey(placement.row, placement.col), placement]));
  const rackById = new Map((app.game.me?.rack || []).map((tile) => [tile.id, tile]));
  const lastPlayedCells = new Set((app.game.lastMoveCells || []).map((cell) => cellKey(cell.row, cell.col)));

  dom.board.replaceChildren(
    ...app.game.board.flatMap((row, rowIndex) =>
      row.map((cell, colIndex) => {
        const button = document.createElement("button");
        const pending = pendingByCell.get(cellKey(rowIndex, colIndex));
        const key = cellKey(rowIndex, colIndex);
        const tile = cell.tile || (pending ? pendingTile(rackById.get(pending.tileId), pending.letter) : null);
        button.type = "button";
        button.className = [
          "cell",
          cell.premium !== "NONE" ? `premium-${cell.premium}` : "",
          rowIndex === CENTER_INDEX && colIndex === CENTER_INDEX ? "center" : "",
          pending ? "has-pending" : "",
          app.dragTileId && !tile ? "drop-target" : "",
          app.dropFeedbackCells.has(key) ? "drop-feedback" : "",
          lastPlayedCells.has(key) ? "last-played" : "",
          tile ? "occupied" : ""
        ]
          .filter(Boolean)
          .join(" ");
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", boardCellLabel(rowIndex, colIndex, cell, tile, pending));
        button.addEventListener("click", () => handleBoardCellClick(rowIndex, colIndex));
        button.addEventListener("dragover", (event) => handleBoardDragOver(event, rowIndex, colIndex));
        button.addEventListener("drop", (event) => handleBoardDrop(event, rowIndex, colIndex));
        button.addEventListener("dragenter", () => button.classList.add("drag-over"));
        button.addEventListener("dragleave", () => button.classList.remove("drag-over"));

        if (tile) {
          button.append(tileElement(tile, pending ? "pending" : ""));
        } else {
          const label = document.createElement("span");
          label.className = "premium-label";
          label.textContent = premiumLabel(cell.premium);
          button.append(label);
        }

        return button;
      })
    )
  );
}

function renderPlayers() {
  const sorted = [...app.game.players].sort((left, right) => right.score - left.score);
  dom.playersList.replaceChildren(
    ...sorted.map((player, index) => {
      const item = document.createElement("li");
      item.className = `player-row ${player.id === app.game.currentPlayerId ? "current" : ""}`;

      const name = document.createElement("div");
      name.className = "player-name";
      const rank = document.createElement("span");
      rank.className = "player-rank";
      rank.textContent = String(index + 1);
      const dot = document.createElement("span");
      dot.className = "player-connection";
      dot.textContent = player.connected ? "●" : "○";
      dot.style.color = player.connected ? "var(--field)" : "var(--muted)";
      const label = document.createElement("span");
      label.textContent = `${player.name}${player.host ? " ★" : ""}`;
      name.append(rank, dot, label);

      const meta = document.createElement("div");
      meta.className = "player-meta";
      meta.textContent = `${player.score} puan · ${player.rackCount} taş`;

      item.append(name, meta);
      return item;
    })
  );
}

function renderLog() {
  const entries = [...app.game.moveLog].reverse();
  dom.moveLog.replaceChildren(
    ...entries.map((entry) => {
      const item = document.createElement("li");
      const parsed = parseLogEntry(entry.text);
      item.className = `move-log-item ${parsed.kind}`;

      const chip = document.createElement("span");
      chip.className = "log-chip";
      chip.textContent = parsed.label;

      const text = document.createElement("span");
      text.className = "log-text";
      text.textContent = parsed.text;

      item.append(chip, text);
      if (parsed.score !== null) {
        const score = document.createElement("strong");
        score.className = "log-score";
        score.textContent = `+${parsed.score}`;
        item.append(score);
      }
      return item;
    })
  );
}

function renderRack() {
  const pendingTileIds = new Set(app.pendingPlacements.map((placement) => placement.tileId));
  const rackById = new Map((app.game.me?.rack || []).map((tile) => [tile.id, tile]));
  const rackTiles = app.rackOrder
    .map((tileId) => rackById.get(tileId))
    .filter((tile) => tile && !pendingTileIds.has(tile.id));

  dom.rack.replaceChildren(
    ...rackTiles.map((tile) => {
      const button = document.createElement("button");
      button.type = "button";
      button.draggable = app.mode === "place" && app.game.status === "playing" && isMyTurn();
      button.className = [
        "rack-tile",
        app.dragTileId === tile.id ? "dragging" : "",
        app.selectedTileId === tile.id ? "selected" : "",
        app.exchangeIds.has(tile.id) ? "exchange-selected" : ""
      ]
        .filter(Boolean)
        .join(" ");
      button.setAttribute("aria-label", `${tile.letter} taşı, ${tile.value} puan`);
      button.addEventListener("click", () => handleRackTileClick(tile));
      button.addEventListener("dragstart", (event) => handleRackDragStart(event, tile));
      button.addEventListener("dragend", handleRackDragEnd);
      button.append(tileElement(tile));
      return button;
    })
  );
}

function renderMovePreview() {
  dom.movePreview.className = "move-preview";

  if (app.game.status === "waiting") {
    dom.movePreview.textContent = app.game.me?.host ? "Odayı başlatmaya hazır" : "Oda sahibinin başlatması bekleniyor";
    return;
  }

  if (app.game.status === "finished") {
    dom.movePreview.textContent = app.game.finishReason || "Oyun bitti";
    dom.movePreview.classList.add("ready");
    return;
  }

  if (!isMyTurn()) {
    dom.movePreview.textContent = `${app.game.currentPlayerName || "Oyuncu"} hamle yapıyor`;
    return;
  }

  if (app.mode === "exchange") {
    dom.movePreview.textContent =
      app.exchangeIds.size > 0 ? `${app.exchangeIds.size} taş değişim için seçildi` : "Değişim bekleniyor";
    dom.movePreview.classList.toggle("ready", app.exchangeIds.size > 0);
    return;
  }

  if (app.pendingPlacements.length === 0) {
    dom.movePreview.textContent = app.selectedTileId ? "Taş seçildi" : "Hamle bekleniyor";
    return;
  }

  const wordPreview = buildPendingWordPreview();
  dom.movePreview.textContent = `${app.pendingPlacements.length} taş hazır · ${wordPreview || "bağlantı hamlesi"}`;
  dom.movePreview.classList.add(wordPreview ? "ready" : "warn");
}

function renderControls() {
  const waiting = app.game.status === "waiting";
  const playing = app.game.status === "playing";
  const mine = isMyTurn();
  dom.startButton.hidden = !waiting || !app.game.me?.host;
  dom.submitButton.disabled = !playing || !mine || app.pendingPlacements.length === 0;
  dom.passButton.disabled = !playing || !mine;
  dom.exchangeButton.disabled = !playing || !mine || app.exchangeIds.size === 0;
  dom.shuffleRackButton.disabled = !playing || (app.game.me?.rack?.length || 0) < 2;
  dom.clearButton.disabled = app.pendingPlacements.length === 0 && app.exchangeIds.size === 0 && !app.selectedTileId;
  dom.placeModeButton.classList.toggle("selected", app.mode === "place");
  dom.exchangeModeButton.classList.toggle("selected", app.mode === "exchange");
}

function handleRackTileClick(tile) {
  if (app.game?.status !== "playing") {
    showToast("Oyun başlamadan taş seçilemez.");
    return;
  }
  if (!isMyTurn()) {
    showToast("Sıra sende değil.");
    return;
  }

  if (app.mode === "exchange") {
    if (app.exchangeIds.has(tile.id)) {
      app.exchangeIds.delete(tile.id);
    } else {
      app.exchangeIds.add(tile.id);
    }
    playSound("select");
    app.selectedTileId = null;
  } else {
    app.selectedTileId = app.selectedTileId === tile.id ? null : tile.id;
    playSound("select");
    app.exchangeIds.clear();
  }

  renderRack();
  renderControls();
}

function handleBoardCellClick(row, col) {
  const pendingIndex = app.pendingPlacements.findIndex((placement) => placement.row === row && placement.col === col);
  if (pendingIndex >= 0) {
    app.pendingPlacements.splice(pendingIndex, 1);
    playSound("soft");
    render();
    return;
  }

  if (app.mode !== "place" || !app.selectedTileId) {
    return;
  }

  placeTileAt(app.selectedTileId, row, col, "click");
}

function handleRackDragStart(event, tile) {
  if (app.mode !== "place" || app.game?.status !== "playing" || !isMyTurn()) {
    event.preventDefault();
    return;
  }

  app.dragTileId = tile.id;
  app.selectedTileId = tile.id;
  app.exchangeIds.clear();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", tile.id);
  playSound("select");
  render();
}

function handleRackDragEnd() {
  app.dragTileId = null;
  render();
}

function handleBoardDragOver(event, row, col) {
  if (!canPlaceOnCell(row, col)) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function handleBoardDrop(event, row, col) {
  event.preventDefault();
  const tileId = event.dataTransfer.getData("text/plain") || app.dragTileId;
  app.dragTileId = null;
  if (tileId) {
    placeTileAt(tileId, row, col, "drop");
  } else {
    render();
  }
}

function placeTileAt(tileId, row, col, source) {
  if (!isMyTurn()) {
    showToast("Sıra sende değil.");
    return false;
  }
  if (!canPlaceOnCell(row, col)) {
    showToast(app.game.board[row][col].tile ? "Bu kare dolu." : "Bu kareye zaten taş koydun.");
    return false;
  }

  const tile = app.game.me.rack.find((candidate) => candidate.id === tileId);
  if (!tile) {
    app.selectedTileId = null;
    render();
    return false;
  }

  let letter = tile.letter;
  if (tile.blank) {
    letter = normalizeLetter(window.prompt("Boş taş için harf gir:", "") || "");
    if (!letter) {
      showToast("Boş taş için harf seçilmedi.");
      return false;
    }
  }

  app.pendingPlacements.push({
    row,
    col,
    tileId: tile.id,
    letter
  });
  markDropFeedback(row, col);
  playSound(source === "drop" ? "drop" : "place");
  app.selectedTileId = null;
  render();
  return true;
}

function canPlaceOnCell(row, col) {
  return Boolean(
    app.game &&
      row >= 0 &&
      col >= 0 &&
      row < app.game.boardSize &&
      col < app.game.boardSize &&
      !app.game.board[row][col].tile &&
      !app.pendingPlacements.some((placement) => placement.row === row && placement.col === col)
  );
}

function markDropFeedback(row, col) {
  const key = cellKey(row, col);
  app.dropFeedbackCells.add(key);
  window.setTimeout(() => {
    app.dropFeedbackCells.delete(key);
    render();
  }, 420);
}

function submitMove() {
  if (app.pendingPlacements.length === 0) {
    return;
  }
  send({
    type: "move",
    placements: app.pendingPlacements.map((placement) => ({ ...placement }))
  });
  playSound("submit");
}

function exchangeSelectedTiles() {
  if (app.exchangeIds.size === 0) {
    return;
  }
  send({
    type: "exchange",
    tileIds: [...app.exchangeIds]
  });
  playSound("submit");
  app.exchangeIds.clear();
  app.selectedTileId = null;
  render();
}

function setMode(mode) {
  app.mode = mode;
  app.selectedTileId = null;
  playSound("soft");
  if (mode === "place") {
    app.exchangeIds.clear();
  } else {
    app.pendingPlacements = [];
  }
  render();
}

function clearPending() {
  app.selectedTileId = null;
  app.exchangeIds.clear();
  app.pendingPlacements = [];
  playSound("soft");
  render();
}

function discardPlacementsNoLongerInRack() {
  const rackIds = new Set((app.game?.me?.rack || []).map((tile) => tile.id));
  app.pendingPlacements = app.pendingPlacements.filter((placement) => rackIds.has(placement.tileId));
  if (app.selectedTileId && !rackIds.has(app.selectedTileId)) {
    app.selectedTileId = null;
  }
  for (const tileId of app.exchangeIds) {
    if (!rackIds.has(tileId)) {
      app.exchangeIds.delete(tileId);
    }
  }
}

function syncRackOrder() {
  const rackIds = (app.game?.me?.rack || []).map((tile) => tile.id);
  const rackIdSet = new Set(rackIds);
  const kept = app.rackOrder.filter((tileId) => rackIdSet.has(tileId));
  const missing = rackIds.filter((tileId) => !kept.includes(tileId));
  app.rackOrder = [...kept, ...missing];
}

function shuffleRack() {
  if (!app.game?.me?.rack || app.game.me.rack.length < 2) {
    return;
  }

  const pendingTileIds = new Set(app.pendingPlacements.map((placement) => placement.tileId));
  const fixed = app.rackOrder.filter((tileId) => pendingTileIds.has(tileId));
  const movable = app.rackOrder.filter((tileId) => !pendingTileIds.has(tileId));
  for (let index = movable.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [movable[index], movable[other]] = [movable[other], movable[index]];
  }
  app.rackOrder = [...movable, ...fixed];
  playSound("shuffle");
  renderRack();
  renderControls();
}

function handleStateEffects(previous, next) {
  if (!previous) {
    return;
  }

  const previousLogId = previous.moveLog.at(-1)?.id;
  const latestLog = next.moveLog.at(-1);
  const nextLogId = latestLog?.id;
  if (nextLogId && nextLogId !== previousLogId) {
    const score = scoreFromLogText(latestLog.text);
    if (score !== null) {
      playScoreSound(score);
    } else {
      playSound("move");
    }
  }

  if (previous.status !== next.status) {
    if (next.status === "playing") {
      playSound("start");
    } else if (next.status === "finished") {
      playSound("finish");
    }
  }

  if (previous.currentPlayerId !== next.currentPlayerId && next.currentPlayerId === next.me?.id) {
    playSound("turn");
  }
}

async function copyRoomCode() {
  const code = app.game?.code || app.roomCode;
  if (!code) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    playSound("soft");
    showToast("Oda kodu kopyalandı.");
  } catch {
    showToast(`Oda kodu: ${code}`);
  }
}

function sendSettings() {
  if (!app.game || app.game.status !== "waiting" || !app.game.me?.host) {
    return;
  }

  send({
    type: "settings",
    gameMode: dom.gameMode.value,
    turnSeconds: Number(dom.turnSeconds.value)
  });
}

function updateModeStatus() {
  if (!app.game) {
    dom.goalStatus.textContent = "Mod: -";
    dom.goalStatus.classList.remove("danger");
    return;
  }

  const mode = app.game.settings?.gameMode || "classic";
  const label = gameModeLabel(mode);
  const scoreTarget = gameModeScoreTarget(mode);
  const gameDurationMs = gameModeDurationMs(mode);
  dom.goalStatus.classList.remove("danger");

  if (app.game.status === "playing" && gameDurationMs > 0 && app.game.gameRemainingMs !== null) {
    const elapsed = performance.now() - (app.game.receivedAt || performance.now());
    const remainingMs = Math.max(0, app.game.gameRemainingMs - elapsed);
    dom.goalStatus.textContent = `${label}: ${formatClock(remainingMs)}`;
    dom.goalStatus.classList.toggle("danger", remainingMs <= 30_000);
    return;
  }

  if (scoreTarget > 0) {
    const leadingScore = Math.max(0, ...(app.game.players || []).map((player) => player.score));
    dom.goalStatus.textContent = `Hedef: ${leadingScore}/${scoreTarget}`;
    return;
  }

  dom.goalStatus.textContent = `Mod: ${label}`;
}

function updateTimerDisplay() {
  updateModeStatus();

  if (!app.game || app.game.status !== "playing" || app.game.turnRemainingMs === null) {
    dom.timerStatus.textContent = `Süre: --`;
    dom.timerStatus.classList.remove("danger");
    return;
  }

  const elapsed = performance.now() - (app.game.receivedAt || performance.now());
  const remainingMs = Math.max(0, app.game.turnRemainingMs - elapsed);
  const seconds = Math.ceil(remainingMs / 1000);
  dom.timerStatus.textContent = `Süre: ${seconds}s`;
  dom.timerStatus.classList.toggle("danger", seconds <= 10);
}

function formatClock(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toggleSound() {
  app.audio.enabled = !app.audio.enabled;
  localStorage.setItem(STORAGE_KEYS.sound, app.audio.enabled ? "1" : "0");
  renderSoundButton();
  if (app.audio.enabled) {
    unlockAudioOnce();
    playSound("turn");
  }
}

function renderSoundButton() {
  dom.soundButton.textContent = app.audio.enabled ? "Ses açık" : "Sessiz";
  dom.soundButton.setAttribute("aria-pressed", String(app.audio.enabled));
}

function unlockAudioOnce() {
  if (!app.audio.enabled) {
    return;
  }
  const context = ensureAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }
}

function playSound(kind) {
  if (!app.audio.enabled) {
    return;
  }

  const context = ensureAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  const patterns = {
    join: [
      [330, 0.07, 0, 0.025],
      [495, 0.08, 0.07, 0.025]
    ],
    select: [[520, 0.045, 0, 0.018]],
    soft: [[360, 0.04, 0, 0.014]],
    shuffle: [
      [460, 0.035, 0, 0.012],
      [520, 0.035, 0.035, 0.012],
      [430, 0.045, 0.07, 0.014]
    ],
    place: [
      [420, 0.05, 0, 0.018],
      [630, 0.06, 0.045, 0.02]
    ],
    drop: [
      [300, 0.035, 0, 0.018],
      [620, 0.08, 0.04, 0.024]
    ],
    submit: [[560, 0.08, 0, 0.018]],
    move: [
      [392, 0.055, 0, 0.018],
      [523, 0.055, 0.055, 0.018],
      [659, 0.08, 0.11, 0.018]
    ],
    start: [
      [294, 0.06, 0, 0.02],
      [440, 0.07, 0.06, 0.022],
      [587, 0.09, 0.13, 0.024]
    ],
    turn: [
      [660, 0.055, 0, 0.02],
      [880, 0.08, 0.06, 0.018]
    ],
    finish: [
      [523, 0.07, 0, 0.022],
      [659, 0.07, 0.08, 0.022],
      [784, 0.14, 0.16, 0.022]
    ],
    error: [
      [180, 0.08, 0, 0.024],
      [125, 0.11, 0.075, 0.022]
    ]
  };

  const now = context.currentTime + 0.01;
  for (const [frequency, duration, delay, volume] of patterns[kind] || patterns.soft) {
    scheduleTone(context, frequency, duration, now + delay, volume);
  }
}

function ensureAudioContext() {
  if (app.audio.context) {
    return app.audio.context;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return null;
  }
  app.audio.context = new AudioContext();
  return app.audio.context;
}

function scheduleTone(context, frequency, duration, startTime, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playScoreSound(score) {
  if (!app.audio.enabled) {
    return;
  }

  const context = ensureAudioContext();
  if (!context) {
    return;
  }
  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  const level = score >= 40 ? 4 : score >= 25 ? 3 : score >= 12 ? 2 : 1;
  const patterns = {
    1: [
      [440, 0.06, 0, 0.02],
      [554, 0.08, 0.055, 0.02]
    ],
    2: [
      [392, 0.055, 0, 0.022],
      [523, 0.065, 0.055, 0.024],
      [659, 0.09, 0.125, 0.026]
    ],
    3: [
      [392, 0.06, 0, 0.024],
      [523, 0.065, 0.055, 0.026],
      [659, 0.07, 0.12, 0.028],
      [784, 0.13, 0.195, 0.028]
    ],
    4: [
      [330, 0.055, 0, 0.026],
      [494, 0.06, 0.05, 0.028],
      [659, 0.07, 0.11, 0.03],
      [880, 0.16, 0.19, 0.032],
      [1175, 0.12, 0.29, 0.022]
    ]
  };

  const now = context.currentTime + 0.01;
  for (const [frequency, duration, delay, volume] of patterns[level]) {
    scheduleTone(context, frequency, duration, now + delay, volume);
  }
}

function buildPendingWordPreview() {
  if (!app.game || app.pendingPlacements.length === 0) {
    return "";
  }

  const direction = inferPendingDirection();
  if (!direction) {
    return "";
  }

  const first = app.pendingPlacements[0];
  const rowStep = direction === "V" ? 1 : 0;
  const colStep = direction === "H" ? 1 : 0;
  let row = first.row;
  let col = first.col;

  while (previewLetterAt(row - rowStep, col - colStep)) {
    row -= rowStep;
    col -= colStep;
  }

  const letters = [];
  while (true) {
    const letter = previewLetterAt(row, col);
    if (!letter) {
      break;
    }
    letters.push(letter);
    row += rowStep;
    col += colStep;
  }

  return letters.length > 1 ? letters.join("") : app.pendingPlacements.map((placement) => previewLetterAt(placement.row, placement.col)).join("");
}

function inferPendingDirection() {
  if (app.pendingPlacements.length > 1) {
    const sameRow = app.pendingPlacements.every((placement) => placement.row === app.pendingPlacements[0].row);
    const sameCol = app.pendingPlacements.every((placement) => placement.col === app.pendingPlacements[0].col);
    if (sameRow) {
      return "H";
    }
    if (sameCol) {
      return "V";
    }
    return "";
  }

  const [{ row, col }] = app.pendingPlacements;
  if (previewLetterAt(row, col - 1) || previewLetterAt(row, col + 1)) {
    return "H";
  }
  if (previewLetterAt(row - 1, col) || previewLetterAt(row + 1, col)) {
    return "V";
  }
  return "H";
}

function previewLetterAt(row, col) {
  if (!app.game || row < 0 || col < 0 || row >= app.game.boardSize || col >= app.game.boardSize) {
    return "";
  }

  const pending = app.pendingPlacements.find((placement) => placement.row === row && placement.col === col);
  if (pending) {
    return pending.letter;
  }

  return app.game.board[row]?.[col]?.tile?.letter || "";
}

function parseLogEntry(text) {
  const score = scoreFromLogText(text);
  if (score !== null) {
    const [playerPart, rest = text] = text.split(":");
    const words = rest.replace(/\([^)]*\)/g, "").trim();
    return {
      kind: "score",
      label: "Kelime",
      score,
      text: `${playerPart.trim()} · ${words}`
    };
  }

  if (text.includes("pas")) {
    return { kind: "pass", label: "Pas", score: null, text };
  }
  if (text.includes("Ayarlar")) {
    return { kind: "settings", label: "Ayar", score: null, text };
  }
  if (text.includes("başladı") || text.includes("baÅŸlad")) {
    return { kind: "system", label: "Oyun", score: null, text };
  }
  if (text.includes("bitti")) {
    return { kind: "finish", label: "Bitiş", score: null, text };
  }

  return { kind: "system", label: "Bilgi", score: null, text };
}

function scoreFromLogText(text) {
  const match = String(text || "").match(/\((\d+)\s+puan/);
  return match ? Number(match[1]) : null;
}

function send(payload) {
  if (!app.socket || app.socket.readyState !== WebSocket.OPEN) {
    showToast("Sunucu bağlantısı hazır değil.");
    return;
  }
  app.socket.send(JSON.stringify(payload));
}

function isMyTurn() {
  return Boolean(app.game?.me && app.game.currentPlayerId === app.game.me.id);
}

function updateConnectionStatus(text, connected) {
  dom.connectionStatus.textContent = text;
  dom.connectionStatus.style.borderColor = connected ? "var(--field)" : "var(--rose)";
  dom.connectionStatus.style.color = connected ? "var(--field-dark)" : "var(--rose)";
}

function tileElement(tile, extraClass = "") {
  const tileNode = document.createElement("span");
  tileNode.className = `tile ${extraClass}`.trim();
  const letter = document.createElement("span");
  letter.className = "tile-letter";
  letter.textContent = tile.letter;
  const value = document.createElement("span");
  value.className = "tile-value";
  value.textContent = tile.value;
  tileNode.append(letter, value);
  return tileNode;
}

function pendingTile(tile, letter) {
  if (!tile) {
    return null;
  }
  return {
    ...tile,
    letter: tile.blank ? letter : tile.letter,
    value: tile.blank ? 0 : tile.value
  };
}

function boardCellLabel(row, col, cell, tile, pending) {
  if (tile) {
    return `${row + 1}. satır ${col + 1}. sütun, ${pending ? "geçici" : "tahtada"} ${tile.letter}`;
  }
  const premium = premiumLabel(cell.premium);
  return `${row + 1}. satır ${col + 1}. sütun${premium ? `, ${premium}` : ""}`;
}

function cleanRoomCode(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
}

function cellKey(row, col) {
  return `${row},${col}`;
}

function showToast(message, tone = "info") {
  dom.toast.textContent = message;
  dom.toast.classList.toggle("error", tone === "error");
  dom.toast.classList.add("visible");
  clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("visible");
    dom.toast.classList.remove("error");
  }, 3200);
}
