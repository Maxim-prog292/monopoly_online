import { getPropertyGroup, getTokenOption } from "./data.js";
import {
  canBuildHouse,
  getAuctionMinBid,
  getCellById,
  getCurrentPlayer,
  getCurrentAuctionBidderId,
  getHouseCost,
  getMortgageValue,
  getRentInfo,
  getRedeemCost,
  MAX_HOUSES_PER_STREET,
  ownsFullGroup,
  TURN_PHASES,
} from "./gameLogic.js";

export function render(state, elements, options = {}) {
  renderBoard(state, elements.board);
  renderPlayers(state, elements.playersList, options);
  renderTurn(state, elements.currentPlayerName);
  renderDice(state, elements.diceResult);
  renderCellInfo(state, elements.cellInfo, options);
  renderPropertyActions(state, elements, options);
  renderGameLog(state, elements.gameLog);
  updateRollButton(state, elements, options);
}

function renderBoard(state, board) {
  board.innerHTML = "";

  for (let gridIndex = 0; gridIndex < 121; gridIndex++) {
    const cellIndex = getCellIndexByGridIndex(gridIndex);

    if (cellIndex === null) {
      const empty = document.createElement("div");
      empty.className = "cell empty";
      board.appendChild(empty);
      continue;
    }

    const cell = state.cells[cellIndex];
    const cellEl = document.createElement("div");
    cellEl.className = `cell ${cell.type}`;

    if (cell.group) {
      cellEl.classList.add(`group-${cell.group}`);
    }

    if (cell.ownerId) {
      cellEl.classList.add("owned");
    }

    if (cell.mortgaged) {
      cellEl.classList.add("mortgaged");
    }

    const owner = cell.ownerId
      ? state.players.find((player) => player.id === cell.ownerId)
      : null;

    const group = cell.group ? getPropertyGroup(cell.group) : null;
    const rentInfo = cell.price ? getRentInfo(state, cell) : null;
    const hasMonopoly = Boolean(rentInfo?.isMonopoly);

    if (hasMonopoly) {
      cellEl.classList.add("monopoly");
    }

    const playersOnCell = state.players.filter(
      (player) => player.position === cellIndex,
    );

    cellEl.innerHTML = `
      ${group ? `<div class="cell-group-strip" style="background:${group.color}"></div>` : ""}
      <div class="cell-title">${cell.title}</div>
      ${group ? `<div class="cell-group-name">${group.title}</div>` : ""}
      ${cell.price ? `<div class="cell-price">${cell.mortgaged ? "Залог" : `${cell.price}₽${hasMonopoly ? ` · ${rentInfo.amount}₽` : ""}`}</div>` : ""}
      ${cell.houses ? `<div class="cell-houses">${"🏠".repeat(cell.houses)}</div>` : ""}
      ${
        owner
          ? `<div class="cell-owner" style="background:${owner.tokenColor}"></div>`
          : ""
      }
      <div class="tokens">
        ${playersOnCell
          .map((player) => {
            const token = getTokenOption(player.tokenId);

            return `
              <span class="token token-emoji" style="background:${token.color}">${token.icon}</span>
            `;
          })
          .join("")}
      </div>
    `;

    board.appendChild(cellEl);
  }
}

function renderPlayers(state, playersList, options = {}) {
  playersList.innerHTML = "";
  playersList.insertAdjacentHTML("beforeend", renderOwnershipOverview(state));
  playersList.insertAdjacentHTML("beforeend", renderPendingTrade(state, options));

  state.players.forEach((player, index) => {
    const card = document.createElement("div");
    card.className = `player-card ${index === state.currentPlayerIndex ? "active" : ""}`;

    const token = getTokenOption(player.tokenId);
    const ownedCells = player.properties
      .map((propertyId) => getCellById(state, propertyId))
      .filter(Boolean);
    const propertyNames = ownedCells.map((cell) => {
      const rentInfo = getRentInfo(state, cell);
      const housesText = cell.houses ? ` 🏠${cell.houses}` : "";
      const mortgageText = cell.mortgaged ? " · залог" : "";
      return rentInfo.isMonopoly
        ? `${cell.title}${housesText} x${rentInfo.multiplier}${mortgageText}`
        : `${cell.title}${housesText}${mortgageText}`;
    });
    const buildableCells = getBuildableCells(state, player.id);
    const canThisClientBuild = index === state.currentPlayerIndex && (!options.isOnline || player.id === options.playerId);
    const canThisClientManageAssets =
      canThisClientBuild &&
      (state.turnPhase === TURN_PHASES.WAITING_ROLL ||
        (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION && state.debtPlayerId === player.id));
    const canCurrentClientOfferTrade =
      index !== state.currentPlayerIndex &&
      state.turnPhase === TURN_PHASES.WAITING_ROLL &&
      !state.pendingTrade &&
      !player.bankrupt &&
      (!options.isOnline || getCurrentPlayer(state).id === options.playerId);
    const monopolyGroups = getPlayerMonopolyGroups(state, player.id);

    card.innerHTML = `
      <div class="player-top">
        <span class="token token-emoji" style="background:${token.color}">${token.icon}</span>
        <strong>${player.name}${player.disconnected ? " 🔌" : ""}${player.bankrupt ? " · банкрот" : ""}</strong>
      </div>
      <div class="player-money">Баланс: ${player.money}₽</div>
      <div>Позиция: ${state.cells[player.position].title}</div>
      ${player.inTver ? `<div class="player-status">В деревне · попытка ${player.tverTurns ?? 0}/3</div>` : ""}
      ${player.vesyegonskTickets ? `<div class="player-status">Билет до Твери: ${player.vesyegonskTickets}</div>` : ""}
      <div>Собственность: ${propertyNames.length}</div>
      ${
        monopolyGroups.length
          ? `<div class="player-monopolies">🔥 ${monopolyGroups.join(", ")}</div>`
          : ""
      }
      ${
        buildableCells.length && canThisClientBuild
          ? `<div class="build-panel">
              <strong>Улучшения</strong>
              ${buildableCells
                .map((cell) => `
                  <button class="build-house-btn" data-cell-id="${cell.id}">
                    Построить дом: ${cell.title} · ${getHouseCost(cell)}₽ · ${cell.houses ?? 0}/${MAX_HOUSES_PER_STREET}
                  </button>
                `)
                .join("")}
            </div>`
          : ""
      }
      ${canThisClientManageAssets ? renderAssetActions(state, player, ownedCells) : ""}
      ${canCurrentClientOfferTrade ? renderTradeTargets(state, player, ownedCells) : ""}
      ${
        propertyNames.length
          ? `<div class="player-properties">${propertyNames.join(", ")}</div>`
          : ""
      }
    `;

    playersList.appendChild(card);
  });
}

function renderOwnershipOverview(state) {
  const groups = [
    ...new Set(
      state.cells
        .filter((cell) => cell.type === "street" && cell.group)
        .map((cell) => cell.group),
    ),
  ];

  return `
    <div class="ownership-overview">
      <strong>Группы собственности</strong>
      ${groups
        .map((groupId) => {
          const group = getPropertyGroup(groupId);
          const cells = state.cells.filter((cell) => cell.group === groupId);

          return `
            <div class="ownership-group">
              <div class="ownership-group-title" style="border-color:${group?.color ?? "#fff"}">
                ${group?.title ?? groupId}
              </div>
              <div class="ownership-cells">
                ${cells
                  .map((cell) => {
                    const owner = cell.ownerId ? state.players.find((player) => player.id === cell.ownerId) : null;
                    const token = owner ? getTokenOption(owner.tokenId) : null;
                    const flags = `${cell.houses ? ` 🏠${cell.houses}` : ""}${cell.mortgaged ? " · залог" : ""}`;

                    return `
                      <span class="ownership-cell ${cell.mortgaged ? "is-mortgaged" : ""}">
                        ${token ? `<span class="ownership-token" style="background:${token.color}">${token.icon}</span>` : ""}
                        ${cell.title}${flags}
                      </span>
                    `;
                  })
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPendingTrade(state, options, variant = "panel") {
  const trade = state.pendingTrade;
  if (!trade) return "";

  const fromPlayer = state.players.find((player) => player.id === trade.fromPlayerId);
  const toPlayer = state.players.find((player) => player.id === trade.toPlayerId);
  const cell = getCellById(state, trade.requestPropertyCellId);
  const canAnswer = !options.isOnline || options.playerId === trade.toPlayerId;

  return `
    <div class="trade-card ${variant === "event" ? "trade-card-event" : ""}">
      <strong>Сделка</strong>
      <div>${fromPlayer?.name ?? "Игрок"} предлагает ${toPlayer?.name ?? "игроку"} ${trade.offerMoney}₽ за "${cell?.title ?? "объект"}".</div>
      ${
        canAnswer
          ? `<div class="trade-actions">
              <button class="trade-action-btn" data-action="accept">Принять</button>
              <button class="trade-action-btn secondary-btn" data-action="reject">Отклонить</button>
            </div>`
          : `<div class="muted">Ожидается ответ игрока ${toPlayer?.name ?? ""}.</div>`
      }
    </div>
  `;
}

function renderTradeTargets(state, player, ownedCells) {
  const tradeableCells = ownedCells.filter((cell) => (cell.houses ?? 0) === 0);
  if (!tradeableCells.length) return "";

  return `
    <div class="trade-panel">
      <strong>Предложить сделку</strong>
      ${tradeableCells
        .map((cell) => `
          <button
            class="trade-action-btn"
            data-action="propose"
            data-target-player-id="${player.id}"
            data-cell-id="${cell.id}"
          >
            Купить: ${cell.title}${cell.mortgaged ? " · залог" : ""}
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderAssetActions(state, player, ownedCells) {
  const actionButtons = ownedCells
    .flatMap((cell) => {
      const buttons = [];

      if ((cell.houses ?? 0) > 0) {
        buttons.push(`
          <button class="asset-action-btn" data-action="sell-house" data-cell-id="${cell.id}">
            Продать дом: ${cell.title} · +${Math.floor(getHouseCost(cell) * 0.5)}₽
          </button>
        `);
      }

      if (!cell.mortgaged && (cell.houses ?? 0) === 0) {
        buttons.push(`
          <button class="asset-action-btn" data-action="mortgage" data-cell-id="${cell.id}">
            Заложить: ${cell.title} · +${getMortgageValue(cell)}₽
          </button>
        `);
      }

      if (cell.mortgaged && state.turnPhase === TURN_PHASES.WAITING_ROLL) {
        buttons.push(`
          <button
            class="asset-action-btn"
            data-action="redeem"
            data-cell-id="${cell.id}"
            ${player.money < getRedeemCost(cell) ? "disabled" : ""}
          >
            Выкупить: ${cell.title} · ${getRedeemCost(cell)}₽
          </button>
        `);
      }

      return buttons;
    })
    .join("");

  const bankruptcyButton =
    state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION && state.debtPlayerId === player.id
      ? `<button class="asset-action-btn danger" data-action="bankrupt">Банкротство</button>`
      : "";

  if (!actionButtons && !bankruptcyButton) return "";

  return `
    <div class="asset-panel">
      <strong>${state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION ? "Покрыть долг" : "Имущество"}</strong>
      ${actionButtons}
      ${bankruptcyButton}
    </div>
  `;
}

function getPlayerMonopolyGroups(state, playerId) {
  const groupIds = [
    ...new Set(
      state.cells
        .filter((cell) => cell.type === "street" && cell.group)
        .map((cell) => cell.group),
    ),
  ];

  return groupIds
    .filter((groupId) => ownsFullGroup(state, playerId, groupId))
    .map((groupId) => getPropertyGroup(groupId)?.title ?? groupId);
}

function getBuildableCells(state, playerId) {
  return state.cells.filter((cell) => canBuildHouse(state, playerId, cell.id));
}

function renderTurn(state, currentPlayerName) {
  const player = getCurrentPlayer(state);
  const winner = state.winnerId ? state.players.find((item) => item.id === state.winnerId) : null;
  currentPlayerName.textContent = winner ? `Победитель: ${winner.name}` : getTurnStatusText(state, player);
}

function getTurnStatusText(state, player) {
  if (state.turnPhase === TURN_PHASES.WAITING_PROPERTY_DECISION) {
    return `Решает покупку: ${player.name}`;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION) {
    const debtPlayer = state.players.find((item) => item.id === state.debtPlayerId) ?? player;
    return `Покрывает долг: ${debtPlayer.name}`;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID) {
    const bidderId = getCurrentAuctionBidderId(state);
    const bidder = state.players.find((item) => item.id === bidderId);
    return `Ставка аукциона: ${bidder?.name ?? "игрок"}`;
  }

  return `Бросает кубики: ${player.name}`;
}

function renderDice(state, diceResult) {
  if (!state.lastDice) {
    diceResult.textContent = "Кубики: —";
    return;
  }

  const { dice1, dice2, total, isDouble } = state.lastDice;
  diceResult.textContent = `Кубики: ${dice1} + ${dice2} = ${total}${isDouble ? " · дубль" : ""}`;
}

function renderCellInfo(state, cellInfo, options = {}) {
  let extraInfo = "";

  if (state.turnPhase === TURN_PHASES.WAITING_PROPERTY_DECISION) {
    const cell = getCellById(state, state.pendingPropertyCellId);

    if (cell) {
      const group = cell.group ? getPropertyGroup(cell.group) : null;
      const rentInfo = getRentInfo(state, cell);

      extraInfo = `
        <div class="property-decision-info">
          <strong>${cell.title}</strong><br>
          ${group ? `<span class="property-group-label" style="border-color:${group.color}">${group.title}</span><br>` : ""}
          Стоимость: ${cell.price}₽<br>
          Базовая аренда: ${cell.rent}₽<br>
          ${cell.houses ? `Домов: ${cell.houses}<br>` : ""}
          ${rentInfo.isMonopoly ? `🔥 Монополия: аренда ${rentInfo.amount}₽` : ""}
        </div>
      `;
    }
  }

  if (state.lastCard) {
    extraInfo += `
      <div class="event-card-info">
        <strong>${state.lastCard.deckTitle}</strong><br>
        ${state.lastCard.text}
      </div>
    `;
  }

  if (state.pendingTrade) {
    extraInfo += renderPendingTrade(state, options, "event");
  }

  if (state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID && state.auction) {
    extraInfo += renderAuctionInfo(state, options);
  }

  cellInfo.innerHTML = `
    <h3>Событие</h3>
    ${renderGameSettingsSummary(state)}
    <p>${state.lastMessage}</p>
    ${renderWinnerInfo(state)}
    ${extraInfo}
  `;
}

function renderGameSettingsSummary(state) {
  const settings = state.settings;
  if (!settings) return "";

  return `
    <div class="settings-summary">
      Старт: ${settings.startingMoney}₽ · Круг: ${settings.passStartBonus}₽ · Таймер: ${settings.turnTimeSeconds}с · Аукционы: ${settings.auctionsEnabled ? "да" : "нет"}
    </div>
  `;
}

function renderWinnerInfo(state) {
  if (state.turnPhase !== TURN_PHASES.GAME_OVER || !state.winnerId) return "";

  const winner = state.players.find((player) => player.id === state.winnerId);
  if (!winner) return "";

  return `
    <div class="winner-card">
      <strong>${winner.name} победил</strong>
      <span>Можно начать новую игру из боковой панели.</span>
    </div>
  `;
}

function renderAuctionInfo(state, options) {
  const auction = state.auction;
  const cell = getCellById(state, auction.cellId);
  const highestBidder = auction.highestBidderId
    ? state.players.find((player) => player.id === auction.highestBidderId)
    : null;
  const bidderId = getCurrentAuctionBidderId(state);
  const bidder = state.players.find((player) => player.id === bidderId);
  const canAct = !options.isOnline || options.playerId === bidderId;

  return `
    <div class="auction-card">
      <strong>Аукцион: ${cell?.title ?? "объект"}</strong>
      <div>Текущая ставка: ${auction.highestBid || "нет"}${auction.highestBid ? "₽" : ""}</div>
      <div>Лидер: ${highestBidder?.name ?? "пока никто"}</div>
      <div>Ставит: ${bidder?.name ?? "игрок"} · минимум ${getAuctionMinBid(state)}₽</div>
      ${
        canAct
          ? `<div class="auction-actions">
              <button class="auction-action-btn" data-action="bid">Сделать ставку</button>
              <button class="auction-action-btn secondary-btn" data-action="pass">Пас</button>
            </div>`
          : `<div class="muted">Ожидается ставка игрока ${bidder?.name ?? ""}.</div>`
      }
    </div>
  `;
}

function renderPropertyActions(state, elements, options) {
  if (!elements.propertyActions || !elements.buyPropertyBtn || !elements.skipPropertyBtn) return;

  const currentPlayer = getCurrentPlayer(state);
  const isWaitingDecision = state.turnPhase === TURN_PHASES.WAITING_PROPERTY_DECISION;
  const canCurrentClientAct = !options.isOnline || currentPlayer.id === options.playerId;

  if (state.turnPhase === TURN_PHASES.GAME_OVER) {
    elements.propertyActions.classList.add("hidden");
  } else if (isWaitingDecision && canCurrentClientAct) {
    elements.propertyActions.classList.remove("hidden");
  } else {
    elements.propertyActions.classList.add("hidden");
  }
}

function renderGameLog(state, gameLog) {
  if (!gameLog) return;

  const logs = Array.isArray(state.logs) ? state.logs : [];

  gameLog.innerHTML = `
    <h3>Лог партии</h3>
    <div class="game-log-list">
      ${logs
        .slice(-10)
        .reverse()
        .map((entry) => `<div><span>${entry.time}</span> ${entry.message}</div>`)
        .join("")}
    </div>
  `;
}

function updateRollButton(state, elements, options) {
  const currentPlayer = getCurrentPlayer(state);
  const isWaitingRoll = state.turnPhase === TURN_PHASES.WAITING_ROLL;
  const canCurrentClientRoll = !options.isOnline || currentPlayer.id === options.playerId;

  elements.rollDiceBtn.disabled = !isWaitingRoll || !canCurrentClientRoll;

  if (state.turnPhase === TURN_PHASES.GAME_OVER) {
    elements.rollDiceBtn.textContent = "Игра окончена";
    elements.rollDiceBtn.disabled = true;
    return;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION) {
    elements.rollDiceBtn.textContent = "Нужно покрыть долг";
    return;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_AUCTION_BID) {
    elements.rollDiceBtn.textContent = "Идёт аукцион";
    return;
  }

  if (state.turnPhase === TURN_PHASES.WAITING_PROPERTY_DECISION) {
    elements.rollDiceBtn.textContent = "Ожидается решение";
    return;
  }

  if (options.isOnline && !canCurrentClientRoll) {
    elements.rollDiceBtn.textContent = "Не твой ход";
    return;
  }

  elements.rollDiceBtn.textContent = "Бросить кубики";
}

function getCellIndexByGridIndex(gridIndex) {
  const row = Math.floor(gridIndex / 11);
  const col = gridIndex % 11;

  if (row === 10) return 10 - col;
  if (col === 0) return 10 + (10 - row);
  if (row === 0) return 20 + col;
  if (col === 10) return 30 + row;

  return null;
}
