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
  sellHouse,
  skipPendingProperty,
} from "./gameLogic.js";
import { render } from "./render.js";

const STORAGE_KEYS = {
  playerId: "monopolyPlayerId",
  roomCode: "monopolyRoomCode",
  playerName: "monopolyPlayerName",
};

let state = null;
let socket = null;
let roomCode = null;
let playerId = getPersistentPlayerId();
let isOnline = false;
let roomChat = [];

const elements = {
  startScreen: document.getElementById("startScreen"),
  gameScreen: document.getElementById("gameScreen"),
  playersCount: document.getElementById("playersCount"),
  localStartingMoney: document.getElementById("localStartingMoney"),
  localPassStartBonus: document.getElementById("localPassStartBonus"),
  localAuctionsEnabled: document.getElementById("localAuctionsEnabled"),
  startGameBtn: document.getElementById("startGameBtn"),
  board: document.getElementById("board"),
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
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  gameLog: document.getElementById("gameLog"),
  chatBox: document.getElementById("chatBox"),
};

createOnlineUI();

elements.startGameBtn.addEventListener("click", startLocalGame);
elements.rollDiceBtn.addEventListener("click", handleRollDice);
elements.buyPropertyBtn.addEventListener("click", handleBuyProperty);
elements.skipPropertyBtn.addEventListener("click", handleSkipProperty);
elements.playersList.addEventListener("click", handleBuildHouseClick);
elements.playersList.addEventListener("click", handleAssetActionClick);
elements.playersList.addEventListener("click", handleTradeActionClick);
elements.cellInfo.addEventListener("click", handleTradeActionClick);
elements.cellInfo.addEventListener("click", handleAuctionActionClick);
elements.chatBox.addEventListener("submit", handleSendChatMessage);
elements.startScreen.addEventListener("submit", handleSendChatMessage);
elements.startScreen.addEventListener("change", handleRoomSettingsChange);
elements.fullscreenBtn.addEventListener("click", enterFullscreen);
elements.newGameBtn.addEventListener("click", handleNewGame);
elements.skipDisconnectedBtn.addEventListener("click", handleSkipDisconnectedPlayer);
setInterval(updateTurnTimer, 1000);

function createOnlineUI() {
  const onlineBox = document.createElement("div");
  onlineBox.className = "online-box";

  const savedName = localStorage.getItem(STORAGE_KEYS.playerName) ?? "";
  const queryRoomCode = getRoomCodeFromUrl();
  const savedRoomCode = queryRoomCode || localStorage.getItem(STORAGE_KEYS.roomCode) || "";

  onlineBox.innerHTML = `
    <h2>Онлайн</h2>

    <div id="reconnectBox" class="reconnect-box hidden"></div>

    <input id="playerNameInput" placeholder="Ваше имя" maxlength="16" value="${escapeAttribute(savedName)}" />

    <button id="createRoomBtn">Создать комнату</button>

    <div class="join-row">
      <input id="roomCodeInput" placeholder="Код комнаты" maxlength="4" value="${escapeAttribute(savedRoomCode)}" />
      <button id="joinRoomBtn">Войти</button>
    </div>

    <div id="lobbyInfo" class="lobby-info"></div>

    <div id="roomSettingsBox" class="room-settings-box hidden"></div>

    <div id="lobbyChatBox" class="chat-box hidden"></div>

    <div id="tokenPicker" class="token-picker hidden"></div>

    <button id="readyBtn" class="hidden">Готов</button>
    <button id="startOnlineBtn" class="hidden">Начать онлайн-игру</button>
  `;

  elements.startScreen.appendChild(onlineBox);

  document.getElementById("createRoomBtn").addEventListener("click", createRoom);
  document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);
  document.getElementById("readyBtn").addEventListener("click", toggleReady);
  document.getElementById("startOnlineBtn").addEventListener("click", startOnlineGame);
  document.getElementById("playerNameInput").addEventListener("input", (event) => {
    localStorage.setItem(STORAGE_KEYS.playerName, event.target.value.trim());
  });

  updateReconnectBox();

  if (queryRoomCode) {
    document.getElementById("roomCodeInput").value = queryRoomCode;
  }
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
    roomChat = data.room?.chat ?? [];
    renderLobby(data.room);
  });

  socket.on("gameStarted", (serverState) => {
    state = serverState;
    roomChat = [];
    elements.startScreen.classList.add("hidden");
    elements.gameScreen.classList.remove("hidden");
    renderGame();
  });

  socket.on("gameReconnected", (data) => {
    applyOnlineIdentity(data.roomCode, data.playerId);
    state = data.state;
    roomChat = data.room?.chat ?? [];
    elements.startScreen.classList.add("hidden");
    elements.gameScreen.classList.remove("hidden");
    renderGame();
  });

  socket.on("returnToLobby", (data) => {
    applyOnlineIdentity(data.roomCode, playerId);
    state = null;
    roomChat = data.room?.chat ?? roomChat;
    elements.gameScreen.classList.add("hidden");
    elements.startScreen.classList.remove("hidden");
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
    state = serverState;
    renderGame();
  });

  socket.on("chatUpdate", (chat) => {
    roomChat = Array.isArray(chat) ? chat : [];
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

  const lobbyInfo = document.getElementById("lobbyInfo");
  const roomSettingsBox = document.getElementById("roomSettingsBox");
  const tokenPicker = document.getElementById("tokenPicker");
  const readyBtn = document.getElementById("readyBtn");
  const startOnlineBtn = document.getElementById("startOnlineBtn");

  const activePlayers = room.players.filter((player) => !player.disconnected);
  const currentPlayer = room.players.find((player) => player.id === playerId);
  const allReady = activePlayers.length >= 2 && activePlayers.every((player) => player.ready);

  lobbyInfo.innerHTML = `
    <p><strong>Код комнаты:</strong> ${room.code}</p>
    <p><strong>Ссылка:</strong><br><strong>${getInviteUrl(room.code)}</strong></p>
    ${renderRoomSettingsSummary(room.settings)}
    <p>Игроки:</p>
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
    readyBtn.textContent = currentPlayer.ready ? "Снять готовность" : "Готов";
  } else {
    tokenPicker.classList.add("hidden");
    readyBtn.classList.add("hidden");
  }

  if (playerId === room.hostId && allReady) {
    startOnlineBtn.classList.remove("hidden");
  } else {
    startOnlineBtn.classList.add("hidden");
  }

  updateReconnectBox();
  renderChat();
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
  const status = player.disconnected ? "🔌" : player.ready ? "✅" : "⏳";
  const host = player.id === hostId ? " 👑" : "";
  const disconnected = player.disconnected ? " <span class=\"muted\">отключён</span>" : "";

  return `
    <li class="lobby-player ${player.disconnected ? "is-disconnected" : ""}">
      <span>${status}</span>
      <span class="lobby-token" style="background:${token.color}">${token.icon}</span>
      <span>${escapeHtml(player.name)}${host}${disconnected}</span>
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

function startLocalGame() {
  isOnline = false;
  roomChat = [];

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
  if (isOnline && roomCode && socket) {
    socket.emit("resetOnlineGame", { roomCode, playerId });
    return;
  }

  state = null;
  roomChat = [];
  isOnline = false;
  elements.gameScreen.classList.add("hidden");
  elements.startScreen.classList.remove("hidden");
  renderChat();
}

function handleSkipDisconnectedPlayer() {
  if (!isOnline || !socket || !roomCode) return;

  socket.emit("skipDisconnectedPlayer", {
    roomCode,
    playerId,
  });
}

function handleRollDice() {
  if (!state) return;

  if (isOnline) {
    socket.emit("rollDice", { roomCode, playerId });
    return;
  }

  state = rollDiceAndProcessTurn(state);
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

  if (isOnline) {
    socket.emit("assetAction", { roomCode, playerId, action, cellId });
    return;
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  if (action === "sell-house") {
    state = sellHouse(state, currentPlayer.id, cellId);
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
  });
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

function handleSendChatMessage(event) {
  const form = event.target.closest(".chat-form");
  if (!form || !socket || !roomCode) return;

  event.preventDefault();

  const input = form.elements.message;
  const message = input.value.trim();
  if (!message) return;

  socket.emit("sendChatMessage", {
    roomCode,
    playerId,
    message,
  });

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

function enterFullscreen() {
  const el = document.documentElement;

  if (el.requestFullscreen) {
    el.requestFullscreen();
  }
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
