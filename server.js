import express from "express";
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import { tokenOptions } from "./js/data.js";
import {
  acceptTrade,
  buildHouse,
  buyPendingProperty,
  createGameFromPlayers,
  DEFAULT_GAME_SETTINGS,
  declareBankruptcy,
  getRequiredActionPlayerId,
  mortgageProperty,
  normalizeGameSettings,
  passAuctionBid,
  placeAuctionBid,
  proposeTrade,
  redeemProperty,
  rejectTrade,
  rollDiceAndProcessTurn,
  sellHouse,
  skipRequiredAction,
  skipPendingProperty,
} from "./js/gameLogic.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.MONOPOLY_DATA_DIR
  ? path.resolve(process.env.MONOPOLY_DATA_DIR)
  : path.join(__dirname, "data");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");
const ROOM_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const FALLBACK_TURN_TIME_MS = DEFAULT_GAME_SETTINGS.turnTimeSeconds * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const roomTurnTimers = new Map();

app.set("trust proxy", 1);

function setStaticHeaders(res) {
  if (IS_PRODUCTION) {
    res.setHeader("Cache-Control", "public, max-age=300");
    return;
  }

  res.setHeader("Cache-Control", "no-store");
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    uptime: Math.round(process.uptime()),
  });
});

app.get("/", (_req, res) => {
  setStaticHeaders(res);
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/style.css", (_req, res) => {
  setStaticHeaders(res);
  res.sendFile(path.join(__dirname, "style.css"));
});

app.use(
  "/js",
  express.static(path.join(__dirname, "js"), {
    etag: false,
    lastModified: false,
    setHeaders: setStaticHeaders,
  }),
);

const rooms = new Map();

loadRooms();
scheduleLoadedRoomTimers();

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, playerId }) => {
    const persistentPlayerId = normalizePlayerId(playerId) || createPlayerId();
    const roomCode = createRoomCode();

    const room = {
      code: roomCode,
      hostId: persistentPlayerId,
      started: false,
      state: null,
      players: [],
      logs: [],
      chat: [],
      settings: normalizeGameSettings(),
      updatedAt: new Date().toISOString(),
    };

    const player = createPlayer(
      persistentPlayerId,
      socket.id,
      name || "Игрок 1",
      0,
    );
    room.players.push(player);

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.data.playerId = persistentPlayerId;
    socket.data.roomCode = roomCode;

    addRoomLog(room, `${player.name} создал комнату.`);

    socket.emit("roomCreated", {
      roomCode,
      playerId: persistentPlayerId,
      room,
    });

    emitRoom(roomCode);
    persistRooms();
  });

  socket.on("joinRoom", ({ roomCode, name, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));

    if (!room) {
      socket.emit("errorMessage", "Комната не найдена.");
      return;
    }

    const persistentPlayerId = normalizePlayerId(playerId) || createPlayerId();
    const existingPlayer = room.players.find(
      (player) => player.id === persistentPlayerId,
    );

    if (existingPlayer) {
      reconnectPlayerToRoom(socket, room, existingPlayer);
      return;
    }

    if (room.started) {
      socket.emit(
        "errorMessage",
        "Игра уже началась. Подключиться можно только ранее участвовавшему игроку.",
      );
      return;
    }

    const activePlayersCount = room.players.filter(
      (player) => !player.disconnected,
    ).length;

    if (activePlayersCount >= 5) {
      socket.emit("errorMessage", "В комнате уже 5 игроков.");
      return;
    }

    const player = createPlayer(
      persistentPlayerId,
      socket.id,
      name || `Игрок ${room.players.length + 1}`,
      room.players.length,
      room.players,
    );
    room.players.push(player);

    socket.join(room.code);
    socket.data.playerId = persistentPlayerId;
    socket.data.roomCode = room.code;

    addRoomLog(room, `${player.name} подключился.`);

    socket.emit("roomJoined", {
      roomCode: room.code,
      playerId: persistentPlayerId,
      room,
    });

    emitRoom(room.code);
    persistRooms();
  });

  socket.on("reconnectRoom", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));

    if (!room) {
      socket.emit("reconnectFailed", "Комната не найдена.");
      return;
    }

    const persistentPlayerId = normalizePlayerId(playerId);
    const player = room.players.find((item) => item.id === persistentPlayerId);

    if (!player) {
      socket.emit("reconnectFailed", "Этот игрок не найден в комнате.");
      return;
    }

    reconnectPlayerToRoom(socket, room, player);
  });

  socket.on("toggleReady", ({ roomCode }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || room.started) return;

    const player = getRoomPlayerBySocket(room, socket);
    if (!player || player.disconnected) return;

    player.ready = !player.ready;
    addRoomLog(room, `${player.name}: ${player.ready ? "готов" : "не готов"}.`);

    emitRoom(room.code);
    persistRooms();
  });

  socket.on("selectToken", ({ roomCode, tokenId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || room.started) return;

    const player = getRoomPlayerBySocket(room, socket);
    if (!player || player.disconnected) return;

    const token = tokenOptions.find((item) => item.id === tokenId);
    if (!token) {
      socket.emit("errorMessage", "Такой фишки нет.");
      return;
    }

    const tokenIsTaken = room.players.some(
      (item) =>
        item.id !== player.id && !item.disconnected && item.tokenId === tokenId,
    );

    if (tokenIsTaken) {
      socket.emit("errorMessage", "Эта фишка уже занята.");
      return;
    }

    player.tokenId = token.id;
    player.tokenColor = token.color;
    player.ready = false;

    addRoomLog(
      room,
      `${player.name} выбрал фишку ${token.icon} ${token.label}.`,
    );
    emitRoom(room.code);
    persistRooms();
  });

  socket.on("updateRoomSettings", ({ roomCode, playerId, settings }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || room.started) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);

    if (!player || player.id !== room.hostId) {
      socket.emit("errorMessage", "Настройки партии может менять только хост.");
      return;
    }

    room.settings = normalizeGameSettings({
      ...room.settings,
      ...settings,
    });
    room.players.forEach((item) => {
      item.ready = false;
    });

    addRoomLog(room, `${player.name} обновил настройки партии.`);
    emitRoom(room.code);
    persistRooms();
  });

  socket.on("startOnlineGame", ({ roomCode }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room) return;

    const player = getRoomPlayerBySocket(room, socket);

    if (!player || player.id !== room.hostId) {
      socket.emit(
        "errorMessage",
        "Только создатель комнаты может начать игру.",
      );
      return;
    }

    const activePlayers = room.players.filter((item) => !item.disconnected);

    if (activePlayers.length < 2) {
      socket.emit("errorMessage", "Нужно минимум 2 игрока.");
      return;
    }

    const allReady = activePlayers.every((item) => item.ready);

    if (!allReady) {
      socket.emit("errorMessage", "Не все игроки готовы.");
      return;
    }

    room.settings = normalizeGameSettings(room.settings);
    activePlayers.forEach((item) => {
      item.money = room.settings.startingMoney;
      item.position = 0;
      item.properties = [];
      item.bankrupt = false;
    });

    room.started = true;
    room.state = createGameFromPlayers(activePlayers, room.settings);
    addRoomLog(room, "Игра началась.");

    if (Array.isArray(room.state.logs)) {
      room.state.logs.unshift(...room.logs.slice(-10));
      room.state.logs = room.state.logs.slice(-40);
    }

    applyTurnTimer(room, true);
    io.to(room.code).emit("gameStarted", room.state);
    io.to(room.code).emit("chatUpdate", room.chat ?? []);
    persistRooms();
  });

  socket.on("resetOnlineGame", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);

    if (!player || player.id !== room.hostId) {
      socket.emit(
        "errorMessage",
        "Новую игру может начать только хост комнаты.",
      );
      return;
    }

    room.started = false;
    room.state = null;
    clearRoomTimer(room.code);
    room.settings = normalizeGameSettings(room.settings);
    room.players.forEach((item, index) => {
      const token =
        tokenOptions.find((option) => option.id === item.tokenId) ??
        tokenOptions[index % tokenOptions.length];
      item.ready = false;
      item.money = room.settings.startingMoney;
      item.position = 0;
      item.properties = [];
      item.bankrupt = false;
      item.inTver = false;
      item.tverTurns = 0;
      item.doubleRollsInTurn = 0;
      item.vesyegonskTickets = 0;
      item.tokenId = token.id;
      item.tokenColor = token.color;
    });

    addRoomLog(room, `${player.name} запустил подготовку новой игры.`);
    io.to(room.code).emit("returnToLobby", {
      roomCode: room.code,
      playerId: player.id,
      room,
    });
    emitRoom(room.code);
    persistRooms();
  });

  socket.on("rollDice", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    const currentPlayer = room.state.players[room.state.currentPlayerIndex];

    if (!player || currentPlayer.id !== player.id) {
      socket.emit("errorMessage", "Сейчас не твой ход.");
      return;
    }

    room.state = rollDiceAndProcessTurn(room.state);

    emitGameUpdate(room);
  });

  socket.on("buyProperty", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    const currentPlayer = room.state.players[room.state.currentPlayerIndex];

    if (!player || currentPlayer.id !== player.id) {
      socket.emit("errorMessage", "Сейчас не твой ход.");
      return;
    }

    room.state = buyPendingProperty(room.state, player.id);

    emitGameUpdate(room);
  });

  socket.on("skipProperty", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    const currentPlayer = room.state.players[room.state.currentPlayerIndex];

    if (!player || currentPlayer.id !== player.id) {
      socket.emit("errorMessage", "Сейчас не твой ход.");
      return;
    }

    room.state = skipPendingProperty(room.state, player.id);

    emitGameUpdate(room);
  });

  socket.on("buildHouse", ({ roomCode, playerId, cellId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    const currentPlayer = room.state.players[room.state.currentPlayerIndex];

    if (!player || currentPlayer.id !== player.id) {
      socket.emit("errorMessage", "Строить дома можно только в свой ход.");
      return;
    }

    room.state = buildHouse(room.state, player.id, cellId);

    emitGameUpdate(room);
  });

  socket.on("assetAction", ({ roomCode, playerId, action, cellId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    const currentPlayer = room.state.players[room.state.currentPlayerIndex];

    if (!player || currentPlayer.id !== player.id) {
      socket.emit(
        "errorMessage",
        "Управлять имуществом можно только в свой ход.",
      );
      return;
    }

    if (action === "sell-house") {
      room.state = sellHouse(room.state, player.id, cellId);
    } else if (action === "mortgage") {
      room.state = mortgageProperty(room.state, player.id, cellId);
    } else if (action === "redeem") {
      room.state = redeemProperty(room.state, player.id, cellId);
    } else if (action === "bankrupt") {
      room.state = declareBankruptcy(room.state, player.id);
    }

    emitGameUpdate(room);
  });

  socket.on("auctionAction", ({ roomCode, playerId, action, bidAmount }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    if (!player) {
      socket.emit(
        "errorMessage",
        "Подключение к комнате потеряно. Обновите страницу и вернитесь в комнату.",
      );
      return;
    }

    if (action === "bid") {
      room.state = placeAuctionBid(room.state, player.id, bidAmount);
    } else if (action === "pass") {
      room.state = passAuctionBid(room.state, player.id);
    }

    emitGameUpdate(room);
  });

  socket.on(
    "tradeAction",
    ({ roomCode, playerId, action, targetPlayerId, cellId, offerMoney }) => {
      const room = rooms.get(normalizeRoomCode(roomCode));
      if (!room || !room.state) return;

      const player = getRoomPlayerBySocketOrId(room, socket, playerId);
      if (!player) {
        socket.emit(
          "errorMessage",
          "Подключение к комнате потеряно. Обновите страницу и вернитесь в комнату.",
        );
        return;
      }

      if (action === "propose") {
        const currentPlayer = room.state.players[room.state.currentPlayerIndex];
        const previousTradeId = room.state.pendingTrade?.id;

        if (currentPlayer.id !== player.id) {
          socket.emit(
            "errorMessage",
            "Предлагать сделку можно только в свой ход.",
          );
          return;
        }

        room.state = proposeTrade(
          room.state,
          player.id,
          targetPlayerId,
          cellId,
          offerMoney,
        );

        const trade = room.state.pendingTrade;
        if (trade && trade.id !== previousTradeId) {
          const targetPlayer = room.players.find(
            (item) => item.id === trade.toPlayerId,
          );
          const fromPlayer = room.players.find(
            (item) => item.id === trade.fromPlayerId,
          );
          const cell = room.state.cells.find(
            (item) => item.id === trade.requestPropertyCellId,
          );

          if (targetPlayer?.socketId) {
            io.to(targetPlayer.socketId).emit("tradeOffered", {
              state: room.state,
              message: `${fromPlayer?.name ?? "Игрок"} предлагает ${trade.offerMoney}₽ за "${cell?.title ?? "объект"}".`,
            });
          } else {
            socket.emit(
              "errorMessage",
              "Предложение создано, но второй игрок сейчас не подключён к комнате.",
            );
          }
        } else {
          socket.emit(
            "errorMessage",
            room.state.lastMessage || "Не удалось создать предложение сделки.",
          );
        }
      } else if (action === "accept") {
        room.state = acceptTrade(room.state, player.id);
      } else if (action === "reject") {
        room.state = rejectTrade(room.state, player.id);
      }

      emitGameUpdate(room);
    },
  );

  socket.on("sendChatMessage", ({ roomCode, playerId, message }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    if (!player) {
      socket.emit(
        "errorMessage",
        "Подключение к комнате потеряно. Обновите страницу и вернитесь в комнату.",
      );
      return;
    }

    const text = sanitizeChatMessage(message);
    if (!text) return;

    addChatMessage(room, player, text);
    io.to(room.code).emit("chatUpdate", room.chat);
    emitRoom(room.code);
    persistRooms();
  });

  socket.on("skipDisconnectedPlayer", ({ roomCode, playerId }) => {
    const room = rooms.get(normalizeRoomCode(roomCode));
    if (!room || !room.state) return;

    const player = getRoomPlayerBySocketOrId(room, socket, playerId);
    if (!player) return;

    const requiredPlayerId = getRequiredActionPlayerId(room.state);
    const requiredRoomPlayer = room.players.find((item) => item.id === requiredPlayerId);
    const requiredGamePlayer = room.state.players.find((item) => item.id === requiredPlayerId);

    if (!requiredPlayerId || (!requiredRoomPlayer?.disconnected && !requiredGamePlayer?.disconnected)) {
      socket.emit("errorMessage", "Сейчас нет отключённого игрока, которого можно пропустить.");
      return;
    }

    room.state = skipRequiredAction(room.state, "Отключённый игрок пропущен");
    emitGameUpdate(room);
  });

  socket.on("disconnect", () => {
    for (const [roomCode, room] of rooms.entries()) {
      const player = room.players.find((item) => item.socketId === socket.id);

      if (!player) continue;

      player.disconnected = true;
      player.ready = false;
      player.socketId = null;
      addRoomLog(room, `${player.name} отключился.`);

      if (room.hostId === player.id) {
        transferHost(room);
      }

      if (room.state) {
        const gamePlayer = room.state.players.find(
          (item) => item.id === player.id,
        );
        if (gamePlayer) gamePlayer.disconnected = true;
      }

      emitRoom(roomCode);

      if (room.state) {
        emitGameUpdate(room, { resetTimer: false });
      }

      persistRooms();
    }
  });
});

function reconnectPlayerToRoom(socket, room, player) {
  const wasDisconnected = player.disconnected;

  player.socketId = socket.id;
  player.disconnected = false;
  socket.join(room.code);
  socket.data.playerId = player.id;
  socket.data.roomCode = room.code;

  if (
    room.hostId &&
    room.players.find((item) => item.id === room.hostId)?.disconnected
  ) {
    room.hostId = player.id;
    addRoomLog(room, `${player.name} теперь хост комнаты.`);
  }

  if (wasDisconnected) {
    addRoomLog(room, `${player.name} вернулся в комнату.`);
  }

  if (room.state) {
    const gamePlayer = room.state.players.find((item) => item.id === player.id);

    if (gamePlayer) {
      gamePlayer.disconnected = false;
    }

    socket.emit("gameReconnected", {
      roomCode: room.code,
      playerId: player.id,
      state: room.state,
      room,
    });

    io.to(room.code).emit("gameUpdate", room.state);
  } else {
    socket.emit("roomReconnected", {
      roomCode: room.code,
      playerId: player.id,
      room,
    });
  }

  emitRoom(room.code);
  persistRooms();
}

function createPlayer(id, socketId, name, index, existingPlayers = []) {
  const token = getFirstAvailableToken(existingPlayers, index);

  return {
    id,
    socketId,
    name: sanitizeName(name),
    tokenId: token.id,
    tokenColor: token.color,
    ready: false,
    money: 1500,
    position: 0,
    properties: [],
    bankrupt: false,
    disconnected: false,
  };
}

function getRoomPlayerBySocket(room, socket) {
  const persistentPlayerId = normalizePlayerId(socket.data.playerId);
  return room.players.find(
    (player) =>
      player.id === persistentPlayerId && player.socketId === socket.id,
  );
}

function getRoomPlayerBySocketOrId(room, socket, playerId) {
  const socketPlayer = getRoomPlayerBySocket(room, socket);
  if (socketPlayer) return socketPlayer;

  const persistentPlayerId = normalizePlayerId(playerId);
  if (!persistentPlayerId) return null;

  const player = room.players.find((item) => item.id === persistentPlayerId);
  if (!player) return null;

  player.socketId = socket.id;
  player.disconnected = false;
  socket.join(room.code);
  socket.data.playerId = player.id;
  socket.data.roomCode = room.code;

  if (room.state) {
    const gamePlayer = room.state.players.find((item) => item.id === player.id);
    if (gamePlayer) gamePlayer.disconnected = false;
  }

  return player;
}

function getFirstAvailableToken(existingPlayers, fallbackIndex) {
  const takenTokenIds = new Set(
    existingPlayers
      .filter((player) => !player.disconnected)
      .map((player) => player.tokenId),
  );

  return (
    tokenOptions.find((token) => !takenTokenIds.has(token.id)) ??
    tokenOptions[fallbackIndex % tokenOptions.length]
  );
}

function transferHost(room) {
  const nextHost = room.players.find((player) => !player.disconnected);

  if (nextHost) {
    room.hostId = nextHost.id;
    addRoomLog(room, `${nextHost.name} теперь хост комнаты.`);
    return;
  }

  addRoomLog(
    room,
    "Все игроки отключились. Комната сохранена и ждёт возврата игроков.",
  );
}

function emitRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  io.to(roomCode).emit("roomUpdate", room);
}

function emitGameUpdate(room, options = {}) {
  applyTurnTimer(room, options.resetTimer ?? true);
  io.to(room.code).emit("gameUpdate", room.state);
  persistRooms();
}

function applyTurnTimer(room, resetTimer = true) {
  if (!room?.state || room.state.turnPhase === "game_over") {
    clearRoomTimer(room?.code);
    if (room?.state) room.state.turnDeadlineAt = null;
    return;
  }

  const currentDeadline = Date.parse(room.state.turnDeadlineAt ?? "");
  const hasActiveDeadline = !Number.isNaN(currentDeadline) && currentDeadline > Date.now();

  if (resetTimer || !hasActiveDeadline) {
    const turnTimeMs =
      (room.state.settings?.turnTimeSeconds ?? room.settings?.turnTimeSeconds) * 1000 ||
      FALLBACK_TURN_TIME_MS;
    room.state.turnDeadlineAt = new Date(Date.now() + turnTimeMs).toISOString();
  }

  scheduleRoomTimer(room);
}

function scheduleLoadedRoomTimers() {
  for (const room of rooms.values()) {
    if (room.state) applyTurnTimer(room, false);
  }
}

function scheduleRoomTimer(room) {
  clearRoomTimer(room.code);

  const deadline = Date.parse(room.state?.turnDeadlineAt ?? "");
  if (Number.isNaN(deadline)) return;

  const delay = Math.max(250, deadline - Date.now());
  const timer = setTimeout(() => handleTurnTimeout(room.code), delay);
  roomTurnTimers.set(room.code, timer);
}

function clearRoomTimer(roomCode) {
  if (!roomCode) return;

  const timer = roomTurnTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  roomTurnTimers.delete(roomCode);
}

function handleTurnTimeout(roomCode) {
  const room = rooms.get(roomCode);
  if (!room?.state || room.state.turnPhase === "game_over") {
    clearRoomTimer(roomCode);
    return;
  }

  const deadline = Date.parse(room.state.turnDeadlineAt ?? "");
  if (!Number.isNaN(deadline) && deadline > Date.now() + 250) {
    scheduleRoomTimer(room);
    return;
  }

  room.state = skipRequiredAction(room.state, "Время вышло");
  emitGameUpdate(room);
}

function addRoomLog(room, message) {
  if (!Array.isArray(room.logs)) room.logs = [];

  room.logs.push({
    time: new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    message,
  });

  room.logs = room.logs.slice(-40);
}

function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;

    const raw = fs.readFileSync(ROOMS_FILE, "utf-8");
    if (!raw.trim()) return;

    const savedRooms = JSON.parse(raw);

    if (!Array.isArray(savedRooms)) return;

    savedRooms.forEach((savedRoom) => {
      const room = hydrateRoom(savedRoom);
      if (room?.code && !isRoomExpired(room)) rooms.set(room.code, room);
    });

    console.log(`Loaded rooms: ${rooms.size}`);
  } catch (error) {
    console.error("Failed to load rooms.json:", error);
  }
}

function persistRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    cleanupExpiredRooms();

    const payload = [...rooms.values()].map((room) =>
      createPersistedRoom(room),
    );

    fs.writeFileSync(ROOMS_FILE, JSON.stringify(payload, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save rooms.json:", error);
  }
}

function cleanupExpiredRooms() {
  for (const [code, room] of rooms.entries()) {
    if (isRoomExpired(room)) rooms.delete(code);
  }
}

function isRoomExpired(room) {
  if (!room?.updatedAt) return false;

  const updatedAt = Date.parse(room.updatedAt);
  if (Number.isNaN(updatedAt)) return false;

  const hasActivePlayers = room.players?.some((player) => !player.disconnected);
  return !hasActivePlayers && Date.now() - updatedAt > ROOM_TTL_MS;
}

function createPersistedRoom(room) {
  room.updatedAt = new Date().toISOString();

  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    state: createPersistedState(room.state),
    players: room.players.map((player) => ({
      ...player,
      socketId: null,
      disconnected: true,
      ready: room.started ? player.ready : false,
    })),
    settings: normalizeGameSettings(room.settings),
    logs: room.logs ?? [],
    chat: room.chat ?? [],
    updatedAt: room.updatedAt,
  };
}

function createPersistedState(state) {
  if (!state) return null;

  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      disconnected: true,
    })),
  };
}

function hydrateRoom(room) {
  if (!room || !room.code) return null;

  const code = normalizeRoomCode(room.code);

  return {
    code,
    hostId: normalizePlayerId(room.hostId),
    started: Boolean(room.started),
    state: hydrateState(room.state),
    settings: normalizeGameSettings(room.settings),
    players: Array.isArray(room.players)
      ? room.players.map((player, index) => hydrateRoomPlayer(player, index))
      : [],
    logs: Array.isArray(room.logs) ? room.logs.slice(-40) : [],
    chat: Array.isArray(room.chat) ? room.chat.slice(-80) : [],
    updatedAt: room.updatedAt ?? null,
  };
}

function hydrateState(state) {
  if (!state) return null;

  return {
    ...state,
    players: Array.isArray(state.players)
      ? state.players.map((player) => ({
          ...player,
          socketId: null,
          disconnected: true,
        }))
      : [],
  };
}

function hydrateRoomPlayer(player, index) {
  const fallbackToken =
    tokenOptions[index % tokenOptions.length] ?? tokenOptions[0];
  const token =
    tokenOptions.find((item) => item.id === player?.tokenId) ?? fallbackToken;

  return {
    id: normalizePlayerId(player?.id) || createPlayerId(),
    socketId: null,
    name: sanitizeName(player?.name),
    tokenId: token.id,
    tokenColor: token.color,
    ready: false,
    money: player?.money ?? 1500,
    position: player?.position ?? 0,
    properties: Array.isArray(player?.properties) ? player.properties : [],
    bankrupt: Boolean(player?.bankrupt),
    disconnected: true,
  };
}

function sanitizeName(name) {
  return (
    String(name ?? "Игрок")
      .trim()
      .slice(0, 16) || "Игрок"
  );
}

function sanitizeChatMessage(message) {
  return String(message ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function addChatMessage(room, player, message) {
  if (!Array.isArray(room.chat)) room.chat = [];

  room.chat.push({
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    playerId: player.id,
    playerName: player.name,
    tokenColor: player.tokenColor,
    time: new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    message,
  });

  room.chat = room.chat.slice(-80);
}

function normalizeRoomCode(roomCode) {
  return String(roomCode ?? "")
    .trim()
    .toUpperCase();
}

function normalizePlayerId(playerId) {
  const value = String(playerId ?? "").trim();
  return value.length >= 8 ? value : "";
}

function createPlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function createRoomCode() {
  let code = "";

  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));

  return code;
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Server started: http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  for (const timer of roomTurnTimers.values()) {
    clearTimeout(timer);
  }
  roomTurnTimers.clear();
  persistRooms();

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
