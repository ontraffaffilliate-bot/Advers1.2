/**
 * AdVerse — API client.
 * Every call sends the raw Telegram initData in a header so the backend can
 * verify it (see backend/auth.py). No API key or secret lives in the frontend.
 */

const Api = {
  baseUrl() {
    return (typeof APP_CONFIG !== "undefined" && APP_CONFIG.apiBaseUrl) || "";
  },

  async request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const initData = TG?.webApp?.initData || TG?.initData || "";
      headers["X-Telegram-Init-Data"] = initData;
    }
    let res;
    try {
      res = await fetch(this.baseUrl() + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError("network", "Сервер недоступен. Проверьте соединение.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* empty body */
    }
    if (!res.ok) {
      const detail = data?.detail;
      if (detail && typeof detail === "object") {
        throw new ApiError(detail.code || res.status, detail.message || "Ошибка запроса");
      }
      throw new ApiError(res.status, detail || "Ошибка запроса");
    }
    return data;
  },

  // ── auth / registration ──
  auth(initData) {
    return this.request("/api/auth", { method: "POST", body: { initData }, auth: false });
  },
  register(role) {
    return this.request("/api/register", { method: "POST", body: { role } });
  },
  me() {
    return this.request("/api/me");
  },

  // ── agents ──
  listAgents() {
    return this.request("/api/agents");
  },
  adminListAgents() {
    return this.request("/api/admin/agents");
  },
  adminToggleAgent(agentId) {
    return this.request("/api/admin/agents/toggle", { method: "POST", body: { agent_id: agentId } });
  },
  adminUpdateAgent(payload) {
    return this.request("/api/admin/agents/update", { method: "POST", body: payload });
  },
  adminCreateAgent(payload) {
    return this.request("/api/admin/agents/create", { method: "POST", body: payload });
  },

  // ── orders ──
  listOrders() {
    return this.request("/api/orders");
  },
  createOrder(payload) {
    return this.request("/api/orders", { method: "POST", body: payload });
  },
  updateOrderStatus(orderId, status) {
    return this.request(`/api/orders/${orderId}/status`, { method: "POST", body: { status } });
  },

  // ── topups ──
  listTopups() {
    return this.request("/api/topups");
  },
  createTopup(payload) {
    return this.request("/api/topups", { method: "POST", body: payload });
  },
  updateTopupStatus(topupId, status) {
    return this.request(`/api/topups/${topupId}/status`, { method: "POST", body: { status } });
  },

  // ── admin: users & subscriptions ──
  adminListUsers() {
    return this.request("/api/admin/users");
  },
  adminExtendSubscription(userId, days = 30) {
    return this.request("/api/admin/users/extend", { method: "POST", body: { user_id: userId, days } });
  },
  adminUpdateUser(payload) {
    return this.request("/api/admin/users/update", { method: "POST", body: payload });
  },
  adminAuditLog() {
    return this.request("/api/admin/audit-log");
  },
  adminListSupportUsers() {
    return this.request("/api/admin/support-users");
  },
  adminListTickets() {
    return this.request("/api/admin/tickets");
  },
  adminReplyTicket(ticketId, message) {
    return this.request(`/api/admin/tickets/${ticketId}/reply`, { method: "POST", body: { message } });
  },
  health() {
    return this.request("/api/health", { auth: false });
  },
  // ── support staff ──
  supportMyTickets() {
    return this.request("/api/support/my-tickets");
  },
  supportReplyTicket(ticketId, message) {
    return this.request(`/api/support/tickets/${ticketId}/reply`, { method: "POST", body: { message } });
  },
  supportMyOrders() {
    return this.request("/api/support/my-orders");
  },

  // ── reviews ──
  createReview(agentId, payload) {
    return this.request(`/api/agents/${agentId}/review`, { method: "POST", body: payload });
  },
  listReviews(agentId) {
    return this.request(`/api/agents/${agentId}/reviews`);
  },

  // ── support tickets ──
  listTickets() {
    return this.request("/api/support/tickets");
  },
  createTicket(subject, message) {
    return this.request("/api/support/tickets", { method: "POST", body: { subject, message } });
  },
  addTicketMessage(ticketId, message) {
    return this.request(`/api/support/tickets/${ticketId}/messages`, { method: "POST", body: { message } });
  },

  // ── ad accounts (real Facebook Marketing API integration) ──
  listAccounts() {
    return this.request("/api/accounts");
  },
  createAccount(payload) {
    return this.request("/api/accounts", { method: "POST", body: payload });
  },
  syncAccount(id) {
    return this.request(`/api/accounts/${id}/sync`, { method: "POST" });
  },
  setAccountToken(id, fb_account_id, access_token) {
    return this.request(`/api/accounts/${id}/token`, { method: "POST", body: { fb_account_id, access_token } });
  },
  deleteAccount(id) {
    return this.request(`/api/accounts/${id}`, { method: "DELETE" });
  },
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Pulls agents/orders/topups from the backend into the same globals the
 * existing render functions already read (AGENTS, state.orders, state.topups).
 * Call this once right after login/registration succeeds.
 */
async function loadAppData() {
  const [agents, orders, topups, accounts] = await Promise.all([
    Api.listAgents(),
    Api.listOrders(),
    Api.listTopups(),
    Api.listAccounts(),
  ]);
  AGENTS.length = 0;
  AGENTS.push(...agents.map(fromApiAgent));
  state.orders = orders.map(fromApiOrder);
  state.topups = topups.map(fromApiTopup);
  state.accounts = accounts.map(fromApiAccount);
  state.dataLoaded = true;
}

// ── shape adapters: backend field names -> the names the existing UI expects ──
function fromApiAgent(a) {
  return { ...a, updated: a.updated || "только что" };
}
function fromApiOrder(o) {
  return { ...o };
}
function fromApiTopup(t) {
  return { ...t };
}
function fromApiAccount(a) {
  return { ...a };
}
