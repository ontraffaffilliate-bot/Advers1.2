/* AdVerse CRM — Live data (loaded from the backend API, no more hardcoded arrays) */

// Populated by loadAgents() in api.js after login. Kept as a mutable array
// (not const) because every render function in app.js reads this global
// directly, and we refresh it in place after each API call.
let AGENTS = [];

// Populated by loadOrders()/loadTopups() into state.orders / state.topups.
// Left here only so any legacy reference doesn't throw.
let ORDERS = [];
let TOPUPS = [];

// Accounts (Facebook ad account integration) are now real — loaded from
// the backend via Api.listAccounts() into state.accounts. See main.py
// (AdAccount model) and facebook_api.py for the actual Graph API sync.

const TICKETS = [
  {
    id: "TKT-441",
    category: "order",
    subject: "Заказ ADV-20391 задерживается",
    message: "Агент принял заказ вчера, статус Preparing уже 12 часов. Когда будет готов?",
    status: "open",
    createdAt: "2026-07-11T18:00:00",
    replies: 2,
  },
  {
    id: "TKT-420",
    category: "facebook",
    subject: "Ошибка API Token",
    message: "При подключении токена получаю Invalid Token. Проверил права — Marketing API есть.",
    status: "open",
    createdAt: "2026-07-10T10:00:00",
    replies: 1,
  },
  {
    id: "TKT-390",
    category: "topup",
    subject: "Пополнение не подтверждено",
    message: "Hash отправлен 2 дня назад, статус Waiting.",
    status: "resolved",
    createdAt: "2026-07-05T14:00:00",
    replies: 4,
  },
];

const NOTIFICATIONS = [
  {
    id: 1,
    type: "order",
    icon: "📦",
    title: "Заказ принят",
    text: "Agent #1 принял заказ ADV-20391",
    time: "2ч назад",
    unread: true,
  },
  {
    id: 2,
    type: "order",
    icon: "✅",
    title: "Заказ готов",
    text: "ADV-20350 готов к получению",
    time: "5ч назад",
    unread: true,
  },
  {
    id: 3,
    type: "topup",
    icon: "💰",
    title: "Пополнение подтверждено",
    text: "Agent #1 подтвердил +$500",
    time: "1д назад",
    unread: true,
  },
  {
    id: 4,
    type: "balance",
    icon: "🔄",
    title: "Баланс обновлён",
    text: "Синхронизация балансов завершена",
    time: "1д назад",
    unread: false,
  },
  {
    id: 5,
    type: "support",
    icon: "💬",
    title: "Ответ саппорта",
    text: "Новый ответ по тикету TKT-441",
    time: "2д назад",
    unread: false,
  },
];

const TEAM_MEMBERS = [
  { id: 1, name: "Alex Buyer", role: "Buyer", spend: 42000, accounts: 18, avatar: "AB" },
  { id: 2, name: "Maria K.", role: "Buyer", spend: 38000, accounts: 15, avatar: "MK" },
  { id: 3, name: "Ivan P.", role: "Buyer", spend: 29000, accounts: 12, avatar: "IP" },
  { id: 4, name: "You (Owner)", role: "Owner", spend: 85000, accounts: 34, avatar: "YO" },
  { id: 5, name: "Sergey M.", role: "Buyer", spend: 15000, accounts: 8, avatar: "SM" },
];

const TIMEZONES = [
  "UTC-8", "UTC-5", "UTC-3", "UTC+0", "UTC+1", "UTC+2", "UTC+3", "UTC+4", "UTC+5", "UTC+7", "UTC+8", "UTC+9"
];

const PLANS = [
  {
    id: "solo",
    name: "Solo",
    price: 49,
    desc: "Для индивидуального байера",
    features: [
      "1 пользователь",
      "Все функции CRM",
      "Заказы и пополнения",
      "Facebook API analytics",
      "Поддержка в тикетах",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: 149,
    desc: "Для команд медиабайеров",
    features: [
      "До 15 сотрудников",
      "Управление ролями",
      "Общий Dashboard",
      "Общий Spend команды",
      "Статистика по байерам",
      "Приоритетная поддержка",
    ],
    featured: true,
  },
  {
    id: "unlimited",
    name: "Unlimited",
    price: 399,
    desc: "Без ограничений + API",
    features: [
      "Безлимит сотрудников",
      "Все функции Team",
      "Public API доступ",
      "Кастомные интеграции",
      "Выделенный менеджер",
      "SLA 99.9%",
    ],
  },
];

const STATUS_LABELS = {
  created: "Created",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  submitted: "Submitted",
  waiting: "Waiting Confirmation",
  confirmed: "Confirmed",
  updated: "Balance Updated",
  open: "Open",
  resolved: "Resolved",
  active: "Active",
  disabled: "Disabled",
};

const CATEGORY_LABELS = {
  order: "Заказ",
  topup: "Пополнение",
  facebook: "Facebook",
  tech: "Техническая",
  other: "Другое",
};

const ROLES = {
  buyer: {
    id: "buyer",
    name: "Buyer",
    desc: "Заказы, аккаунты, аналитика",
    icon: "🎯",
    color: "#6c5ce7",
    username: "alex_buyer",
    displayName: "Alex Buyer",
    plan: "Team",
    avatar: "AB",
    nav: ["dashboard", "orders", "topup", "accounts", "more"],
  },
  team: {
    id: "team",
    name: "Team Owner",
    desc: "Команда + все функции Buyer",
    icon: "👥",
    color: "#fd79a8",
    username: "team_lead",
    displayName: "Team Lead",
    plan: "Team",
    avatar: "TL",
    nav: ["dashboard", "orders", "topup", "accounts", "more"],
  },
  agent: {
    id: "agent",
    name: "Agent",
    desc: "Заказы, пополнения, балансы",
    icon: "🏢",
    color: "#00d2ff",
    username: "agent_one",
    displayName: "Agent #1",
    plan: "Partner",
    avatar: "A1",
    nav: ["agent-home", "agent-orders", "agent-topups", "agent-balances", "more"],
  },
  support: {
    id: "support",
    name: "Support",
    desc: "Тикеты, заказы, обращения",
    icon: "🎧",
    color: "#ffd93d",
    username: "support_adv",
    displayName: "Support",
    plan: "Staff",
    avatar: "SP",
    nav: ["support-home", "support-tickets", "support-orders", "more"],
  },
  admin: {
    id: "admin",
    name: "Admin",
    desc: "Полный доступ к платформе",
    icon: "⚙️",
    color: "#ff6b6b",
    username: "admin",
    displayName: "Admin",
    plan: "Admin",
    avatar: "AD",
    nav: ["admin-home", "admin-agents", "admin-users", "admin-orders", "admin-logs"],
  },
};

// Mutable app state seed
function getInitialState() {
  return {
    role: null,
    orders: [], // filled by loadOrders() from the API
    topups: [], // filled by loadTopups() from the API
    accounts: [], // filled by loadAppData() from the real Facebook integration
    tickets: JSON.parse(JSON.stringify(TICKETS)),
    notifications: JSON.parse(JSON.stringify(NOTIFICATIONS)),
    currentPlan: "team",
    isAdmin: false,
    isPaid: false,
    currentUser: null,
    myTickets: [],
    dataLoaded: false,
  };
}

function formatMoney(n) {
  if (n == null) return "—";
  if (n >= 1000) {
    return "$" + n.toLocaleString("en-US");
  }
  return "$" + n;
}

function formatStars(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function totalBalance(agents = AGENTS) {
  return agents.reduce((s, a) => s + a.balance, 0);
}

function totalSpend(accounts = []) {
  return accounts
    .filter((a) => a.status === "active" && a.spend)
    .reduce(
      (acc, a) => ({
        today: acc.today + (a.spend.today || 0),
        week: acc.week + (a.spend.week || 0),
        month: acc.month + (a.spend.month || 0),
        lifetime: acc.lifetime + (a.spend.lifetime || 0),
      }),
      { today: 0, week: 0, month: 0, lifetime: 0 }
    );
}

function nextOrderId(orders) {
  const nums = orders.map((o) => parseInt(o.id.replace("ADV-", ""), 10));
  const max = Math.max(...nums, 20000);
  return "ADV-" + (max + 1);
}

function nextTopupId(topups) {
  const nums = topups.map((t) => parseInt(t.id.replace("TOP-", ""), 10));
  const max = Math.max(...nums, 8000);
  return "TOP-" + (max + 1);
}

function nextTicketId(tickets) {
  const nums = tickets.map((t) => parseInt(t.id.replace("TKT-", ""), 10));
  const max = Math.max(...nums, 400);
  return "TKT-" + (max + 1);
}
