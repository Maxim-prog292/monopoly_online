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
  renderBoard(state, elements.board, options);
  renderPlayersStrip(state, elements.playersStrip);
  renderPlayers(state, elements.playersList, options);
  renderPropertyDock(state, elements.propertyDock, options);
  renderTurn(state, elements.currentPlayerName);
  renderDice(state, elements.diceResult);
  renderCellInfo(state, elements.cellInfo, options);
  renderPropertyActions(state, elements, options);
  renderGameLog(state, elements.gameLog);
  updateRollButton(state, elements, options);
}

function renderPlayersStrip(state, playersStrip) {
  if (!playersStrip) return;

  playersStrip.innerHTML = state.players
    .map((player, index) => {
      const token = getTokenOption(player.tokenId);
      const isActive = index === state.currentPlayerIndex;
      const position = state.cells[player.position]?.title ?? "Старт";
      const status = player.bankrupt
        ? "Банкрот"
        : player.disconnected
          ? "Отключён"
          : player.inTver
            ? "В деревне"
            : isActive
              ? "Ходит"
              : "Ждёт";

      return `
        <div class="player-strip-card ${isActive ? "active" : ""} ${player.bankrupt ? "bankrupt" : ""}">
          <span class="token token-emoji" style="background:${token.color}">${token.icon}</span>
          <div class="player-strip-main">
            <strong>${player.name}</strong>
            <span>${status}</span>
          </div>
          <div class="player-strip-stat">
            <b>${player.money}₽</b>
            <span>${player.properties.length} объект.</span>
          </div>
          <div class="player-strip-position">${position}</div>
        </div>
      `;
    })
    .join("");
}

function renderBoard(state, board, options = {}) {
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
    cellEl.className = `cell ${cell.type} ${getCellSideClass(cellIndex)}`;
    cellEl.dataset.cellIndex = cellIndex;
    cellEl.dataset.cellId = cell.id;
    cellEl.title = cell.title;

    if (cell.group) {
      cellEl.classList.add(`group-${cell.group}`);
    }

    if (cell.ownerId) {
      cellEl.classList.add("owned");
    }

    if (cell.mortgaged) {
      cellEl.classList.add("mortgaged");
    }

    if (options.selectedCellId === cell.id) {
      cellEl.classList.add("selected");
    }

    if (options.movePath?.includes(cellIndex)) {
      cellEl.classList.add("move-path");
    }

    if (options.completedMovePath?.includes(cellIndex)) {
      cellEl.classList.add("move-path-completed");
    }

    if (options.moveTargetPosition === cellIndex) {
      cellEl.classList.add("move-target");
    }

    const visualPositions = options.visualPositions ?? {};
    const playersOnCell = state.players.filter(
      (player) => (visualPositions[player.id] ?? player.position) === cellIndex,
    );
    const owner = cell.ownerId
      ? state.players.find((player) => player.id === cell.ownerId)
      : null;

    const group = cell.group ? getPropertyGroup(cell.group) : null;
    const rentInfo = cell.price ? getRentInfo(state, cell) : null;
    const hasMonopoly = Boolean(rentInfo?.isMonopoly);

    if (hasMonopoly) {
      cellEl.classList.add("monopoly");
    }

    if (playersOnCell.some((player) => player.id === state.players[state.currentPlayerIndex]?.id)) {
      cellEl.classList.add("current-player-cell");
    }

    const ownerInitial = owner?.name?.trim()?.slice(0, 1).toUpperCase() ?? "";
    const houses = Math.max(0, cell.houses ?? 0);

    cellEl.innerHTML = `
      ${group ? `<div class="cell-group-strip" style="background:${group.color}"></div>` : ""}
      <div class="cell-title">${cell.title}</div>
      ${group ? `<div class="cell-group-name">${group.title}</div>` : ""}
      ${cell.price ? `<div class="cell-price">${cell.mortgaged ? "Залог" : `${cell.price}₽${hasMonopoly ? ` · ${rentInfo.amount}₽` : ""}`}</div>` : ""}
      ${
        houses
          ? `<div class="cell-houses" aria-label="Домов: ${houses}">
              ${Array.from({ length: houses }, () => "<span></span>").join("")}
            </div>`
          : ""
      }
      ${cell.mortgaged ? "<div class=\"mortgage-ribbon\">Залог</div>" : ""}
      ${
        owner
          ? `<div class="cell-owner" style="background:${owner.tokenColor}" title="Владелец: ${owner.name}">${ownerInitial}</div>`
          : ""
      }
      <div class="tokens">
        ${playersOnCell
          .map((player) => {
            const token = getTokenOption(player.tokenId);
            const isMoving = visualPositions[player.id] !== undefined;

            return `
              <span class="token token-emoji ${isMoving ? "is-moving" : ""}" style="background:${token.color}">${token.icon}</span>
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

function renderPropertyDock(state, propertyDock, options = {}) {
  if (!propertyDock) return;

  const mode = options.propertyDockMode === "all" ? "all" : "mine";
  const currentPlayer = getCurrentPlayer(state);
  const activePlayer = options.isOnline
    ? state.players.find((player) => player.id === options.playerId)
    : currentPlayer.properties.length
      ? currentPlayer
      : state.players.find((player) => player.properties.length);

  if (!activePlayer && mode === "mine") {
    propertyDock.classList.add("hidden");
    propertyDock.innerHTML = "";
    return;
  }

  const dockGroups =
    mode === "all"
      ? state.players
          .map((player) => ({
            player,
            cells: player.properties.map((propertyId) => getCellById(state, propertyId)).filter(Boolean),
          }))
          .filter((group) => group.cells.length)
      : [
          {
            player: activePlayer,
            cells: activePlayer.properties.map((propertyId) => getCellById(state, propertyId)).filter(Boolean),
          },
        ];
  const totalOwnedCells = dockGroups.reduce((total, group) => total + group.cells.length, 0);

  if (!totalOwnedCells) {
    propertyDock.classList.add("hidden");
    propertyDock.innerHTML = "";
    return;
  }

  propertyDock.classList.remove("hidden");
  propertyDock.innerHTML = `
    <div class="property-dock-head">
      <strong>${mode === "all" ? "Собственность игроков" : `Собственность: ${activePlayer.name}`}</strong>
      <div class="property-dock-controls">
        <button type="button" data-property-dock-mode="mine" class="${mode === "mine" ? "active" : ""}">Моё</button>
        <button type="button" data-property-dock-mode="all" class="${mode === "all" ? "active" : ""}">Все</button>
        <span>${totalOwnedCells}</span>
      </div>
    </div>
    <div class="property-card-row">
      ${dockGroups
        .map((group) => `
          <div class="property-owner-group">
            ${mode === "all" ? renderPropertyOwnerLabel(group.player) : ""}
            ${renderPropertyGroupSections(state, group.player, group.cells, {
              ...options,
              canManageDockCard: mode === "mine",
              showOwnerBadge: mode === "all",
              showTradeAction: mode === "all",
            })}
          </div>
        `)
        .join("")}
    </div>
  `;
}

function renderPropertyCard(state, player, cell, options = {}) {
  const group = cell.group ? getPropertyGroup(cell.group) : null;
  const rentInfo = getRentInfo(state, cell);
  const currentPlayer = getCurrentPlayer(state);
  const canManage =
    options.canManageDockCard !== false &&
    (!options.isOnline || player.id === options.playerId) &&
    (state.turnPhase === TURN_PHASES.WAITING_ROLL ||
      (state.turnPhase === TURN_PHASES.WAITING_DEBT_RESOLUTION && state.debtPlayerId === player.id));
  const canOfferTrade =
    options.showTradeAction &&
    currentPlayer &&
    currentPlayer.id !== player.id &&
    (!options.isOnline || currentPlayer.id === options.playerId) &&
    state.turnPhase === TURN_PHASES.WAITING_ROLL &&
    !state.pendingTrade &&
    !player.bankrupt &&
    (cell.houses ?? 0) === 0;
  const canBuild = canBuildHouse(state, player.id, cell.id);
  const houseCost = getHouseCost(cell);
  const mortgageValue = getMortgageValue(cell);
  const redeemCost = getRedeemCost(cell);

  return `
    <article
      class="property-card ${cell.mortgaged ? "is-mortgaged" : ""} ${options.selectedCellId === cell.id ? "is-selected" : ""}"
      data-cell-id="${cell.id}"
      tabindex="0"
      style="--property-color:${group?.color ?? "#8fa0b0"}"
    >
      <div class="property-card-strip"></div>
      ${options.showOwnerBadge ? `<div class="property-card-owner" style="background:${player.tokenColor}">${player.name.slice(0, 1).toUpperCase()}</div>` : ""}
      <div class="property-card-title">${cell.title}</div>
      <div class="property-card-meta">${group?.title ?? getCellTypeLabel(cell)}</div>
      <div class="property-card-stats">
        <span>${cell.price ?? 0}₽</span>
        <span>Аренда ${rentInfo.amount ?? cell.rent ?? 0}₽</span>
      </div>
      ${
        cell.houses
          ? `<div class="property-card-houses">${Array.from({ length: cell.houses }, () => "<span></span>").join("")}</div>`
          : ""
      }
      ${cell.mortgaged ? "<div class=\"property-card-flag\">Залог</div>" : ""}
      ${
        canManage
          ? `<div class="property-card-actions">
              ${
                canBuild
                  ? `<button class="build-house-btn" data-cell-id="${cell.id}">Дом ${houseCost}₽</button>`
                  : ""
              }
              ${
                (cell.houses ?? 0) > 0
                  ? `<button class="asset-action-btn" data-action="sell-house" data-cell-id="${cell.id}">Продать дом</button>`
                  : ""
              }
              ${
                !cell.mortgaged && (cell.houses ?? 0) === 0
                  ? `<button class="asset-action-btn" data-action="sell-property" data-cell-id="${cell.id}">Продать +${mortgageValue}₽</button>
                    <button class="asset-action-btn" data-action="mortgage" data-cell-id="${cell.id}">Заложить +${mortgageValue}₽</button>`
                  : ""
              }
              ${
                cell.mortgaged && state.turnPhase === TURN_PHASES.WAITING_ROLL
                  ? `<button class="asset-action-btn" data-action="redeem" data-cell-id="${cell.id}" ${player.money < redeemCost ? "disabled" : ""}>Выкупить ${redeemCost}₽</button>`
                  : ""
              }
            </div>`
          : ""
      }
      ${
        canOfferTrade
          ? `<div class="property-card-actions trade-card-actions">
              <button
                class="trade-action-btn"
                data-action="propose"
                data-target-player-id="${player.id}"
                data-cell-id="${cell.id}"
              >
                Предложить сделку
              </button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderPropertyGroupSections(state, player, cells, options = {}) {
  return `
    <div class="property-owner-cards">
      ${getDockPropertyGroups(cells)
        .map((group) => {
          const groupInfo = group.id === "business" ? null : getPropertyGroup(group.id);
          const isMonopoly =
            group.id !== "business" && group.cells.every((cell) => cell.ownerId === player.id) && ownsFullGroup(state, player.id, group.id);

          return `
            <section class="property-color-section ${isMonopoly ? "is-monopoly" : ""}" style="--property-color:${groupInfo?.color ?? "#8fa0b0"}">
              <div class="property-color-title">
                <span></span>
                <strong>${groupInfo?.title ?? "Бизнесы"}</strong>
                <em>${group.cells.length}</em>
              </div>
              <div class="property-color-cards">
                ${group.cells.map((cell) => renderPropertyCard(state, player, cell, options)).join("")}
              </div>
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

function getDockPropertyGroups(cells) {
  const groups = [];

  cells.forEach((cell) => {
    const groupId = cell.group || "business";
    let group = groups.find((item) => item.id === groupId);

    if (!group) {
      group = { id: groupId, cells: [] };
      groups.push(group);
    }

    group.cells.push(cell);
  });

  return groups;
}

function renderPropertyOwnerLabel(player) {
  return `
    <div class="property-owner-label">
      <span class="property-owner-token" style="background:${player.tokenColor}">${player.name.slice(0, 1).toUpperCase()}</span>
      <strong>${player.name}</strong>
      ${player.disconnected ? "<em>отключён</em>" : ""}
    </div>
  `;
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
          <button class="asset-action-btn" data-action="sell-property" data-cell-id="${cell.id}">
            Продать: ${cell.title} · +${getMortgageValue(cell)}₽
          </button>
        `);
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
    diceResult.className = "dice-result is-empty";
    diceResult.innerHTML = `
      <span class="dice-label">Кубики</span>
      <span class="dice-placeholder">—</span>
    `;
    return;
  }

  const { dice1, dice2, total, isDouble } = state.lastDice;
  diceResult.className = `dice-result ${isDouble ? "is-double" : ""}`;
  diceResult.innerHTML = `
    <span class="dice-label">Кубики</span>
    <span class="dice-pair" aria-label="${dice1} и ${dice2}">
      ${renderDie(dice1)}
      ${renderDie(dice2)}
    </span>
    <span class="dice-total">${dice1} + ${dice2} = ${total}${isDouble ? " · дубль" : ""}</span>
  `;
}

function renderDie(value) {
  const safeValue = Math.min(6, Math.max(1, Number(value) || 1));

  return `
    <span class="die die-${safeValue}" aria-label="${safeValue}">
      ${Array.from({ length: 9 }, (_, index) => {
        const pip = index + 1;
        return `<span class="pip pip-${pip}"></span>`;
      }).join("")}
    </span>
  `;
}

function renderCellInfo(state, cellInfo, options = {}) {
  let extraInfo = "";
  const selectedCell = options.selectedCellId ? getCellById(state, options.selectedCellId) : null;

  if (selectedCell) {
    extraInfo += renderSelectedCellInfo(state, selectedCell);
  }

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

function renderSelectedCellInfo(state, cell) {
  const group = cell.group ? getPropertyGroup(cell.group) : null;
  const owner = cell.ownerId ? state.players.find((player) => player.id === cell.ownerId) : null;
  const rentInfo = cell.price ? getRentInfo(state, cell) : null;
  const playersOnCell = state.players.filter((player) => player.position === state.cells.indexOf(cell));
  const typeLabel = getCellTypeLabel(cell);

  return `
    <div class="selected-cell-info">
      <strong>${cell.title}</strong>
      <div>${typeLabel}</div>
      ${group ? `<span class="property-group-label" style="border-color:${group.color}">${group.title}</span>` : ""}
      ${cell.price ? `<div>Стоимость: ${cell.price}₽</div>` : ""}
      ${cell.rent ? `<div>Базовая аренда: ${cell.rent}₽${rentInfo?.amount ? ` · сейчас ${rentInfo.amount}₽` : ""}</div>` : ""}
      ${owner ? `<div>Владелец: ${owner.name}</div>` : cell.price ? "<div>Свободно для покупки</div>" : ""}
      ${cell.houses ? `<div>Домов: ${cell.houses}</div>` : ""}
      ${cell.mortgaged ? "<div>В залоге</div>" : ""}
      ${playersOnCell.length ? `<div>На клетке: ${playersOnCell.map((player) => player.name).join(", ")}</div>` : ""}
    </div>
  `;
}

function getCellTypeLabel(cell) {
  if (cell.type === "street") return "Улица";
  if (cell.type === "business") return "Бизнес";
  if (cell.type === "corner") return "Угловое поле";
  if (cell.type === "chance") return "Карточка шанса";
  if (cell.type === "tax") return "Налоговое поле";
  if (cell.type === "gift") return "Подарок";
  if (cell.type === "bank") return "Банк";
  return "Поле";
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
  const tradeHistory = Array.isArray(state.tradeHistory) ? state.tradeHistory : [];

  gameLog.innerHTML = `
    <h3>Лог партии</h3>
    <div class="game-log-list">
      ${logs
        .slice(-10)
        .reverse()
        .map((entry) => `<div><span>${entry.time}</span> ${entry.message}</div>`)
        .join("")}
    </div>
    ${
      tradeHistory.length
        ? `<div class="trade-history">
            <strong>История сделок</strong>
            ${tradeHistory
              .slice(-8)
              .reverse()
              .map((entry) => `
                <div class="trade-history-entry ${entry.type}">
                  <span>${entry.time}</span>
                  ${entry.message}
                </div>
              `)
              .join("")}
          </div>`
        : ""
    }
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

function getCellSideClass(cellIndex) {
  if ([0, 10, 20, 30].includes(cellIndex)) return "side-corner";
  if (cellIndex > 0 && cellIndex < 10) return "side-bottom";
  if (cellIndex > 10 && cellIndex < 20) return "side-left";
  if (cellIndex > 20 && cellIndex < 30) return "side-top";
  return "side-right";
}
