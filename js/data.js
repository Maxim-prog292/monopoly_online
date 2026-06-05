export const propertyGroups = {
  blue: {
    title: "Синяя группа",
    color: "#4f8cff",
  },
  green: {
    title: "Зелёная группа",
    color: "#37c871",
  },
  red: {
    title: "Красная группа",
    color: "#ff5252",
  },
  yellow: {
    title: "Жёлтая группа",
    color: "#ffd43b",
  },
  purple: {
    title: "Фиолетовая группа",
    color: "#b267ff",
  },
};

export const boardData = [
  { id: "start", title: "Старт", type: "corner" },
  { id: "tverskaya", title: "ул. Тверская", type: "street", group: "blue", price: 100, rent: 20, houses: 0 },
  { id: "sovetskaya", title: "ул. Советская", type: "street", group: "blue", price: 120, rent: 25, houses: 0 },
  { id: "chance_1", title: "Шанс", type: "chance" },
  { id: "coffee", title: "Кофейня", type: "business", group: null, price: 140, rent: 30, houses: 0 },
  { id: "tax_1", title: "Налоговая", type: "tax" },
  { id: "print_shop", title: "Типография", type: "business", group: null, price: 160, rent: 35, houses: 0 },
  { id: "sadovaya", title: "ул. Садовая", type: "street", group: "blue", price: 140, rent: 30, houses: 0 },
  { id: "gift_1", title: "Подарок", type: "gift" },
  { id: "market", title: "Рынок", type: "business", group: null, price: 180, rent: 40, houses: 0 },
  { id: "tver", title: "Деревня", type: "corner" },

  { id: "lesnaya", title: "ул. Лесная", type: "street", group: "green", price: 160, rent: 35, houses: 0 },
  { id: "rechnaya", title: "ул. Речная", type: "street", group: "green", price: 180, rent: 40, houses: 0 },
  { id: "chance_2", title: "Шанс", type: "chance" },
  { id: "pharmacy", title: "Аптека", type: "business", group: null, price: 200, rent: 45, houses: 0 },
  { id: "factory", title: "Завод", type: "business", group: null, price: 240, rent: 55, houses: 0 },
  { id: "polevaya", title: "ул. Полевая", type: "street", group: "green", price: 200, rent: 45, houses: 0 },
  { id: "tax_2", title: "Налоговая", type: "tax" },
  { id: "mall", title: "ТЦ", type: "business", group: null, price: 280, rent: 65, houses: 0 },
  { id: "molodezhnaya", title: "ул. Молодёжная", type: "street", group: "red", price: 220, rent: 50, houses: 0 },
  { id: "parking", title: "Парковка", type: "corner" },

  { id: "parkovaya", title: "ул. Парковая", type: "street", group: "red", price: 240, rent: 55, houses: 0 },
  { id: "centralnaya", title: "ул. Центральная", type: "street", group: "red", price: 260, rent: 60, houses: 0 },
  { id: "chance_3", title: "Шанс", type: "chance" },
  { id: "cinema", title: "Кинотеатр", type: "business", group: null, price: 300, rent: 70, houses: 0 },
  { id: "bank_event_1", title: "Банк", type: "bank" },
  { id: "novaya", title: "ул. Новая", type: "street", group: "yellow", price: 280, rent: 65, houses: 0 },
  { id: "gift_2", title: "Подарок", type: "gift" },
  { id: "hotel", title: "Отель", type: "business", group: null, price: 380, rent: 90, houses: 0 },
  { id: "pobedy", title: "ул. Победы", type: "street", group: "yellow", price: 320, rent: 75, houses: 0 },
  { id: "bus_station", title: "Автовокзал", type: "corner" },

  { id: "yuzhnaya", title: "ул. Южная", type: "street", group: "yellow", price: 340, rent: 80, houses: 0 },
  { id: "gas_station", title: "АЗС", type: "business", group: null, price: 400, rent: 95, houses: 0 },
  { id: "chance_4", title: "Шанс", type: "chance" },
  { id: "severnaya", title: "ул. Северная", type: "street", group: "purple", price: 360, rent: 85, houses: 0 },
  { id: "port", title: "Порт", type: "business", group: null, price: 450, rent: 110, houses: 0 },
  { id: "tax_3", title: "Налоговая", type: "tax" },
  { id: "corporation", title: "Корпорация", type: "business", group: null, price: 520, rent: 140, houses: 0 },
  { id: "glavnaya", title: "ул. Главная", type: "street", group: "purple", price: 400, rent: 100, houses: 0 },
  { id: "prospekt", title: "Проспект", type: "street", group: "purple", price: 460, rent: 120, houses: 0 },
];

export const eventDecks = {
  chance: {
    title: "Шанс",
    cards: [
      { id: "chance_bonus_150", text: "Удачная сделка. Получите 150₽.", type: "money", value: 150 },
      { id: "chance_fine_80", text: "Непредвиденные расходы. Заплатите 80₽.", type: "money", value: -80 },
      { id: "chance_start", text: "Вернитесь на старт и получите 200₽.", type: "moveTo", targetCellId: "start", collectStartBonus: true },
      { id: "chance_move_3", text: "Продвиньтесь на 3 клетки вперёд.", type: "moveSteps", steps: 3 },
      { id: "chance_tver", text: "Проверка расписания. Езжайте в деревню.", type: "moveToTver" },
      { id: "chance_vesyegonsk_ticket", text: "Билет до Твери. Сохраните его для выезда из деревни.", type: "vesyegonskTicket" },
    ],
  },
  tax: {
    title: "Налоговая",
    cards: [
      { id: "tax_income_100", text: "Подоходный налог. Заплатите 100₽.", type: "money", value: -100 },
      { id: "tax_property_150", text: "Налог на имущество. Заплатите 150₽.", type: "money", value: -150 },
      { id: "tax_audit_70", text: "Камеральная проверка. Заплатите 70₽.", type: "money", value: -70 },
      { id: "tax_refund_60", text: "Налоговый вычет одобрен. Получите 60₽.", type: "money", value: 60 },
    ],
  },
  gift: {
    title: "Подарок",
    cards: [
      { id: "gift_prize_120", text: "Вы выиграли городской конкурс. Получите 120₽.", type: "money", value: 120 },
      { id: "gift_grant_200", text: "Грант на развитие. Получите 200₽.", type: "money", value: 200 },
      { id: "gift_cashback_90", text: "Кэшбэк от партнёров. Получите 90₽.", type: "money", value: 90 },
      { id: "gift_move_2", text: "Хорошие новости. Продвиньтесь на 2 клетки вперёд.", type: "moveSteps", steps: 2 },
    ],
  },
  bank: {
    title: "Банк",
    cards: [
      { id: "bank_credit_fee_120", text: "Платёж по кредиту. Заплатите 120₽.", type: "money", value: -120 },
      { id: "bank_deposit_160", text: "Проценты по вкладу. Получите 160₽.", type: "money", value: 160 },
      { id: "bank_commission_50", text: "Комиссия за обслуживание. Заплатите 50₽.", type: "money", value: -50 },
      { id: "bank_bonus_100", text: "Банк начислил бонус. Получите 100₽.", type: "money", value: 100 },
    ],
  },
};

export const tokenOptions = [
  { id: "car", label: "Машина", icon: "🚗", color: "#ff4757" },
  { id: "rocket", label: "Ракета", icon: "🚀", color: "#1e90ff" },
  { id: "train", label: "Паровоз", icon: "🚂", color: "#2ed573" },
  { id: "ufo", label: "НЛО", icon: "🛸", color: "#ffa502" },
  { id: "hat", label: "Цилиндр", icon: "🎩", color: "#e056fd" },
];

export const tokenColors = tokenOptions.map((token) => token.color);

export function getTokenOption(tokenId) {
  return tokenOptions.find((token) => token.id === tokenId) ?? tokenOptions[0];
}

export function getPropertyGroup(groupId) {
  return propertyGroups[groupId] ?? null;
}
