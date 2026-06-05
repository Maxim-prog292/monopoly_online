import { tokenOptions } from "./data.js";
import {
  buildHouse,
  buyPendingProperty,
  acceptTrade,
  createGame,
  declareBankruptcy,
  getAuctionMinBid,
  getCurrentAuctionBidderId,
  getRequiredActionPlayerId,
  mortgageProperty,
  passAuctionBid,
  placeAuctionBid,
  proposeTrade,
  redeemProperty,
  rejectTrade,
  rollDiceAndProcessTurn,
  sellProperty,
  sellHouse,
  skipPendingProperty,
} from "./gameLogic.js";
import { render } from "./render.js";

const STORAGE_KEYS = {
  playerId: "monopolyPlayerId",
  roomCode: "monopolyRoomCode",
  playerName: "monopolyPlayerName",
  boardViewMode: "monopolyBoardViewMode",
};

let state = null;
let socket = null;
let roomCode = null;
let playerId = getPersistentPlayerId();
let isOnline = false;
let roomChat = [];
let selectedCellId = null;
let propertyDockMode = "mine";
let sidePanelTab = "turn";
let isSidebarCollapsed = false;
const typingPlayers = new Map();
let typingStopTimer = null;
const moveAnimation = {
  timer: null,
  visualPositions: null,
  path: [],
  completedPath: [],
  targetPosition: null,
  targetTimer: null,
};
const boardView = {
  mode: localStorage.getItem(STORAGE_KEYS.boardViewMode) === "3d" ? "3d" : "2d",
  rotateX: 58,
  rotateZ: -36,
  scale: 1,
  dragging: false,
  pointerId: null,
  lastX: 0,
  lastY: 0,
  moved: false,
  activePointers: new Map(),
  pinchStartDistance: 0,
  pinchStartScale: 1,
};

const elements = {
  startScreen: document.getElementById("startScreen"),
  modeSelect: document.getElementById("modeSelect"),
  localPanel: document.getElementById("localPanel"),
  onlinePanel: document.getElementById("onlinePanel"),
  localModeBtn: document.getElementById("localModeBtn"),
  onlineModeBtn: document.getElementById("onlineModeBtn"),
  backToModesFromLocalBtn: document.getElementById("backToModesFromLocalBtn"),
  gameScreen: document.getElementById("gameScreen"),
  playersCount: document.getElementById("playersCount"),
  localStartingMoney: document.getElementById("localStartingMoney"),
  localPassStartBonus: document.getElementById("localPassStartBonus"),
  localAuctionsEnabled: document.getElementById("localAuctionsEnabled"),
  startGameBtn: document.getElementById("startGameBtn"),
  board: document.getElementById("board"),
  playersStrip: document.getElementById("playersStrip"),
  propertyDock: document.getElementById("propertyDock"),
  sideTabs: document.getElementById("sideTabs"),
  boardMode2dBtn: document.getElementById("boardMode2dBtn"),
  boardMode3dBtn: document.getElementById("boardMode3dBtn"),
  resetBoardViewBtn: document.getElementById("resetBoardViewBtn"),
  boardZoomInput: document.getElementById("boardZoomInput"),
  playersList: document.getElementById("playersList"),
  currentPlayerName: document.getElementById("currentPlayerName"),
  diceResult: document.getElementById("diceResult"),
  turnTimer: document.getElementById("turnTimer"),
  rollDiceBtn: document.getElementById("rollDiceBtn"),
  skipDisconnectedBtn: document.getElementById("skipDisconnectedBtn"),
  cellInfo: document.getElementById("cellInfo"),
  propertyActions: document.getElementById("propertyActions"),
  buyPropertyBtn: document.getElementById("buyPropertyBtn"),
  skipPropertyBtn: document.getElementById("skipPropertyBtn"),
  sidebarToggleBtn: document.getElementById("sidebarToggleBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  gameLog: document.getElementById("gameLog"),
  chatBox: document.getElementById("chatBox"),
};

createOnlineUI();

elements.localModeBtn.addEventListener("click", showLocalMode);
elements.onlineModeBtn.addEventListener("click", showOnlineMode);
elements.backToModesFromLocalBtn.addEventListener("click", showModeSelect);
elements.startGameBtn.addEventListener("click", startLocalGame);
elements.boardMode2dBtn.addEventListener("click", () => setBoardMode("2d"));
elements.boardMode3dBtn.addEventListener("click", () => setBoardMode("3d"));
elements.resetBoardViewBtn.addEventListener("click", resetBoardView);
elements.boardZoomInput.addEventListener("input", handleBoardZoomInput);
elements.board.addEventListener("pointerdown", handleBoardPointerDown);
elements.board.addEventListener("pointermove", handleBoardPointerMove);
elements.board.addEventListener("pointerup", handleBoardPointerEnd);
elements.board.addEventListener("pointercancel", handleBoardPointerEnd);
elements.board.addEventListener("wheel", handleBoardWheel, { passive: false });
elements.board.addEventListener("click", handleBoardCellClick);
elements.board.addEventListener("dblclick", handleBoardDoubleClick);
elements.rollDiceBtn.addEventListener("click", handleRollDice);
elements.buyPropertyBtn.addEventListener("click", handleBuyProperty);
elements.skipPropertyBtn.addEventListener("click", handleSkipProperty);
elements.playersList.addEventListener("click", handleBuildHouseClick);
elements.playersList.addEventListener("click", handleAssetActionClick);
elements.playersList.addEventListener("click", handleTradeActionClick);
elements.propertyDock.addEventListener("click", handleBuildHouseClick);
elements.propertyDock.addEventListener("click", handleAssetActionClick);
elements.propertyDock.addEventListener("click", handleTradeActionClick);
elements.propertyDock.addEventListener("click", handlePropertyCardClick);
elements.propertyDock.addEventListener("click", handlePropertyDockModeClick);
elements.cellInfo.addEventListener("click", handleTradeActionClick);
elements.cellInfo.addEventListener("click", handleAuctionActionClick);
elements.sideTabs.addEventListener("click", handleSideTabClick);
elements.sidebarToggleBtn.addEventListener("click", toggleSidebar);
elements.startScreen.addEventListener("click", handleLobbyClick);
elements.chatBox.addEventListener("submit", handleSendChatMessage);
elements.chatBox.addEventListener("input", handleChatTypingInput);
elements.startScreen.addEventListener("submit", handleSendChatMessage);
elements.startScreen.addEventListener("input", handleChatTypingInput);
elements.startScreen.addEventListener("change", handleRoomSettingsChange);
elements.fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
elements.newGameBtn.addEventListener("click", handleNewGame);
elements.skipDisconnectedBtn.addEventListener("click", handleSkipDisconnectedPlayer);
setInterval(updateTurnTimer, 1000);
applyBoardView();

function setBoardMode(mode) {
  boardView.mode = mode;
  boardView.dragging = false;
  boardView.pointerId = null;
  boardView.activePointers.clear();
  boardView.pinchStartDistance = 0;
  localStorage.setItem(STORAGE_KEYS.boardViewMode, mode);
  applyBoardView();
}

function resetBoardView() {
  boardView.rotateX = 58;
  boardView.rotateZ = -36;
  boardView.scale = 1;
  applyBoardView();
}

function handleBoardZoomInput(event) {
  boardView.scale = Number(event.target.value) / 100;
  setBoardMode("3d");
  applyBoardView();
}

function handleBoardWheel(event) {
  if (boardView.mode !== "3d") return;

  event.preventDefault();
  const nextScale = boardView.scale + (event.deltaY > 0 ? -0.06 : 0.06);
  boardView.scale = clampBoardScale(nextScale);
  applyBoardView();
}

function handleBoardPointerDown(event) {
  if (boardView.mode !== "3d" || event.button > 0) return;

  boardView.activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  });
  boardView.dragging = true;
  boardView.pointerId = event.pointerId;
  boardView.lastX = event.clientX;
  boardView.lastY = event.clientY;
  boardView.moved = false;
  if (boardView.activePointers.size === 2) {
    boardView.pinchStartDistance = getBoardPointerDistance();
    boardView.pinchStartScale = boardView.scale;
  }
  elements.board.setPointerCapture?.(event.pointerId);
}

function handleBoardPointerMove(event) {
  if (!boardView.dragging || !boardView.activePointers.has(event.pointerId)) return;

  boardView.activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
  });

  if (boardView.activePointers.size >= 2) {
    const distance = getBoardPointerDistance();
    if (distance > 0 && boardView.pinchStartDistance > 0) {
      boardView.scale = clampBoardScale(
        boardView.pinchStartScale * (distance / boardView.pinchStartDistance),
      );
      boardView.moved = true;
      applyBoardView();
    }
    return;
  }

  if (boardView.pointerId !== event.pointerId) return;

  const dx = event.clientX - boardView.lastX;
  const dy = event.clientY - boardView.lastY;
  boardView.lastX = event.clientX;
  boardView.lastY = event.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    boardView.moved = true;
  }
  boardView.rotateZ += dx * 0.35;
  boardView.rotateX = Math.min(72, Math.max(36, boardView.rotateX - dy * 0.25));
  applyBoardView();
}

function handleBoardPointerEnd(event) {
  boardView.activePointers.delete(event.pointerId);
  elements.board.releasePointerCapture?.(event.pointerId);

  if (boardView.activePointers.size === 1) {
    const [nextPointerId, point] = boardView.activePointers.entries().next().value;
    boardView.pointerId = nextPointerId;
    boardView.lastX = point.x;
    boardView.lastY = point.y;
    boardView.pinchStartDistance = 0;
    return;
  }

  if (boardView.activePointers.size === 0) {
    boardView.dragging = false;
    boardView.pointerId = null;
    boardView.pinchStartDistance = 0;
  }
}

function handleBoardCellClick(event) {
  if (!state) return;

  if (boardView.moved) {
    boardView.moved = false;
    return;
  }

  const cell = event.target.closest(".cell:not(.empty)");
  if (!cell || !elements.board.contains(cell)) return;

  selectCell(cell.dataset.cellId || null);
}

function handlePropertyCardClick(event) {
  if (event.target.closest("button")) return;

  const card = event.target.closest(".property-card");
  if (!card || !elements.propertyDock.contains(card)) return;

  selectCell(card.dataset.cellId || null);
}

function handlePropertyDockModeClick(event) {
  const button = event.target.closest("[data-property-dock-mode]");
  if (!button || !elements.propertyDock.contains(button)) return;

  propertyDockMode = button.dataset.propertyDockMode === "all" ? "all" : "mine";
  renderGame();
}

function handleSideTabClick(event) {
  const button = event.target.closest("[data-side-tab]");
  if (!button || !elements.sideTabs.contains(button)) return;

  sidePanelTab = button.dataset.sideTab || "turn";
  applySidePanelTab();
}

function applySidePanelTab() {
  document.querySelectorAll("[data-side-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sideTab === sidePanelTab);
  });

  document.querySelectorAll("[data-side-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.sidePanel === sidePanelTab);
  });
}

function toggleSidebar() {
  isSidebarCollapsed = !isSidebarCollapsed;
  sidePanelTab = "turn";
  applySidebarState();
  applySidePanelTab();
}

function applySidebarState() {
  elements.gameScreen.classList.toggle("sidebar-collapsed", isSidebarCollapsed);
  elements.sidebarToggleBtn.textContent = isSidebarCollapsed ? "Развернуть" : "Свернуть";
}

function selectCell(cellId) {
  selectedCellId = cellId;
  sidePanelTab = "turn";
  renderGame();
  scrollSelectedPropertyCardIntoView();
}

function scrollSelectedPropertyCardIntoView() {
  if (!selectedCellId) return;

  const escapedCellId = window.CSS?.escape ? CSS.escape(selectedCellId) : selectedCellId.replaceAll('"', '\\"');
  const card = elements.propertyDock.querySelector(`.property-card[data-cell-id="${escapedCellId}"]`);
  if (!card) return;

  card.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center",
  });
}

function handleBoardDoubleClick() {
  if (boardView.mode !== "3d") return;
  resetBoardView();
}

function applyBoardView() {
  const is3d = boardView.mode === "3d";

  elements.gameScreen.classList.toggle("board-mode-3d", is3d);
  elements.boardMode2dBtn.classList.toggle("active", !is3d);
  elements.boardMode3dBtn.classList.toggle("active", is3d);
  elements.boardZoomInput.value = String(Math.round(boardView.scale * 100));
  elements.board.style.setProperty("--board-rotate-x", `${is3d ? boardView.rotateX : 0}deg`);
  elements.board.style.setProperty("--board-rotate-z", `${is3d ? boardView.rotateZ : 0}deg`);
  elements.board.style.setProperty("--board-scale", String(is3d ? boardView.scale : 1));
}

function clampBoardScale(value) {
  return Math.min(1.5, Math.max(0.8, value));
}

function getBoardPointerDistance() {
  const points = Array.from(boardView.activePointers.values());
  if (points.length < 2) return 0;

  const dx = points[0].x - points[1].x;
  const dy = points[0].y - points[1].y;
  return Math.hypot(dx, dy);
}

function createOnlineUI() {
  const onlineBox = document.createElement("div");
  onlineBox.id = "onlineBox";
  onlineBox.className = "online-box";

  const savedName = localStorage.getItem(STORAGE_KEYS.playerName) ?? "";
  const queryRoomCode = getRoomCodeFromUrl();
  const savedRoomCode = queryRoomCode || localStorage.getItem(STORAGE_KEYS.roomCode) || "";

  onlineBox.innerHTML = `
    <div class="panel-top">
      <h2>Онлайн игра</h2>
      <button id="backToModesFromOnlineBtn" type="button" class="secondary-btn small-btn">Назад</button>
    </div>

    <div id="reconnectBox" class="reconnect-box hidden"></div>

    <div id="onlineSetup" class="online-setup">
      <input id="playerNameInput" placeholder="Ваше имя" maxlength="16" value="${escapeAttribute(savedName)}" />

      <button id="createRoomBtn">Создать комнату</button>

      <div class="join-row">
        <input id="roomCodeInput" placeholder="Код комнаты" maxlength="4" value="${escapeAttribute(savedRoomCode)}" />
        <button id="joinRoomBtn">Войти</button>
      </div>
    </div>

    <div id="onlineLobby" class="online-lobby hidden">
      <div id="lobbyInfo" class="lobby-info"></div>

      <div id="roomSettingsBox" class="room-settings-box hidden"></div>

      <div id="lobbyChatBox" class="chat-box hidden"></div>

      <div id="tokenPicker" class="token-picker hidden"></div>

      <div class="lobby-actions">
        <button id="readyBtn" class="hidden">Готов</button>
        <button id="startOnlineBtn" class="hidden">Начать онлайн-игру</button>
        <button id="leaveRoomBtn" type="button" class="secondary-btn hidden">Покинуть комнату</button>
      </div>
    </div>
  `;

  elements.onlinePanel.appendChild(onlineBox);

  document.getElementById("backToModesFromOnlineBtn").addEventListener("click", showModeSelect);
  document.getElementById("createRoomBtn").addEventListener("click", createRoom);
  document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);
  document.getElementById("readyBtn").addEventListener("click", toggleReady);
  document.getElementById("startOnlineBtn").addEventListener("click", startOnlineGame);
  document.getElementById("leaveRoomBtn").addEventListener("click", leaveRoom);
  document.getElementById("playerNameInput").addEventListener("input", (event) => {
    localStorage.setItem(STORAGE_KEYS.playerName, event.target.value.trim());
  });

  updateReconnectBox();

  if (queryRoomCode) {
    document.getElementById("roomCodeInput").value = queryRoomCode;
    showOnlineMode();
  } else {
    showModeSelect();
  }
}

function showModeSelect() {
  elements.modeSelect.classList.remove("hidden");
  elements.localPanel.classList.add("hidden");
  elements.onlinePanel.classList.add("hidden");
}

function showLocalMode() {
  elements.modeSelect.classList.add("hidden");
  elements.localPanel.classList.remove("hidden");
  elements.onlinePanel.classList.add("hidden");
}

function showOnlineMode() {
  elements.modeSelect.classList.add("hidden");
  elements.localPanel.classList.add("hidden");
  elements.onlinePanel.classList.remove("hidden");
}

function connectSocket() {
  if (socket) return;

  socket = io();

  socket.on("connect", () => {
    const savedRoomCode = localStorage.getItem(STORAGE_KEYS.roomCode);
    const savedPlayerId = localStorage.getItem(STORAGE_KEYS.playerId);

    if (savedRoomCode && savedPlayerId) {
      socket.emit("reconnectRoom", {
        roomCode: savedRoomCode,
        playerId: savedPlayerId,
      });
    }
  });

  socket.on("roomCreated", (data) => {
    applyOnlineIdentity(data.roomCode, data.playerId);
    roomChat = data.room?.chat ?? [];
    renderLobby(data.room);
  });

  socket.on("roomJoined", (data) => {
    applyOnlineIdentity(data.roomCode, data.playerId);
    roomChat = data.room?.chat ?? [];
    renderLobby(data.room);
  });

  socket.on("roomReconnected", (data) => {
    applyOnlineIdentity(data.roomCode, data.playerId);
    elements.startScreen.classList.remove("hidden");
    elements.gameScreen.classList.add("hidden");
    showOnlineMode();
    roomChat = data.room?.chat ?? [];
    renderLobby(data.room);
  });

  socket.on("gameStarted", (serverState) => {
    state = serverState;
    roomChat = [];
    selectedCellId = null;
    typingPlayers.clear();
    elements.startScreen.classList.add("hidden");
    elements.gameScreen.classList.remove("hidden");
    renderGame();
  });

  socket.on("gameReconnected", (data) => {
    applyOnlineIdentity(data.roomCode, data.playerId);
    state = data.state;
    roomChat = data.room?.chat ?? [];
    selectedCellId = null;
    typingPlayers.clear();
    elements.startScreen.classList.add("hidden");
    elements.gameScreen.classList.remove("hidden");
    renderGame();
  });

  socket.on("returnToLobby", (data) => {
    applyOnlineIdentity(data.roomCode, playerId);
    state = null;
    selectedCellId = null;
    roomChat = data.room?.chat ?? roomChat;
    elements.gameScreen.classList.add("hidden");
    elements.startScreen.classList.remove("hidden");
    showOnlineMode();
    renderLobby(data.room);
  });

  socket.on("roomUpdate", (room) => {
    if (room?.chat) {
      roomChat = room.chat;
      renderChat();
    }
    renderLobby(room);
  });

  socket.on("gameUpdate", (serverState) => {
    const previousState = captureMoveState(state);
    state = serverState;
    maybeAnimateMove(previousState, state);
    renderGame();
  });

  socket.on("chatUpdate", (chat) => {
    roomChat = Array.isArray(chat) ? chat : [];
    typingPlayers.clear();
    renderChat();
  });

  socket.on("chatTypingUpdate", ({ playerId: typingPlayerId, playerName, isTyping }) => {
    if (!typingPlayerId || typingPlayerId === playerId) return;

    if (isTyping) {
      typingPlayers.set(typingPlayerId, {
        playerName: playerName || "Игрок",
        expiresAt: Date.now() + 2500,
      });
    } else {
      typingPlayers.delete(typingPlayerId);
    }

    renderChat();
  });

  socket.on("tradeOffered", ({ state: serverState, message }) => {
    state = serverState;
    renderGame();
    alert(message);
  });

  socket.on("reconnectFailed", (message) => {
    alert(message);
    clearSavedRoom();
  });

  socket.on("errorMessage", (message) => {
    alert(message);
  });
}

function createRoom() {
  connectSocket();

  const name = getPlayerName();
  localStorage.setItem(STORAGE_KEYS.playerName, name);

  socket.emit("createRoom", {
    name,
    playerId,
  });
}

function joinRoom() {
  connectSocket();

  const name = getPlayerName();
  const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();

  if (!code) {
    alert("Введите код комнаты.");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.playerName, name);

  socket.emit("joinRoom", {
    roomCode: code,
    name,
    playerId,
  });
}

function reconnectToSavedRoom() {
  const savedRoomCode = localStorage.getItem(STORAGE_KEYS.roomCode);

  if (!savedRoomCode) {
    alert("Сохранённая комната не найдена.");
    return;
  }

  connectSocket();

  socket.emit("reconnectRoom", {
    roomCode: savedRoomCode,
    playerId,
  });
}

function renderLobby(room) {
  if (!room || room.started) return;

  showOnlineMode();
  document.getElementById("onlineBox")?.classList.add("is-in-lobby");
  document.getElementById("onlineSetup")?.classList.add("hidden");
  document.getElementById("onlineLobby")?.classList.remove("hidden");

  const lobbyInfo = document.getElementById("lobbyInfo");
  const roomSettingsBox = document.getElementById("roomSettingsBox");
  const tokenPicker = document.getElementById("tokenPicker");
  const readyBtn = document.getElementById("readyBtn");
  const startOnlineBtn = document.getElementById("startOnlineBtn");
  const leaveRoomBtn = document.getElementById("leaveRoomBtn");

  const activePlayers = room.players.filter((player) => !player.disconnected);
  const currentPlayer = room.players.find((player) => player.id === playerId);
  const allReady = activePlayers.length >= 2 && activePlayers.every((player) => player.ready);
  const inviteUrl = getInviteUrl(room.code);

  lobbyInfo.innerHTML = `
    <div class="lobby-room-card">
      <div>
        <span class="lobby-eyebrow">Комната</span>
        <strong class="lobby-room-code">${room.code}</strong>
      </div>
      <button type="button" class="copy-link-btn" data-copy-invite="${escapeAttribute(inviteUrl)}">
        Копировать ссылку
      </button>
    </div>
    <div class="invite-link">${escapeHtml(inviteUrl)}</div>
    ${renderRoomSettingsSummary(room.settings)}
    <div class="lobby-section-title">Игроки ${activePlayers.length}/5</div>
    <ul class="lobby-players">
      ${room.players
        .map((player) => renderLobbyPlayer(player, room.hostId))
        .join("")}
    </ul>
    ${renderLobbyLog(room.logs)}
  `;

  if (roomSettingsBox) {
    roomSettingsBox.classList.remove("hidden");
    roomSettingsBox.innerHTML = renderRoomSettings(room);
  }

  if (currentPlayer && !currentPlayer.disconnected) {
    tokenPicker.classList.remove("hidden");
    tokenPicker.innerHTML = renderTokenPicker(room, currentPlayer);
    tokenPicker.querySelectorAll(".token-choice").forEach((button) => {
      button.addEventListener("click", () => {
        socket.emit("selectToken", {
          roomCode,
          tokenId: button.dataset.tokenId,
        });
      });
    });

    readyBtn.classList.remove("hidden");
    leaveRoomBtn?.classList.remove("hidden");
    readyBtn.textContent = currentPlayer.ready ? "Снять готовность" : "Готов";
  } else {
    tokenPicker.classList.add("hidden");
    readyBtn.classList.add("hidden");
    leaveRoomBtn?.classList.add("hidden");
  }

  if (playerId === room.hostId && allReady) {
    startOnlineBtn.classList.remove("hidden");
  } else {
    startOnlineBtn.classList.add("hidden");
  }

  updateReconnectBox();
  renderChat();
}

function handleLobbyClick(event) {
  const copyButton = event.target.closest("[data-copy-invite]");
  if (!copyButton) return;

  copyInviteLink(copyButton.dataset.copyInvite, copyButton);
}

async function copyInviteLink(inviteUrl, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(inviteUrl);
    } else {
      copyTextFallback(inviteUrl);
    }

    const previousText = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => {
      button.textContent = previousText;
    }, 1400);
  } catch {
    prompt("Скопируйте ссылку комнаты", inviteUrl);
  }
}

function copyTextFallback(text) {
  const input = document.createElement("input");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function renderRoomSettings(room) {
  const settings = normalizeClientSettings(room.settings);
  const isHost = playerId === room.hostId;
  const disabled = isHost ? "" : "disabled";

  return `
    <h3>Настройки партии</h3>
    <div class="room-settings-grid">
      <label>
        Стартовые деньги
        <input class="room-setting-input" data-setting="startingMoney" type="number" min="500" max="5000" step="100" value="${settings.startingMoney}" ${disabled} />
      </label>
      <label>
        Бонус за круг
        <input class="room-setting-input" data-setting="passStartBonus" type="number" min="0" max="1000" step="50" value="${settings.passStartBonus}" ${disabled} />
      </label>
      <label>
        Таймер хода, сек.
        <input class="room-setting-input" data-setting="turnTimeSeconds" type="number" min="30" max="300" step="15" value="${settings.turnTimeSeconds}" ${disabled} />
      </label>
      <label class="checkbox-setting">
        <input class="room-setting-input" data-setting="auctionsEnabled" type="checkbox" ${settings.auctionsEnabled ? "checked" : ""} ${disabled} />
        Аукционы
      </label>
    </div>
    ${isHost ? "<div class=\"muted\">Изменение настроек сбрасывает готовность игроков.</div>" : "<div class=\"muted\">Менять настройки может хост комнаты.</div>"}
`;
}

function renderRoomSettingsSummary(settings = {}) {
  const normalized = normalizeClientSettings(settings);

  return `
    <p class="settings-summary">
      Правила: старт ${normalized.startingMoney}₽ · круг ${normalized.passStartBonus}₽ · таймер ${normalized.turnTimeSeconds}с · аукционы ${normalized.auctionsEnabled ? "вкл" : "выкл"}
    </p>
  `;
}

function renderLobbyPlayer(player, hostId) {
  const token = tokenOptions.find((item) => item.id === player.tokenId) ?? tokenOptions[0];
  const statusText = player.disconnected ? "Отключён" : player.ready ? "Готов" : "Ждёт";
  const statusClass = player.disconnected ? "offline" : player.ready ? "ready" : "waiting";
  const host = player.id === hostId ? "<span class=\"host-badge\">Хост</span>" : "";

  return `
    <li class="lobby-player ${player.disconnected ? "is-disconnected" : ""}">
      <span class="lobby-token" style="background:${token.color}">${token.icon}</span>
      <span class="lobby-player-name">${escapeHtml(player.name)}</span>
      ${host}
      <span class="lobby-status ${statusClass}">${statusText}</span>
    </li>
  `;
}

function renderTokenPicker(room, currentPlayer) {
  const takenTokenIds = new Set(
    room.players
      .filter((player) => player.id !== currentPlayer.id && !player.disconnected)
      .map((player) => player.tokenId),
  );

  return `
    <div class="token-picker-title">Фишка игрока</div>
    <div class="token-choice-grid">
      ${tokenOptions
        .map((token) => {
          const isTaken = takenTokenIds.has(token.id);
          const isActive = currentPlayer.tokenId === token.id;

          return `
            <button
              class="token-choice ${isActive ? "active" : ""}"
              data-token-id="${token.id}"
              ${isTaken ? "disabled" : ""}
              title="${token.label}"
            >
              <span class="token-choice-icon" style="background:${token.color}">${token.icon}</span>
              <span>${token.label}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLobbyLog(logs = []) {
  if (!logs.length) return "";

  return `
    <div class="lobby-log">
      <strong>Лог комнаты</strong>
      ${logs
        .slice(-6)
        .reverse()
        .map((entry) => `<div><span>${entry.time}</span> ${escapeHtml(entry.message)}</div>`)
        .join("")}
    </div>
  `;
}

function toggleReady() {
  if (!socket || !roomCode) return;

  socket.emit("toggleReady", { roomCode });
}

function startOnlineGame() {
  socket.emit("startOnlineGame", { roomCode });
}

function leaveRoom() {
  if (!socket || !roomCode) {
    resetOnlineLobby();
    return;
  }

  const leavingRoomCode = roomCode;
  const leaveRequest = socket.timeout ? socket.timeout(2500) : socket;

  leaveRequest.emit(
    "leaveRoom",
    {
      roomCode: leavingRoomCode,
      playerId,
    },
    (error, response) => {
      if (error || response?.ok === false) {
        alert(response?.message || "Не удалось покинуть комнату. Попробуйте ещё раз.");
        return;
      }

      resetOnlineLobby();
    },
  );
}

function resetOnlineLobby() {
  clearMoveAnimation();
  roomCode = null;
  state = null;
  selectedCellId = null;
  roomChat = [];
  typingPlayers.clear();
  isOnline = false;
  clearSavedRoom();
  document.getElementById("onlineBox")?.classList.remove("is-in-lobby");
  document.getElementById("onlineSetup")?.classList.remove("hidden");
  document.getElementById("onlineLobby")?.classList.add("hidden");
  document.getElementById("lobbyInfo").innerHTML = "";
  document.getElementById("roomSettingsBox")?.classList.add("hidden");
  document.getElementById("tokenPicker")?.classList.add("hidden");
  document.getElementById("readyBtn")?.classList.add("hidden");
  document.getElementById("startOnlineBtn")?.classList.add("hidden");
  document.getElementById("leaveRoomBtn")?.classList.add("hidden");
  renderChat();
  showModeSelect();
}

function startLocalGame() {
  clearMoveAnimation();
  isOnline = false;
  roomChat = [];
  selectedCellId = null;

  const count = Number(elements.playersCount.value);
  const settings = {
    startingMoney: elements.localStartingMoney.value,
    passStartBonus: elements.localPassStartBonus.value,
    auctionsEnabled: elements.localAuctionsEnabled.checked,
  };

  state = createGame(count, settings);

  elements.startScreen.classList.add("hidden");
  elements.gameScreen.classList.remove("hidden");

  renderGame();
}

function handleRoomSettingsChange(event) {
  const input = event.target.closest(".room-setting-input");
  if (!input || !socket || !roomCode) return;

  const settings = {};
  settings[input.dataset.setting] = input.type === "checkbox" ? input.checked : input.value;

  socket.emit("updateRoomSettings", {
    roomCode,
    playerId,
    settings,
  });
}

function handleNewGame() {
  clearMoveAnimation();
  if (isOnline && roomCode && socket) {
    socket.emit("resetOnlineGame", { roomCode, playerId });
    return;
  }

  state = null;
  roomChat = [];
  selectedCellId = null;
  isOnline = false;
  elements.gameScreen.classList.add("hidden");
  elements.startScreen.classList.remove("hidden");
  showModeSelect();
  renderChat();
}

function handleSkipDisconnectedPlayer() {
  if (!isOnline || !socket || !roomCode) return;

  socket.emit("skipDisconnectedPlayer", {
    roomCode,
    playerId,
  });
}

function maybeAnimateMove(previousState, nextState) {
  if (!previousState || !nextState || !Array.isArray(previousState.players) || !Array.isArray(nextState.players)) return;

  const movedPlayer = nextState.players.find((nextPlayer) => {
    const previousPlayer = previousState.players.find((player) => player.id === nextPlayer.id);
    return previousPlayer && previousPlayer.position !== nextPlayer.position;
  });

  if (!movedPlayer) return;

  const previousPlayer = previousState.players.find((player) => player.id === movedPlayer.id);
  animatePlayerMove(movedPlayer.id, previousPlayer.position, movedPlayer.position, nextState.cells.length);
}

function captureMoveState(currentState) {
  if (!currentState || !Array.isArray(currentState.players)) return null;

  return {
    players: currentState.players.map((player) => ({
      id: player.id,
      position: player.position,
    })),
  };
}

function animatePlayerMove(animatedPlayerId, fromPosition, toPosition, cellsCount) {
  clearMoveAnimation();

  const path = getMovePath(fromPosition, toPosition, cellsCount);
  if (path.length <= 1) return;

  let stepIndex = 0;
  moveAnimation.path = path;
  moveAnimation.completedPath = [path[stepIndex]];
  moveAnimation.targetPosition = null;
  moveAnimation.visualPositions = {
    [animatedPlayerId]: path[stepIndex],
  };

  const tick = () => {
    stepIndex += 1;

    if (stepIndex >= path.length) {
      finishMoveAnimation(toPosition);
      renderGame();
      return;
    }

    moveAnimation.completedPath = path.slice(0, stepIndex + 1);
    moveAnimation.visualPositions = {
      [animatedPlayerId]: path[stepIndex],
    };
    renderGame();
    moveAnimation.timer = setTimeout(tick, 130);
  };

  renderGame();
  moveAnimation.timer = setTimeout(tick, 130);
}

function getMovePath(fromPosition, toPosition, cellsCount) {
  const path = [fromPosition];
  let current = fromPosition;
  let guard = 0;

  while (current !== toPosition && guard < cellsCount) {
    current = (current + 1) % cellsCount;
    path.push(current);
    guard += 1;
  }

  return path;
}

function clearMoveAnimation() {
  if (moveAnimation.timer) {
    clearTimeout(moveAnimation.timer);
  }

  if (moveAnimation.targetTimer) {
    clearTimeout(moveAnimation.targetTimer);
  }

  moveAnimation.timer = null;
  moveAnimation.targetTimer = null;
  moveAnimation.visualPositions = null;
  moveAnimation.path = [];
  moveAnimation.completedPath = [];
  moveAnimation.targetPosition = null;
}

function finishMoveAnimation(targetPosition) {
  if (moveAnimation.timer) {
    clearTimeout(moveAnimation.timer);
  }

  moveAnimation.timer = null;
  moveAnimation.visualPositions = null;
  moveAnimation.completedPath = [];
  moveAnimation.path = [];
  moveAnimation.targetPosition = targetPosition;
  moveAnimation.targetTimer = setTimeout(() => {
    moveAnimation.targetTimer = null;
    moveAnimation.targetPosition = null;
    renderGame();
  }, 650);
}

function handleRollDice() {
  if (!state) return;

  if (isOnline) {
    socket.emit("rollDice", { roomCode, playerId });
    return;
  }

  const previousState = captureMoveState(state);
  state = rollDiceAndProcessTurn(state);
  maybeAnimateMove(previousState, state);
  renderGame();
}

function handleBuyProperty() {
  if (!state) return;

  if (isOnline) {
    socket.emit("buyProperty", { roomCode, playerId });
    return;
  }

  state = buyPendingProperty(state, state.players[state.currentPlayerIndex].id);
  renderGame();
}

function handleSkipProperty() {
  if (!state) return;

  if (isOnline) {
    socket.emit("skipProperty", { roomCode, playerId });
    return;
  }

  state = skipPendingProperty(state, state.players[state.currentPlayerIndex].id);
  renderGame();
}

function handleBuildHouseClick(event) {
  const button = event.target.closest(".build-house-btn");
  if (!button || !state) return;

  const cellId = button.dataset.cellId;

  if (isOnline) {
    socket.emit("buildHouse", { roomCode, playerId, cellId });
    return;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];
  state = buildHouse(state, currentPlayer.id, cellId);
  renderGame();
}

function handleAssetActionClick(event) {
  const button = event.target.closest(".asset-action-btn");
  if (!button || !state) return;

  const { action, cellId } = button.dataset;

  if (action === "sell-property" && !confirm("Продать объект банку за половину стоимости?")) {
    return;
  }

  if (isOnline) {
    socket.emit("assetAction", { roomCode, playerId, action, cellId });
    return;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (action === "sell-house") {
    state = sellHouse(state, currentPlayer.id, cellId);
  } else if (action === "sell-property") {
    state = sellProperty(state, currentPlayer.id, cellId);
  } else if (action === "mortgage") {
    state = mortgageProperty(state, currentPlayer.id, cellId);
  } else if (action === "redeem") {
    state = redeemProperty(state, currentPlayer.id, cellId);
  } else if (action === "bankrupt") {
    state = declareBankruptcy(state, currentPlayer.id);
  }

  renderGame();
}

function handleTradeActionClick(event) {
  const button = event.target.closest(".trade-action-btn");
  if (!button || !state) return;

  const { action, targetPlayerId, cellId } = button.dataset;
  const currentPlayer = state.players[state.currentPlayerIndex];

  if (action === "propose") {
    const cell = state.cells.find((item) => item.id === cellId);
    const defaultOffer = cell?.price ? Math.floor(cell.price * 0.8) : 100;
    const rawOffer = prompt(`Сколько предложить за "${cell?.title ?? "объект"}"?`, String(defaultOffer));
    if (rawOffer === null) return;

    const offerMoney = Math.max(0, Math.floor(Number(rawOffer) || 0));

    if (isOnline) {
      socket.emit("tradeAction", {
        roomCode,
        playerId,
        action,
        targetPlayerId,
        cellId,
        offerMoney,
      });
      return;
    }

    state = proposeTrade(state, currentPlayer.id, targetPlayerId, cellId, offerMoney);
  } else if (action === "accept") {
    if (isOnline) {
      socket.emit("tradeAction", { roomCode, playerId, action });
      return;
    }

    state = acceptTrade(state, state.pendingTrade.toPlayerId);
  } else if (action === "reject") {
    if (isOnline) {
      socket.emit("tradeAction", { roomCode, playerId, action });
      return;
    }

    state = rejectTrade(state, state.pendingTrade.toPlayerId);
  }

  renderGame();
}

function handleAuctionActionClick(event) {
  const button = event.target.closest(".auction-action-btn");
  if (!button || !state) return;

  const { action } = button.dataset;
  const bidderId = getCurrentAuctionBidderId(state);
  if (!bidderId) return;

  if (action === "bid") {
    const minBid = getAuctionMinBid(state);
    const rawBid = prompt("Ваша ставка", String(minBid));
    if (rawBid === null) return;

    const bidAmount = Math.floor(Number(rawBid) || 0);

    if (isOnline) {
      socket.emit("auctionAction", {
        roomCode,
        playerId,
        action,
        bidAmount,
      });
      return;
    }

    state = placeAuctionBid(state, bidderId, bidAmount);
  } else if (action === "pass") {
    if (isOnline) {
      socket.emit("auctionAction", {
        roomCode,
        playerId,
        action,
      });
      return;
    }

    state = passAuctionBid(state, bidderId);
  }

  renderGame();
}

function renderGame() {
  render(state, elements, {
    isOnline,
    playerId,
    selectedCellId,
    propertyDockMode,
    visualPositions: moveAnimation.visualPositions,
    movePath: moveAnimation.path,
    completedMovePath: moveAnimation.completedPath,
    moveTargetPosition: moveAnimation.targetPosition,
  });
  applyBoardView();
  applySidebarState();
  applySidePanelTab();
  renderChat();
  updateTurnTimer();
}

function updateTurnTimer() {
  if (!elements.turnTimer || !elements.skipDisconnectedBtn) return;

  if (!state || !state.turnDeadlineAt || state.turnPhase === "game_over") {
    elements.turnTimer.textContent = "Таймер: —";
    elements.skipDisconnectedBtn.classList.add("hidden");
    return;
  }

  const msLeft = Math.max(0, Date.parse(state.turnDeadlineAt) - Date.now());
  const secondsLeft = Math.ceil(msLeft / 1000);
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  elements.turnTimer.textContent = `Таймер: ${minutes}:${String(seconds).padStart(2, "0")}`;

  const requiredPlayerId = getRequiredActionPlayerId(state);
  const requiredPlayer = state.players.find((player) => player.id === requiredPlayerId);
  const canSkipDisconnected =
    isOnline &&
    requiredPlayer &&
    requiredPlayer.id !== playerId &&
    requiredPlayer.disconnected &&
    state.turnPhase !== "game_over";

  elements.skipDisconnectedBtn.classList.toggle("hidden", !canSkipDisconnected);
}

function applyOnlineIdentity(nextRoomCode, nextPlayerId) {
  isOnline = true;
  roomCode = nextRoomCode;
  playerId = nextPlayerId || playerId;

  localStorage.setItem(STORAGE_KEYS.playerId, playerId);
  localStorage.setItem(STORAGE_KEYS.roomCode, roomCode);

  const roomCodeInput = document.getElementById("roomCodeInput");
  if (roomCodeInput) roomCodeInput.value = roomCode;

  updateReconnectBox();
}

function renderChat() {
  const chatBoxes = [elements.chatBox, document.getElementById("lobbyChatBox")].filter(Boolean);
  if (!chatBoxes.length) return;

  if (!isOnline || !roomCode) {
    chatBoxes.forEach((chatBox) => {
      chatBox.classList.add("hidden");
      chatBox.innerHTML = "";
    });
    return;
  }

  const typingText = getTypingText();
  const html = `
    <h3>Чат</h3>
    <div class="chat-messages">
      ${roomChat
        .slice(-30)
        .map((entry) => `
          <div class="chat-message ${entry.playerId === playerId ? "own" : ""}">
            <span class="chat-dot" style="background:${entry.tokenColor ?? "#f4b942"}"></span>
            <div>
              <div class="chat-meta">${entry.time} · ${escapeHtml(entry.playerName ?? "Игрок")}</div>
              <div>${escapeHtml(entry.message)}</div>
            </div>
          </div>
        `)
        .join("")}
      ${typingText ? `<div class="chat-typing">${escapeHtml(typingText)}</div>` : ""}
    </div>
    <form class="chat-form">
      <input name="message" maxlength="180" placeholder="Сообщение" autocomplete="off" />
      <button type="submit">Отправить</button>
    </form>
  `;

  chatBoxes.forEach((chatBox) => {
    chatBox.classList.remove("hidden");
    chatBox.innerHTML = html;

    const messages = chatBox.querySelector(".chat-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
}

function getTypingText() {
  const now = Date.now();
  const names = [];

  for (const [typingPlayerId, info] of typingPlayers.entries()) {
    if (info.expiresAt <= now) {
      typingPlayers.delete(typingPlayerId);
      continue;
    }

    names.push(info.playerName);
  }

  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} печатает...`;
  return "Несколько игроков печатают...";
}

function handleChatTypingInput(event) {
  if (!event.target.closest(".chat-form") || !socket || !roomCode) return;

  const isTyping = event.target.value.trim().length > 0;
  socket.emit("chatTyping", {
    roomCode,
    playerId,
    isTyping,
  });

  clearTimeout(typingStopTimer);
  if (isTyping) {
    typingStopTimer = setTimeout(() => {
      socket.emit("chatTyping", {
        roomCode,
        playerId,
        isTyping: false,
      });
    }, 1600);
  }
}

function handleSendChatMessage(event) {
  const form = event.target.closest(".chat-form");
  if (!form) return;

  event.preventDefault();

  if (!socket) connectSocket();
  const activeRoomCode = roomCode || localStorage.getItem(STORAGE_KEYS.roomCode);

  if (!socket || !activeRoomCode) {
    alert("Комната не найдена. Вернитесь в онлайн-лобби.");
    return;
  }

  const input = form.elements.message;
  const message = input.value.trim();
  if (!message) return;

  socket.emit("chatTyping", {
    roomCode: activeRoomCode,
    playerId,
    isTyping: false,
  });

  input.disabled = true;
  const sendMessage = socket.timeout ? socket.timeout(2500) : socket;
  sendMessage.emit(
    "sendChatMessage",
    {
      roomCode: activeRoomCode,
      playerId,
      message,
    },
    (error, response) => {
      input.disabled = false;

      if (error) {
        alert("Сообщение не отправилось. Проверьте соединение и попробуйте ещё раз.");
        return;
      }

      if (!response?.ok) {
        alert(response?.message || "Сообщение не отправилось.");
        return;
      }

      roomChat = Array.isArray(response.chat) ? response.chat : roomChat;
      renderChat();
    },
  );
  input.value = "";
}

function getRoomCodeFromUrl() {
  return new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
}

function getInviteUrl(code) {
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function normalizeClientSettings(settings = {}) {
  return {
    startingMoney: clampClientNumber(settings.startingMoney, 500, 5000, 1500),
    passStartBonus: clampClientNumber(settings.passStartBonus, 0, 1000, 200),
    turnTimeSeconds: clampClientNumber(settings.turnTimeSeconds, 30, 300, 90),
    auctionsEnabled: settings.auctionsEnabled !== false,
  };
}

function clampClientNumber(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function updateReconnectBox() {
  const reconnectBox = document.getElementById("reconnectBox");
  if (!reconnectBox) return;

  const savedRoomCode = localStorage.getItem(STORAGE_KEYS.roomCode);

  if (!savedRoomCode || savedRoomCode === roomCode) {
    reconnectBox.classList.add("hidden");
    reconnectBox.innerHTML = "";
    return;
  }

  reconnectBox.classList.remove("hidden");
  reconnectBox.innerHTML = `
    <div>
      <strong>Есть сохранённая комната: ${escapeHtml(savedRoomCode)}</strong>
      <span>Можно вернуться после обновления страницы или случайного закрытия вкладки.</span>
    </div>
    <div class="reconnect-actions">
      <button id="reconnectRoomBtn" type="button">Вернуться</button>
      <button id="clearReconnectBtn" type="button" class="secondary-btn">Сбросить</button>
    </div>
  `;

  document.getElementById("reconnectRoomBtn").addEventListener("click", reconnectToSavedRoom);
  document.getElementById("clearReconnectBtn").addEventListener("click", clearSavedRoom);
}

function clearSavedRoom() {
  localStorage.removeItem(STORAGE_KEYS.roomCode);
  const roomCodeInput = document.getElementById("roomCodeInput");
  if (roomCodeInput) roomCodeInput.value = "";
  updateReconnectBox();
}

function getPersistentPlayerId() {
  const savedPlayerId = localStorage.getItem(STORAGE_KEYS.playerId);

  if (savedPlayerId) return savedPlayerId;

  const nextPlayerId = `p_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  localStorage.setItem(STORAGE_KEYS.playerId, nextPlayerId);

  return nextPlayerId;
}

function getPlayerName() {
  return document.getElementById("playerNameInput").value.trim() || "Игрок";
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen?.();
    } catch {
      updateFullscreenButton();
    }
    return;
  }

  const el = document.documentElement;

  if (el.requestFullscreen) {
    try {
      await el.requestFullscreen();
    } catch {
      updateFullscreenButton();
    }
  }
}

function updateFullscreenButton() {
  if (!elements.fullscreenBtn) return;

  elements.fullscreenBtn.textContent = document.fullscreenElement ? "⛶ Обычный режим" : "⛶ Полный экран";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
