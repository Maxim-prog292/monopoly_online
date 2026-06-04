import { boardData, eventDecks, getPropertyGroup, getTokenOption, tokenOptions } from "./data.js";

export const TURN_PHASES = {
  WAITING_ROLL: "waiting_roll",
  WAITING_PROPERTY_DECISION: "waiting_property_decision",
  WAITING_DEBT_RESOLUTION: "waiting_debt_resolution",
  WAITING_AUCTION_BID: "waiting_auction_bid",
  GAME_OVER: "game_over",
};

export const MAX_HOUSES_PER_STREET = 4;
export const HOUSE_RENT_MULTIPLIERS = [1, 4, 8, 16, 32];
export const AUCTION_MIN_INCREMENT = 10;
export const DEFAULT_GAME_SETTINGS = {
  startingMoney: 1500,
  passStartBonus: 200,
  turnTimeSeconds: 90,
  auctionsEnabled: true,
};

export function createGame(playersCount, settings = {}) {
  const gameSettings = normalizeGameSettings(settings);
  const players = Array.from({ length: playersCount }, (_, index) => {
    const token = tokenOptions[index];

    return {
      id: `player-${index + 1}`,
      name: `Игрок ${index + 1}`,
      money: gameSettings.startingMoney,
      position: 0,
      tokenId: token.id,
      tokenColor: token.color,
        properties: [],
        bankrupt: false,
        disconnected: false,
        inTver: false,
        tverTurns: 0,
        doubleRollsInTurn: 0,
        vesyegonskTickets: 0,
      };
  });

  return createGameFromPlayers(players, gameSettings);
}

export function createGameFromPlayers(players, settings = {}) {
  const gameSettings = normalizeGameSettings(settings);

  return {
    settings: gameSettings,
    players: players.map((player, index) => {
      const fallbackToken = tokenOptions[index] ?? tokenOptions[0];
      const token = getTokenOption(player.tokenId ?? fallbackToken.id);

      return {
        id: player.id,
        name: player.name,
        money: gameSettings.startingMoney,
        position: player.position ?? 0,
        tokenId: token.id,
        tokenColor: token.color,
        properties: player.properties ?? [],
        bankrupt: false,
        disconnected: player.disconnected ?? false,
        skipTurns: player.skipTurns ?? 0,
        inTver: player.inTver ?? false,
        tverTurns: player.tverTurns ?? 0,
        doubleRollsInTurn: player.doubleRollsInTurn ?? 0,
        vesyegonskTickets: player.vesyegonskTickets ?? 0,
      };
    }),
    currentPlayerIndex: 0,
    cells: boardData.map((cell) => ({
      ...cell,
      ownerId: null,
      houses: cell.houses ?? 0,
      mortgaged: false,
    })),
    lastDice: null,
    lastMessage: "Игра началась.",
    lastCard: null,
    turnPhase: TURN_PHASES.WAITING_ROLL,
    pendingPropertyCellId: null,
    debtPlayerId: null,
    pendingTrade: null,
    auction: null,
    winnerId: null,
    logs: [createLogEntry("Игра началась.")],
  };
}

export function normalizeGameSettings(settings = {}) {
  return {
    startingMoney: clampNumber(settings.startingMoney, 500, 5000, DEFAULT_GAME_SETTINGS.startingMoney),
    passStartBonus: clampNumber(settings.passStartBonus, 0, 1000, DEFAULT_GAME_SETTINGS.passStartBonus),
    turnTimeSeconds: clampNumber(settings.turnTimeSeconds, 30, 300, DEFAULT_GAME_SETTINGS.turnTimeSeconds),
    auctionsEnabled: settings.auctionsEnabled !== false,
  };
}

export function rollDiceAndProcessTurn(state) {
  if (state.turnPhase === TURN_PHASES.GAME_OVER) return state;

  if (state.turnPhase !== TURN_PHASES.WAITING_ROLL) {
    const message =
      state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION
        ? "Сначала нужно покрыть долг или объявить банкротство."
        : state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID
          ? "Сначала нужно завершить аукцион."
        : "Сначала нужно принять решение по покупке объекта.";
    setMessage(state, message);
    return state;
  }

  const player = getCurrentPlayer(state);

  const dice1 = getRandomDice();
  const dice2 = getRandomDice();
  const total = dice1 + dice2;
  const isDouble = dice1 === dice2;

  state.lastDice = { dice1, dice2, total, isDouble };
  addGameLog(state, `${player.name} бросил кубики: ${dice1} + ${dice2} = ${total}.`);

  if (player.inTver) {
    processTverRoll(state, player, total, isDouble);
    return state;
  }

  if (isDouble) {
    player.doubleRollsInTurn = (player.doubleRollsInTurn ?? 0) + 1;

    if (player.doubleRollsInTurn >= 3) {
      sendPlayerToTver(state, player, "Третий дубль подряд");
      finishTurn(state);
      return state;
    }
  }

  movePlayer(state, player, total);
  processCellAfterMove(state, player);

  return state;
}

export function buyPendingProperty(state, playerId) {
  if (state.turnPhase === TURN_PHASES.GAME_OVER) return state;
  if (state.turnPhase !== TURN_PHASES.WAITING_PROPERTY_DECISION) return state;

  const player = getCurrentPlayer(state);
  if (player.id !== playerId) return state;

  const cell = getPendingCell(state);
  if (!cell) {
    finishTurn(state);
    return state;
  }

  if (cell.ownerId) {
    setMessage(state, `"${cell.title}" уже куплен.`);
    finishTurn(state);
    return state;
  }

  if (player.money < cell.price) {
    setMessage(state, `${player.name} не хватает денег на "${cell.title}".`);
    finishTurn(state);
    return state;
  }

  player.money -= cell.price;
  cell.ownerId = player.id;
  player.properties.push(cell.id);

  setMessage(state, `${player.name} покупает "${cell.title}" за ${cell.price}₽.`);
  finishTurn(state);

  return state;
}

export function skipPendingProperty(state, playerId) {
  if (state.turnPhase === TURN_PHASES.GAME_OVER) return state;
  if (state.turnPhase !== TURN_PHASES.WAITING_PROPERTY_DECISION) return state;

  const player = getCurrentPlayer(state);
  if (player.id !== playerId) return state;

  const cell = getPendingCell(state);

  setMessage(state, `${player.name} отказался покупать "${cell?.title ?? "объект"}".`);

  if (cell && !cell.ownerId && cell.price && state.settings?.auctionsEnabled !== false) {
    startAuction(state, cell, player.id);
  } else {
    finishTurn(state);
  }

  return state;
}

export function placeAuctionBid(state, playerId, bidAmount) {
  if (state.turnPhase !== TURN_PHASES.WAITING_AUCTION_BID || !state.auction) return state;

  const auction = state.auction;
  const bidderId = getCurrentAuctionBidderId(state);
  const player = state.players.find((item) => item.id === playerId);
  const bid = Math.floor(Number(bidAmount) || 0);
  const minBid = getAuctionMinBid(state);

  if (!player || bidderId !== player.id) return state;

  if (bid < minBid) {
    setMessage(state, `Минимальная ставка: ${minBid}₽.`);
    return state;
  }

  if (player.money < bid) {
    setMessage(state, `${player.name} не хватает денег для ставки ${bid}₽.`);
    return state;
  }

  auction.highestBid = bid;
  auction.highestBidderId = player.id;
  auction.passedPlayerIds = auction.passedPlayerIds.filter((id) => id !== player.id);

  const cell = getCellById(state, auction.cellId);
  setMessage(state, `${player.name} ставит ${bid}₽ за "${cell?.title ?? "объект"}".`);
  advanceAuctionTurn(state);

  return state;
}

export function passAuctionBid(state, playerId) {
  if (state.turnPhase !== TURN_PHASES.WAITING_AUCTION_BID || !state.auction) return state;

  const auction = state.auction;
  const bidderId = getCurrentAuctionBidderId(state);
  const player = state.players.find((item) => item.id === playerId);

  if (!player || bidderId !== player.id) return state;

  if (!auction.passedPlayerIds.includes(player.id)) {
    auction.passedPlayerIds.push(player.id);
  }

  const cell = getCellById(state, auction.cellId);
  setMessage(state, `${player.name} пасует на аукционе за "${cell?.title ?? "объект"}".`);
  advanceAuctionTurn(state);

  return state;
}

export function getAuctionMinBid(state) {
  const highestBid = state.auction?.highestBid ?? 0;
  return highestBid > 0 ? highestBid + AUCTION_MIN_INCREMENT : AUCTION_MIN_INCREMENT;
}

export function getCurrentAuctionBidderId(state) {
  if (!state.auction?.bidderOrder?.length) return null;
  return state.auction.bidderOrder[state.auction.currentBidderIndex] ?? null;
}

export function getRequiredActionPlayerId(state) {
  if (!state || state.turnPhase === TURN_PHASES.GAME_OVER) return null;

  if (state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID) {
    return getCurrentAuctionBidderId(state);
  }

  if (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION) {
    return state.debtPlayerId ?? null;
  }

  return getCurrentPlayer(state)?.id ?? null;
}

export function skipRequiredAction(state, reason = "Действие пропущено") {
  if (!state || state.turnPhase === TURN_PHASES.GAME_OVER) return state;

  const playerId = getRequiredActionPlayerId(state);
  const player = state.players.find((item) => item.id === playerId);
  const name = player?.name ?? "Игрок";

  if (state.turnPhase === TURN_PHASES.WAITING_ROLL) {
    setMessage(state, `${reason}: ${name} пропускает ход.`);
    finishTurn(state);
    return state;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_PROPERTY_DECISION) {
    setMessage(state, `${reason}: ${name} не покупает объект.`);
    return skipPendingProperty(state, playerId);
  }

  if (state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID) {
    setMessage(state, `${reason}: ${name} пасует на аукционе.`);
    return passAuctionBid(state, playerId);
  }

  if (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION) {
    setMessage(state, `${reason}: ${name} не покрыл долг.`);
    return declareBankruptcy(state, playerId);
  }

  return state;
}

export function getCurrentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

export function getCellById(state, cellId) {
  return state.cells.find((cell) => cell.id === cellId);
}

export function ownsFullGroup(state, playerId, groupId) {
  if (!groupId) return false;

  const groupCells = state.cells.filter(
    (cell) => cell.type === "street" && cell.group === groupId,
  );

  if (!groupCells.length) return false;

  return groupCells.every((cell) => cell.ownerId === playerId);
}

export function getRentInfo(state, cell) {
  if (cell.mortgaged) {
    return {
      baseRent: cell.rent ?? 0,
      amount: 0,
      multiplier: 0,
      isMonopoly: false,
      groupTitle: null,
      houses: cell.houses ?? 0,
      houseBonus: false,
    };
  }

  const baseRent = cell.rent ?? 0;
  const houses = cell.houses ?? 0;
  let multiplier = 1;
  let isMonopoly = false;
  let groupTitle = null;
  let houseBonus = false;

  if (cell.type === "street" && cell.group && cell.ownerId) {
    isMonopoly = ownsFullGroup(state, cell.ownerId, cell.group);

    if (isMonopoly) {
      groupTitle = getPropertyGroup(cell.group)?.title ?? cell.group;

      if (houses > 0) {
        multiplier = HOUSE_RENT_MULTIPLIERS[houses] ?? HOUSE_RENT_MULTIPLIERS[MAX_HOUSES_PER_STREET];
        houseBonus = true;
      } else {
        multiplier = 2;
      }
    }
  }

  return {
    baseRent,
    amount: baseRent * multiplier,
    multiplier,
    isMonopoly,
    groupTitle,
    houses,
    houseBonus,
  };
}

export function getHouseCost(cell) {
  if (!cell || cell.type !== "street") return 0;
  return Math.max(50, Math.round((cell.price ?? 0) * 0.5));
}

export function canBuildHouse(state, playerId, cellId) {
  if (!state || state.turnPhase !== TURN_PHASES.WAITING_ROLL) return false;

  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer || currentPlayer.id !== playerId) return false;

  const cell = getCellById(state, cellId);
  if (!cell || cell.type !== "street") return false;
  if (cell.ownerId !== playerId) return false;
  if (cell.mortgaged) return false;
  if (!ownsFullGroup(state, playerId, cell.group)) return false;
  if ((cell.houses ?? 0) >= MAX_HOUSES_PER_STREET) return false;

  return currentPlayer.money >= getHouseCost(cell);
}

export function buildHouse(state, playerId, cellId) {
  if (state.turnPhase === TURN_PHASES.GAME_OVER) return state;

  const player = getCurrentPlayer(state);

  if (!player || player.id !== playerId) {
    setMessage(state, "Строить дома может только игрок, который сейчас ходит.");
    return state;
  }

  const cell = getCellById(state, cellId);

  if (!cell) {
    setMessage(state, "Улица не найдена.");
    return state;
  }

  if (state.turnPhase !== TURN_PHASES.WAITING_ROLL) {
    setMessage(state, "Сначала завершите текущее действие.");
    return state;
  }

  if (cell.type !== "street") {
    setMessage(state, "Дома можно строить только на улицах.");
    return state;
  }

  if (cell.ownerId !== playerId) {
    setMessage(state, `"${cell.title}" не принадлежит игроку ${player.name}.`);
    return state;
  }

  if (cell.mortgaged) {
    setMessage(state, `На заложенной улице "${cell.title}" нельзя строить дома.`);
    return state;
  }

  if (!ownsFullGroup(state, playerId, cell.group)) {
    setMessage(state, `Для строительства нужно собрать всю группу улицы "${cell.title}".`);
    return state;
  }

  if ((cell.houses ?? 0) >= MAX_HOUSES_PER_STREET) {
    setMessage(state, `На "${cell.title}" уже максимум домов.`);
    return state;
  }

  const cost = getHouseCost(cell);

  if (player.money < cost) {
    setMessage(state, `${player.name} не хватает денег на дом для "${cell.title}". Нужно ${cost}₽.`);
    return state;
  }

  player.money -= cost;
  cell.houses = (cell.houses ?? 0) + 1;

  const rentInfo = getRentInfo(state, cell);
  setMessage(state, `${player.name} строит дом на "${cell.title}" за ${cost}₽. Домов: ${cell.houses}. Новая аренда: ${rentInfo.amount}₽.`);

  return state;
}

export function sellHouse(state, playerId, cellId) {
  const player = getCurrentPlayer(state);
  if (!canManageAssets(state, playerId) || !player || player.id !== playerId) return state;

  const cell = getCellById(state, cellId);
  if (!cell || cell.ownerId !== playerId || (cell.houses ?? 0) <= 0) return state;

  const refund = Math.floor(getHouseCost(cell) * 0.5);
  cell.houses -= 1;
  player.money += refund;

  setMessage(state, `${player.name} продаёт дом на "${cell.title}" и получает ${refund}₽.`);
  finishDebtIfResolved(state, player);

  return state;
}

export function mortgageProperty(state, playerId, cellId) {
  const player = getCurrentPlayer(state);
  if (!canManageAssets(state, playerId) || !player || player.id !== playerId) return state;

  const cell = getCellById(state, cellId);
  if (!cell || cell.ownerId !== playerId || cell.mortgaged) return state;

  if ((cell.houses ?? 0) > 0) {
    setMessage(state, `Перед залогом "${cell.title}" нужно продать дома на этой улице.`);
    return state;
  }

  const value = getMortgageValue(cell);
  cell.mortgaged = true;
  player.money += value;

  setMessage(state, `${player.name} закладывает "${cell.title}" и получает ${value}₽.`);
  finishDebtIfResolved(state, player);

  return state;
}

export function redeemProperty(state, playerId, cellId) {
  if (state.turnPhase !== TURN_PHASES.WAITING_ROLL) return state;

  const player = getCurrentPlayer(state);
  if (!player || player.id !== playerId) return state;

  const cell = getCellById(state, cellId);
  if (!cell || cell.ownerId !== playerId || !cell.mortgaged) return state;

  const cost = getRedeemCost(cell);
  if (player.money < cost) {
    setMessage(state, `${player.name} не хватает денег, чтобы выкупить "${cell.title}". Нужно ${cost}₽.`);
    return state;
  }

  cell.mortgaged = false;
  player.money -= cost;

  setMessage(state, `${player.name} выкупает "${cell.title}" за ${cost}₽.`);

  return state;
}

export function declareBankruptcy(state, playerId) {
  if (state.turnPhase !== TURN_PHASES.WAITING_DEBT_RESOLUTION) return state;

  const player = getCurrentPlayer(state);
  if (!player || player.id !== playerId || player.money >= 0) return state;

  bankruptPlayer(state, player);
  return state;
}

export function proposeTrade(state, fromPlayerId, toPlayerId, requestPropertyCellId, offerMoney) {
  if (state.turnPhase !== TURN_PHASES.WAITING_ROLL || state.pendingTrade) return state;

  const fromPlayer = getCurrentPlayer(state);
  const toPlayer = state.players.find((player) => player.id === toPlayerId);
  const cell = getCellById(state, requestPropertyCellId);
  const money = Math.max(0, Math.floor(Number(offerMoney) || 0));

  if (!fromPlayer || fromPlayer.id !== fromPlayerId || !toPlayer || toPlayer.bankrupt || toPlayer.id === fromPlayer.id) return state;
  if (!cell || cell.ownerId !== toPlayer.id) return state;

  if ((cell.houses ?? 0) > 0) {
    setMessage(state, `Нельзя предложить сделку по "${cell.title}", пока на объекте есть дома.`);
    return state;
  }

  if (fromPlayer.money < money) {
    setMessage(state, `${fromPlayer.name} не хватает денег для такого предложения.`);
    return state;
  }

  state.pendingTrade = {
    id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromPlayerId,
    toPlayerId,
    requestPropertyCellId,
    offerMoney: money,
  };

  setMessage(state, `${fromPlayer.name} предлагает ${toPlayer.name}: ${money}₽ за "${cell.title}".`);

  return state;
}

export function acceptTrade(state, playerId) {
  const trade = state.pendingTrade;
  if (!trade || trade.toPlayerId !== playerId) return state;

  const fromPlayer = state.players.find((player) => player.id === trade.fromPlayerId);
  const toPlayer = state.players.find((player) => player.id === trade.toPlayerId);
  const cell = getCellById(state, trade.requestPropertyCellId);

  if (!fromPlayer || !toPlayer || !cell || cell.ownerId !== toPlayer.id) {
    state.pendingTrade = null;
    setMessage(state, "Сделка отменена: объект больше недоступен.");
    return state;
  }

  if (fromPlayer.money < trade.offerMoney) {
    state.pendingTrade = null;
    setMessage(state, "Сделка отменена: у покупателя уже не хватает денег.");
    return state;
  }

  fromPlayer.money -= trade.offerMoney;
  toPlayer.money += trade.offerMoney;
  cell.ownerId = fromPlayer.id;
  transferPropertyId(toPlayer, fromPlayer, cell.id);

  state.pendingTrade = null;
  setMessage(state, `${toPlayer.name} принял сделку. "${cell.title}" переходит к ${fromPlayer.name} за ${trade.offerMoney}₽.`);

  return state;
}

export function rejectTrade(state, playerId) {
  const trade = state.pendingTrade;
  if (!trade || trade.toPlayerId !== playerId) return state;

  const fromPlayer = state.players.find((player) => player.id === trade.fromPlayerId);
  const toPlayer = state.players.find((player) => player.id === trade.toPlayerId);
  const cell = getCellById(state, trade.requestPropertyCellId);

  state.pendingTrade = null;
  setMessage(state, `${toPlayer?.name ?? "Игрок"} отклонил предложение ${fromPlayer?.name ?? "игрока"} по "${cell?.title ?? "объекту"}".`);

  return state;
}

export function getMortgageValue(cell) {
  return Math.floor((cell?.price ?? 0) * 0.5);
}

export function getRedeemCost(cell) {
  return Math.ceil(getMortgageValue(cell) * 1.1);
}


function movePlayer(state, player, steps) {
  const oldPosition = player.position;
  player.position = (player.position + steps) % state.cells.length;

  if (player.position < oldPosition) {
    const bonus = getPassStartBonus(state);
    player.money += bonus;
    setMessage(state, `${player.name} прошёл круг и получил ${bonus}₽.`);
  }
}

function processCellAfterMove(state, player) {
  const cell = state.cells[player.position];
  state.lastCard = null;

  if (cell.type === "street" || cell.type === "business") {
    processPropertyCellAfterMove(state, player, cell);
    return;
  }

  if (isEventCell(cell)) {
    processEventCell(state, player, cell);
    finishTurnOrResolveDebt(state, player);
    return;
  }

  if (cell.fine) {
    player.money -= cell.fine;
    setMessage(state, `${player.name} платит штраф ${cell.fine}₽.`);
    finishTurnOrResolveDebt(state, player);
    return;
  }

  if (cell.bonus) {
    player.money += cell.bonus;
    setMessage(state, `${player.name} получает бонус ${cell.bonus}₽.`);
    finishTurn(state);
    return;
  }

  setMessage(state, `${player.name} попал на "${cell.title}".`);
  finishTurn(state);
}

function processPropertyCellAfterMove(state, player, cell) {
  if (!cell.ownerId) {
    if (player.money >= cell.price) {
      state.turnPhase = TURN_PHASES.WAITING_PROPERTY_DECISION;
      state.pendingPropertyCellId = cell.id;
      setMessage(state, `${player.name} может купить "${cell.title}" за ${cell.price}₽. Базовая аренда: ${cell.rent}₽.`);
      return;
    }

    setMessage(state, `${player.name} попал на "${cell.title}", но денег на покупку не хватает.`);
    finishTurn(state);
    return;
  }

  if (cell.ownerId === player.id) {
    setMessage(state, `${player.name} попал на свою собственность "${cell.title}".`);
    finishTurn(state);
    return;
  }

  const owner = state.players.find((p) => p.id === cell.ownerId);

  if (!owner) {
    setMessage(state, `У "${cell.title}" не найден владелец.`);
    finishTurn(state);
    return;
  }

  const rentInfo = getRentInfo(state, cell);

  player.money -= rentInfo.amount;
  owner.money += rentInfo.amount;

  const monopolyText = rentInfo.isMonopoly
    ? ` Монополия: ${rentInfo.groupTitle}, аренда x${rentInfo.multiplier}.`
    : "";

  setMessage(state, `${player.name} платит аренду ${rentInfo.amount}₽ игроку ${owner.name}.${monopolyText}`);
  finishTurnOrResolveDebt(state, player);
}

function processEventCell(state, player, cell) {
  const deck = eventDecks[cell.type];

  if (!deck || !deck.cards.length) {
    setMessage(state, `${player.name} попал на "${cell.title}". Карточек пока нет.`);
    return;
  }

  const card = deck.cards[Math.floor(Math.random() * deck.cards.length)];
  state.lastCard = {
    deckTitle: deck.title,
    cellTitle: cell.title,
    ...card,
  };

  applyEventCard(state, player, card, deck.title);
}

function applyEventCard(state, player, card, deckTitle) {
  if (card.type === "money") {
    player.money += card.value;
    const actionText = card.value >= 0 ? `получает ${card.value}₽` : `платит ${Math.abs(card.value)}₽`;
    setMessage(state, `${deckTitle}: ${card.text} ${player.name} ${actionText}.`);
    return;
  }

  if (card.type === "moveTo") {
    movePlayerToCell(state, player, card.targetCellId, Boolean(card.collectStartBonus));
    setMessage(state, `${deckTitle}: ${card.text} ${player.name} переходит на "${state.cells[player.position].title}".`);
    return;
  }

  if (card.type === "moveToTver") {
    sendPlayerToTver(state, player, `${deckTitle}: ${card.text}`);
    return;
  }

  if (card.type === "vesyegonskTicket") {
    player.vesyegonskTickets = (player.vesyegonskTickets ?? 0) + 1;
    setMessage(state, `${deckTitle}: ${card.text} У ${player.name} теперь билетов: ${player.vesyegonskTickets}.`);
    return;
  }

  if (card.type === "moveSteps") {
    movePlayer(state, player, card.steps);
    setMessage(state, `${deckTitle}: ${card.text} ${player.name} теперь на "${state.cells[player.position].title}".`);
    return;
  }

  if (card.type === "skipTurn") {
    player.skipTurns = (player.skipTurns ?? 0) + (card.turns ?? 1);
    setMessage(state, `${deckTitle}: ${card.text} ${player.name} пропустит ход.`);
    return;
  }

  setMessage(state, `${deckTitle}: ${card.text}`);
}

function processTverRoll(state, player, total, isDouble) {
  if ((player.vesyegonskTickets ?? 0) > 0) {
    player.vesyegonskTickets -= 1;
    releasePlayerFromTver(state, player, "Билет до Твери");
    movePlayer(state, player, total);
    processCellAfterMove(state, player);
    return;
  }

  if (isDouble) {
    releasePlayerFromTver(state, player, "Дубль на кубиках");
    movePlayer(state, player, total);
    processCellAfterMove(state, player);
    return;
  }

  player.tverTurns = (player.tverTurns ?? 0) + 1;

  if (player.tverTurns >= 3) {
    releasePlayerFromTver(state, player, "Третья попытка");
    movePlayer(state, player, total);
    processCellAfterMove(state, player);
    return;
  }

  setMessage(state, `${player.name} остаётся в деревне. Нужен дубль или Билет до Твери.`);
  finishTurn(state);
}

function sendPlayerToTver(state, player, reason) {
  const tverIndex = state.cells.findIndex((cell) => cell.id === "tver");
  if (tverIndex !== -1) player.position = tverIndex;

  player.inTver = true;
  player.tverTurns = 0;
  player.doubleRollsInTurn = 0;

  setMessage(state, `${reason}: ${player.name} едет в деревню.`);
}

function releasePlayerFromTver(state, player, reason) {
  player.inTver = false;
  player.tverTurns = 0;
  player.doubleRollsInTurn = 0;

  addGameLog(state, `${player.name} выезжает из деревни. Причина: ${reason}.`);
}

function movePlayerToCell(state, player, targetCellId, collectStartBonus = false) {
  const targetIndex = state.cells.findIndex((cell) => cell.id === targetCellId);
  if (targetIndex === -1) return;

  const oldPosition = player.position;
  player.position = targetIndex;

  if (collectStartBonus || targetIndex < oldPosition) {
    const bonus = getPassStartBonus(state);
    player.money += bonus;
    addGameLog(state, `${player.name} получил ${bonus}₽ за переход через старт.`);
  }
}

function isEventCell(cell) {
  return Boolean(eventDecks[cell.type]);
}

function finishTurn(state) {
  if (state.turnPhase === TURN_PHASES.GAME_OVER) return;

  const currentPlayer = getCurrentPlayer(state);
  const shouldKeepTurn =
    state.lastDice?.isDouble &&
    currentPlayer &&
    !currentPlayer.inTver &&
    !currentPlayer.bankrupt &&
    !currentPlayer.disconnected &&
    (currentPlayer.doubleRollsInTurn ?? 0) > 0 &&
    (currentPlayer.doubleRollsInTurn ?? 0) < 3;

  state.turnPhase = TURN_PHASES.WAITING_ROLL;
  state.pendingPropertyCellId = null;
  state.debtPlayerId = null;
  state.auction = null;

  if (shouldKeepTurn) {
    setMessage(state, `${currentPlayer.name} выбросил дубль и ходит ещё раз.`);
  } else {
    if (currentPlayer) currentPlayer.doubleRollsInTurn = 0;
    nextTurn(state);
  }

  checkWinner(state);
}

function finishTurnOrResolveDebt(state, player) {
  if (player.money < 0) {
    if (hasRecoverableAssets(state, player.id)) {
      state.turnPhase = TURN_PHASES.WAITING_DEBT_RESOLUTION;
      state.debtPlayerId = player.id;
      state.pendingPropertyCellId = null;
      setMessage(state, `${player.name} должен покрыть долг ${Math.abs(player.money)}₽: продайте дома или заложите имущество.`);
      return;
    }

    bankruptPlayer(state, player);
    return;
  }

  finishTurn(state);
}

function nextTurn(state) {
  if (!state.players.length) return;

  let safetyCounter = 0;

  do {
    state.currentPlayerIndex =
      (state.currentPlayerIndex + 1) % state.players.length;

    const player = getCurrentPlayer(state);

    if (!player.disconnected && !player.bankrupt && (player.skipTurns ?? 0) <= 0) {
      return;
    }

    if ((player.skipTurns ?? 0) > 0) {
      player.skipTurns -= 1;
      addGameLog(state, `${player.name} пропускает ход.`);
    }

    safetyCounter += 1;
  } while (safetyCounter < state.players.length * 2);
}

function bankruptPlayer(state, player) {
  player.bankrupt = true;
  player.money = 0;
  player.properties = [];
  player.inTver = false;
  player.tverTurns = 0;
  player.doubleRollsInTurn = 0;
  player.vesyegonskTickets = 0;

  if (state.pendingTrade?.fromPlayerId === player.id || state.pendingTrade?.toPlayerId === player.id) {
    state.pendingTrade = null;
  }

  if (state.auction?.bidderOrder?.includes(player.id)) {
    state.auction.passedPlayerIds = [
      ...new Set([...(state.auction.passedPlayerIds ?? []), player.id]),
    ];
  }

  state.cells.forEach((cell) => {
    if (cell.ownerId !== player.id) return;

    cell.ownerId = null;
    cell.houses = 0;
    cell.mortgaged = false;
  });

  setMessage(state, `${player.name} объявлен банкротом. Его имущество возвращено банку.`);

  state.turnPhase = TURN_PHASES.WAITING_ROLL;
  state.debtPlayerId = null;
  state.pendingPropertyCellId = null;

  checkWinner(state);
  if (state.turnPhase !== TURN_PHASES.GAME_OVER) nextTurn(state);
}

function transferPropertyId(fromPlayer, toPlayer, cellId) {
  fromPlayer.properties = fromPlayer.properties.filter((propertyId) => propertyId !== cellId);
  if (!toPlayer.properties.includes(cellId)) toPlayer.properties.push(cellId);
}

function startAuction(state, cell, skippedPlayerId) {
  const bidderOrder = state.players
    .filter((player) => !player.bankrupt && !player.disconnected && player.money >= AUCTION_MIN_INCREMENT)
    .map((player) => player.id);

  if (!bidderOrder.length) {
    setMessage(state, `Аукцион за "${cell.title}" не состоялся: нет игроков с деньгами.`);
    finishTurn(state);
    return;
  }

  const skippedIndex = bidderOrder.indexOf(skippedPlayerId);
  const currentBidderIndex =
    skippedIndex >= 0 ? (skippedIndex + 1) % bidderOrder.length : 0;

  state.turnPhase = TURN_PHASES.WAITING_AUCTION_BID;
  state.pendingPropertyCellId = null;
  state.auction = {
    cellId: cell.id,
    highestBid: 0,
    highestBidderId: null,
    bidderOrder,
    currentBidderIndex,
    passedPlayerIds: [],
  };

  const bidder = state.players.find((player) => player.id === bidderOrder[currentBidderIndex]);
  setMessage(state, `Начался аукцион за "${cell.title}". Первая ставка от ${bidder?.name ?? "игрока"}: минимум ${AUCTION_MIN_INCREMENT}₽.`);
}

function advanceAuctionTurn(state) {
  const auction = state.auction;
  if (!auction) return;

  const activeBidderIds = auction.bidderOrder.filter((playerId) => {
    const player = state.players.find((item) => item.id === playerId);
    return (
      player &&
      !player.bankrupt &&
      !player.disconnected &&
      !auction.passedPlayerIds.includes(playerId) &&
      player.money >= getAuctionMinBid(state)
    );
  });

  if (auction.highestBidderId) {
    const competitors = activeBidderIds.filter((playerId) => playerId !== auction.highestBidderId);
    if (!competitors.length) {
      finishAuctionWithWinner(state);
      return;
    }
  } else if (!activeBidderIds.length) {
    finishAuctionWithoutWinner(state);
    return;
  }

  let safetyCounter = 0;
  do {
    auction.currentBidderIndex = (auction.currentBidderIndex + 1) % auction.bidderOrder.length;
    const bidderId = getCurrentAuctionBidderId(state);

    if (activeBidderIds.includes(bidderId)) {
      const bidder = state.players.find((player) => player.id === bidderId);
      const cell = getCellById(state, auction.cellId);
      setMessage(state, `Аукцион за "${cell?.title ?? "объект"}": ход ставки ${bidder?.name ?? "игрока"}. Минимум ${getAuctionMinBid(state)}₽.`);
      return;
    }

    safetyCounter += 1;
  } while (safetyCounter <= auction.bidderOrder.length);

  if (auction.highestBidderId) {
    finishAuctionWithWinner(state);
  } else {
    finishAuctionWithoutWinner(state);
  }
}

function finishAuctionWithWinner(state) {
  const auction = state.auction;
  const cell = getCellById(state, auction.cellId);
  const winner = state.players.find((player) => player.id === auction.highestBidderId);

  if (!cell || !winner || winner.money < auction.highestBid) {
    finishAuctionWithoutWinner(state);
    return;
  }

  winner.money -= auction.highestBid;
  cell.ownerId = winner.id;
  if (!winner.properties.includes(cell.id)) winner.properties.push(cell.id);

  setMessage(state, `${winner.name} выигрывает аукцион и покупает "${cell.title}" за ${auction.highestBid}₽.`);
  finishTurn(state);
}

function finishAuctionWithoutWinner(state) {
  const cell = getCellById(state, state.auction?.cellId);
  setMessage(state, `Аукцион за "${cell?.title ?? "объект"}" завершился без покупки.`);
  finishTurn(state);
}

function checkWinner(state) {
  const activePlayers = state.players.filter((player) => !player.bankrupt);

  if (activePlayers.length === 1) {
    state.winnerId = activePlayers[0].id;
    state.turnPhase = TURN_PHASES.GAME_OVER;
    setMessage(state, `${activePlayers[0].name} победил!`);
  }
}

function canManageAssets(state, playerId) {
  return (
    state.turnPhase === TURN_PHASES.WAITING_ROLL ||
    (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION && state.debtPlayerId === playerId)
  );
}

function finishDebtIfResolved(state, player) {
  if (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION && player.money >= 0) {
    setMessage(state, `${player.name} покрыл долг и продолжает игру.`);
    finishTurn(state);
  }
}

function hasRecoverableAssets(state, playerId) {
  return state.cells.some((cell) => {
    if (cell.ownerId !== playerId) return false;
    if ((cell.houses ?? 0) > 0) return true;
    return !cell.mortgaged && getMortgageValue(cell) > 0;
  });
}

function getPassStartBonus(state) {
  return state.settings?.passStartBonus ?? DEFAULT_GAME_SETTINGS.passStartBonus;
}

function clampNumber(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getPendingCell(state) {
  if (!state.pendingPropertyCellId) return null;
  return getCellById(state, state.pendingPropertyCellId);
}

function setMessage(state, message) {
  state.lastMessage = message;
  addGameLog(state, message);
}

function addGameLog(state, message) {
  if (!Array.isArray(state.logs)) state.logs = [];
  state.logs.push(createLogEntry(message));
  state.logs = state.logs.slice(-40);
}

function createLogEntry(message) {
  return {
    time: new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    message,
  };
}

function getRandomDice() {
  return Math.floor(Math.random() * 6) + 1;
}
