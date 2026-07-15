/* AdVerse CRM — Live data (loaded from the backend API, no more hardcoded arrays) */

// Populated by loadAgents() in api.js after login. Kept as a mutable array
// (not const) because every render function in app.js reads this global
// directly, and we refresh it in place after each API call.
let AGENTS = [];

// Populated by loadOrders()/loadTopups() into state.orders / state.topups.
// Left here only so any legacy reference doesn't throw.
let ORDERS = [];
let TOPUPS = [];

// NOTE: Accounts / Tickets / Notifications are still local demo data in this
// pass — they don't touch owner_id isolation or money, so they were kept out
// of scope for the v1 backend. Wire these to real endpoints the same way
// AGENTS/orders/topups were done, when you're ready to extend the API.
const ACCOUNTS = [
  {
    id: "ACC-1001",
    name: "FB Account ES-01",
    agentId: 1,
    agentName: "Agent #1",
    issuedAt: "2026-06-15",
    status: "active",
    balance: 420,
    lastActivity: "1h ago",
    apiConnected: true,
    spend: { today: 120, week: 890, month: 4200, lifetime: 18500 },
    campaigns: 12,
    adsets: 34,
    ads: 89,
    errors: 0,
  },
  {
    id: "ACC-1002",
    name: "FB Account ES-02",
    agentId: 1,
    agentName: "Agent #1",
    issuedAt: "2026-06-15",
    status: "active",
    balance: 180,
    lastActivity: "3h ago",
    apiConnected: true,
    spend: { today: 85, week: 620, month: 3100, lifetime: 14200 },
    campaigns: 8,
    adsets: 22,
    ads: 56,
    errors: 1,
  },
  {
    id: "ACC-1003",
    name: "FB Account CRYPTO-01",
    agentId: 3,
    agentName: "Agent #3",
    issuedAt: "2026-07-02",
    status: "active",
    balance: 950,
    lastActivity: "20m ago",
    apiConnected: false,
    spend: null,
    campaigns: 0,
    adsets: 0,
    ads: 0,
    errors: 0,
  },
  {
    id: "ACC-1004",
    name: "FB Account NUTRA-01",
    agentId: 2,
    agentName: "Agent #2",
    issuedAt: "2026-05-20",
    status: "disabled",
    balance: 0,
    lastActivity: "12d ago",
    apiConnected: true,
    spend: { today: 0, week: 0, month: 0, lifetime: 9800 },
    campaigns: 0,
    adsets: 0,
    ads: 0,
    errors: 3,
  },
  {
    id: "ACC-1005",
    name: "FB Account US-01",
    agentId: 1,
    agentName: "Agent #1",
    issuedAt: "2026-07-09",
    status: "active",
    balance: 600,
    lastActivity: "45m ago",
    apiConnected: false,
    spend: null,
    campaigns: 0,
    adsets: 0,
    ads: 0,
    errors: 0,
  },
];

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
    accounts: JSON.parse(JSON.stringify(ACCOUNTS)),
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

function totalSpend(accounts = ACCOUNTS) {
  return accounts
    .filter((a) => a.apiConnected && a.spend)
    .reduce(
      (acc, a) => ({
        today: acc.today + a.spend.today,
        week: acc.week + a.spend.week,
        month: acc.month + a.spend.month,
        lifetime: acc.lifetime + a.spend.lifetime,
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
