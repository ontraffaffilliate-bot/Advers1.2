/* AdVerse CRM — Application Logic */

const state = getInitialState();
let selectedRole = "buyer";
let wizard = {
  step: 1,
  agentId: null,
  qty: 10,
  timezone: "UTC+2",
  pixel: true,
  pixelCount: 1,
  pixelNames: [""],
  bm: "new",
  fanPages: false,
  fanPageCount: 3,
  fanPageNames: ["", "", ""],
  adsPower: "",
  comment: "",
};
let topupAgentId = null;
let currentOrderFilter = "all";
let currentAccountFilter = "all";
let pendingRegistration = false;

// ─── Init ───
document.addEventListener("DOMContentLoaded", () => {
  // telegram.js already ran initTelegram on load
  if (typeof initTelegram === "function" && !TG.webApp) initTelegram();

  applyTelegramUserToUI();
  renderRolePicker();
  bindGlobalEvents();
  showScreen("login");

  // Deep link: t.me/bot?startapp=role_agent
  const startRole = typeof getRoleFromStartParam === "function" ? getRoleFromStartParam() : null;
  if (startRole) selectedRole = startRole;

  // Auto-login inside real Telegram Mini App
  const cfg = typeof APP_CONFIG !== "undefined" ? APP_CONFIG : {};
  if (TG.isTelegram && TG.user && cfg.autoLoginInTelegram !== false) {
    if (startRole) selectedRole = startRole;
    else if (cfg.defaultRole) selectedRole = cfg.defaultRole;
    // Small delay so UI paints login briefly, then enters
    setTimeout(() => login(), 350);
  }

  // Telegram BackButton → close sheet / go more / close app
  window.onTelegramBack = handleTelegramBack;
});

function $(sel, root = document) {
  return root.querySelector(sel);
}
function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const el = $(`#screen-${id}`);
  if (el) el.classList.add("active");
}

function showPage(pageId) {
  $$(".page").forEach((p) => p.classList.remove("active"));
  const page = $(`#page-${pageId}`);
  if (page) page.classList.add("active");

  $$(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.page === pageId);
  });

  // FAB visibility
  const fab = $("#fab");
  if (fab) {
    const showFab = ["orders", "agent-orders"].includes(pageId) && state.role && ["buyer", "team"].includes(state.role);
    fab.classList.toggle("hidden", !showFab || pageId !== "orders");
    if (pageId === "orders" && ["buyer", "team"].includes(state.role)) {
      fab.classList.remove("hidden");
      fab.onclick = () => openOrderWizard();
    } else {
      fab.classList.add("hidden");
    }
  }

  // Render page content
  const renderers = {
    dashboard: renderDashboard,
    orders: renderOrders,
    topup: renderTopupList,
    accounts: renderAccounts,
    more: renderMore,
    team: renderTeam,
    pricing: renderPricing,
    support: renderSupport,
    "agents-browse": renderAgentsBrowse,
    profile: renderProfile,
    analytics: renderAnalytics,
    "agent-home": renderAgentHome,
    "agent-orders": renderAgentOrders,
    "agent-topups": renderAgentTopups,
    "agent-balances": renderAgentBalances,
    "support-home": renderSupportHome,
    "support-tickets": renderSupportTickets,
    "support-orders": renderSupportOrders,
    "admin-home": renderAdminHome,
    "admin-agents": renderAdminAgents,
    "admin-users": renderAdminUsers,
    "admin-orders": renderAdminOrders,
    "admin-logs": renderAdminLogs,
    "admin-tickets": renderAdminTickets,
    "admin-topups": renderAdminTopups,
    "admin-health": renderAdminHealth,
    "admin-settings": renderAdminSettings,
  };

  if (renderers[pageId]) renderers[pageId]();
}

// ─── Login ───
function renderRolePicker() {
  const container = $("#role-picker");
  if (!container) return;
  // v2.0: самостоятельно выбрать можно только Buyer/Agent. Admin выдаётся
  // сервером принудительно по ADMIN_IDS, Team/Support назначает админ вручную.
  const selectable = ["buyer", "agent"].map((id) => ROLES[id]).filter(Boolean);
  container.innerHTML = selectable
    .map(
      (r) => `
    <button type="button" class="role-option ${selectedRole === r.id ? "selected" : ""}" data-role="${r.id}">
      <div class="role-icon" style="background: ${r.color}22; color: ${r.color}">${r.icon}</div>
      <div class="role-info">
        <h4>${r.name}</h4>
        <p>${r.desc}</p>
      </div>
    </button>
  `
    )
    .join("");

  container.querySelectorAll(".role-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRole = btn.dataset.role;
      renderRolePicker();
    });
  });
}

function applyTelegramUserToUI() {
  const badge = $("#tg-user-badge");
  const disclaimer = $("#login-disclaimer");
  const btn = $("#btn-login");

  if (TG.isTelegram && TG.user) {
    if (badge) {
      badge.classList.remove("hidden");
      badge.innerHTML = `
        <div class="avatar sm">${getTelegramAvatarLetters()}</div>
        <div>
          <div class="tg-badge-name">${getTelegramDisplayName()}</div>
          <div class="tg-badge-sub">@${TG.user.username || TG.user.id} · Telegram</div>
        </div>
      `;
    }
    if (disclaimer) {
      disclaimer.innerHTML = `
        Вы вошли как <strong>${getTelegramDisplayName()}</strong> через Telegram Mini App.<br />
        Платформа не принимает и не хранит денежные средства — только подписка CRM.
      `;
    }
    if (btn) btn.innerHTML = `Открыть AdVerse CRM`;
  } else if (TG.webApp && !TG.user) {
    if (disclaimer) {
      disclaimer.innerHTML = `
        Откройте приложение из Telegram-бота (кнопка Menu / Mini App), чтобы подтянуть ваш профиль.<br />
        Сейчас — демо-режим в браузере.
      `;
    }
  }
}

function applyTelegramProfileToRole(role, apiUser) {
  if (!TG.user && !apiUser) return role;
  const name =
    [apiUser?.first_name, apiUser?.last_name].filter(Boolean).join(" ") ||
    getTelegramDisplayName() ||
    role.displayName;
  const username = apiUser?.username || TG.user?.username || String(apiUser?.telegram_id ?? TG.user?.id ?? "");
  const letters = getTelegramAvatarLetters();
  return {
    ...role,
    displayName: name,
    username,
    avatar: letters,
    telegramId: apiUser?.telegram_id ?? TG.user?.id,
  };
}

async function login() {
  const btn = $("#btn-login");
  if (btn) btn.disabled = true;

  const initData = TG.webApp?.initData || "";
  if (!TG.isTelegram || !initData) {
    toast("Откройте приложение из Telegram, чтобы войти", "error");
    if (btn) btn.disabled = false;
    return;
  }

  let result;
  try {
    result = await Api.auth(initData);
  } catch (e) {
    console.error("Auth failed:", e);
    showScreen("offline");
    if (btn) btn.disabled = false;
    return;
  } finally {
    if (btn) btn.disabled = false;
  }

  if (result.status === "needs_registration") {
    // Force the role picker — no dashboard access until /api/register succeeds.
    pendingRegistration = true;
    renderRolePicker();
    toast("Выберите роль, чтобы завершить регистрацию", "info");
    const loginBtn = $("#btn-login");
    if (loginBtn) loginBtn.textContent = "Завершить регистрацию";
    return;
  }

  await enterApp(result.role, result.user);
}

async function completeRegistration() {
  const btn = $("#btn-login");
  if (btn) btn.disabled = true;
  try {
    const result = await Api.register(selectedRole);
    await enterApp(result.user.role, result.user);
  } catch (e) {
    console.error("Register failed:", e);
    toast(e.message || "Не удалось завершить регистрацию", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function enterApp(roleId, apiUser) {
  state.role = roleId;
  state.isAdmin = Boolean(apiUser?.is_admin);
  state.isPaid = Boolean(apiUser?.is_paid);
  state.currentUser = apiUser || null;
  let role = { ...(ROLES[roleId] || ROLES.buyer) };
  role = applyTelegramProfileToRole(role, apiUser);
  state.sessionRole = role;
  pendingRegistration = false;

  showScreen("app");
  showSkeleton();

  try {
    await loadAppData();
  } catch (e) {
    console.error("Failed to load app data:", e);
    showScreen("offline");
    return;
  }

  updateHeader(role);
  setupNav(role);
  showPage(role.nav[0]);
}

function retryLoad() {
  showScreen("login");
  login();
}

function showSkeleton() {
  const active = $(".page");
  $$(".page").forEach((p) => {
    p.innerHTML = `
      <div class="skeleton-block" style="height:24px;width:40%;margin-bottom:16px"></div>
      <div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>
      <div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>
      <div class="skeleton-block" style="height:80px"></div>
    `;
  });
}

function handleTelegramBack() {
  // Close overlays first
  if ($("#sheet")?.classList.contains("open") || $("#modal")?.classList.contains("open")) {
    closeAllOverlays();
    if (typeof tgShowBackButton === "function") tgShowBackButton(false);
    return;
  }
  // Navigate to first nav item
  const role = state.sessionRole || ROLES[state.role];
  if (role?.nav?.[0]) {
    const active = $(".page.active");
    const home = role.nav[0];
    if (active && active.id !== `page-${home}`) {
      showPage(home);
      return;
    }
  }
  // Already home — close Mini App
  if (typeof tgClose === "function") tgClose();
}

function logout() {
  state.role = null;
  closeAllOverlays();
  showScreen("login");
  toast("Вы вышли из аккаунта", "info");
}

function updateHeader(role) {
  const avatar = $("#header-avatar");
  const name = $("#header-name");
  const plan = $("#header-plan");
  const balance = $("#header-balance");
  const notifDot = $("#notif-dot");

  if (avatar) avatar.textContent = role.avatar;
  if (name) name.textContent = role.displayName;
  if (plan) plan.innerHTML = `<span>✦</span> ${role.plan}`;

  if (balance) {
    if (["buyer", "team"].includes(role.id)) {
      balance.classList.remove("hidden");
      balance.innerHTML = `<span>◉</span> ${formatMoney(totalBalance())}`;
    } else {
      balance.classList.add("hidden");
    }
  }

  const unread = state.notifications.filter((n) => n.unread).length;
  if (notifDot) notifDot.style.display = unread > 0 ? "block" : "none";
}

function setupNav(role) {
  const nav = $("#bottom-nav");
  if (!nav) return;

  const icons = {
    dashboard: { icon: "◈", label: "Home" },
    orders: { icon: "☰", label: "Заказы" },
    topup: { icon: "◉", label: "Баланс" },
    accounts: { icon: "⬡", label: "Аккаунты" },
    more: { icon: "⋯", label: "Ещё" },
    "agent-home": { icon: "◈", label: "Home" },
    "agent-orders": { icon: "☰", label: "Заказы" },
    "agent-topups": { icon: "◉", label: "Пополн." },
    "agent-balances": { icon: "⬡", label: "Балансы" },
    "support-home": { icon: "◈", label: "Home" },
    "support-tickets": { icon: "☰", label: "Тикеты" },
    "support-orders": { icon: "⬡", label: "Заказы" },
    "admin-home": { icon: "◈", label: "Home" },
    "admin-users": { icon: "☰", label: "Users" },
    "admin-orders": { icon: "⬡", label: "Orders" },
    "admin-logs": { icon: "◉", label: "Logs" },
  };

  nav.innerHTML = role.nav
    .map((pageId) => {
      const item = icons[pageId] || { icon: "•", label: pageId };
      return `
      <button type="button" class="nav-item visible" data-page="${pageId}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </button>
    `;
    })
    .join("");

  nav.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });
}

// ─── Dashboard (Buyer / Team) ───
function renderDashboard() {
  const el = $("#page-dashboard");
  if (!el) return;

  const spend = totalSpend(state.accounts);
  const connected = state.accounts.filter((a) => a.status === "active").length;
  const isTeam = state.role === "team";

  el.innerHTML = `
    <h1 class="page-title">Dashboard</h1>
    <p class="page-sub">Обзор вашей CRM-активности</p>

    <div class="kpi-grid">
      <div class="kpi-card agents">
        <div class="kpi-icon">🏢</div>
        <div class="kpi-label">Агенты</div>
        <div class="kpi-value">${AGENTS.length}</div>
        <div class="kpi-hint">активных</div>
      </div>
      <div class="kpi-card balance">
        <div class="kpi-icon">💰</div>
        <div class="kpi-label">Баланс</div>
        <div class="kpi-value">${formatMoney(totalBalance())}</div>
        <div class="kpi-hint">обновл. 1×/сутки</div>
      </div>
      <div class="kpi-card accounts">
        <div class="kpi-icon">⬡</div>
        <div class="kpi-label">Аккаунты</div>
        <div class="kpi-value">${state.accounts.length}</div>
        <div class="kpi-hint">${connected} с API</div>
      </div>
      <div class="kpi-card spend">
        <div class="kpi-icon">📈</div>
        <div class="kpi-label">Total Spend</div>
        <div class="kpi-value">${formatMoney(spend.lifetime)}</div>
        <div class="kpi-hint">lifetime</div>
      </div>
      ${
        isTeam
          ? `<div class="kpi-card team" style="grid-column: span 2">
        <div class="kpi-icon">👥</div>
        <div class="kpi-label">Команда</div>
        <div class="kpi-value">${TEAM_MEMBERS.length} Members</div>
        <div class="kpi-hint">общий spend ${formatMoney(TEAM_MEMBERS.reduce((s, m) => s + m.spend, 0))}</div>
      </div>`
          : ""
      }
    </div>

    <div class="card mb-20">
      <div class="section-title">Facebook Spend</div>
      <div class="spend-periods">
        <div class="period-chip">
          <div class="val">${formatMoney(spend.today)}</div>
          <div class="lbl">Сегодня</div>
        </div>
        <div class="period-chip">
          <div class="val">${formatMoney(spend.week)}</div>
          <div class="lbl">7 дней</div>
        </div>
        <div class="period-chip">
          <div class="val">${formatMoney(spend.month)}</div>
          <div class="lbl">30 дней</div>
        </div>
        <div class="period-chip">
          <div class="val">${formatMoney(spend.lifetime)}</div>
          <div class="lbl">Все время</div>
        </div>
      </div>
      <div class="mini-chart mt-12">
        ${[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88]
          .map((h) => `<div class="bar" style="height:${h}%"></div>`)
          .join("")}
      </div>
    </div>

    <div class="section-title">
      Аналитика агентов
      <button type="button" class="link" onclick="showPage('topup')">Балансы →</button>
    </div>
    <div class="agent-table">
      ${AGENTS.map(
        (a) => `
        <div class="agent-row" onclick="openAgentDetail(${a.id})">
          <div class="agent-row-main">
            <div class="agent-row-top">
              <span class="agent-name">${a.name}</span>
              <span class="badge badge-accent">${a.percent}%</span>
            </div>
            <div class="agent-stats">
              <span><strong>${a.accounts}</strong> заказ.</span>
              <span><strong>${a.active}</strong> активн.</span>
              <span><strong>${formatMoney(a.spend)}</strong> spend</span>
            </div>
          </div>
          <div class="agent-row-side">
            <div class="agent-balance">${formatMoney(a.balance)}</div>
            <div class="agent-updated">Updated ${a.updated}</div>
          </div>
        </div>
      `
      ).join("")}
    </div>

    <div class="disclaimer-box">
      <strong>⚠ Платформа не хранит средства</strong>
      Балансы синхронизируются из Excel / Google Sheets агентов 1 раз в сутки.
      Все платежи — напрямую между вами и агентом.
    </div>
  `;
}

// ─── Orders ───
function renderOrders() {
  const el = $("#page-orders");
  if (!el) return;

  const filters = ["all", "created", "accepted", "preparing", "ready", "completed", "cancelled"];
  let list = state.orders;
  if (currentOrderFilter !== "all") {
    list = list.filter((o) => o.status === currentOrderFilter);
  }

  el.innerHTML = `
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="page-title" style="margin-bottom:0">Заказы</h1>
        <p class="page-sub" style="margin-bottom:0">${state.orders.length} всего</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="openOrderWizard()" style="width:auto">
        + Создать
      </button>
    </div>

    <div class="filter-bar">
      ${filters
        .map(
          (f) => `
        <button type="button" class="filter-chip ${currentOrderFilter === f ? "active" : ""}" data-filter="${f}">
          ${f === "all" ? "Все" : STATUS_LABELS[f] || f}
        </button>
      `
        )
        .join("")}
    </div>

    <div class="order-list">
      ${
        list.length
          ? list
              .map(
                (o) => `
        <div class="order-card" onclick="openOrderDetail('${o.id}')">
          <div class="order-card-header">
            <span class="order-id">${o.id}</span>
            <span class="status status-${o.status}">${STATUS_LABELS[o.status]}</span>
          </div>
          <div class="order-meta">
            <span><strong>${o.agentName}</strong></span>
            <span>${o.qty} акк.</span>
            <span>${o.timezone}</span>
            ${o.pixel ? "<span>Pixel</span>" : ""}
          </div>
        </div>
      `
              )
              .join("")
          : `<div class="empty"><div class="icon">📦</div><h3>Нет заказов</h3><p>Создайте первый заказ аккаунтов</p>
            <button type="button" class="btn btn-primary" onclick="openOrderWizard()" style="width:auto;margin:0 auto">Создать заказ</button></div>`
      }
    </div>
  `;

  el.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentOrderFilter = chip.dataset.filter;
      renderOrders();
    });
  });
}

function openOrderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;

  const steps = ["created", "accepted", "preparing", "ready", "completed"];
  const idx = steps.indexOf(o.status);
  const cancelled = o.status === "cancelled";

  openSheet(
    "Детали заказа",
    `
    <div class="flex justify-between items-center mb-16">
      <span class="order-id" style="font-size:16px">${o.id}</span>
      <span class="status status-${o.status}">${STATUS_LABELS[o.status]}</span>
    </div>

    ${
      cancelled
        ? `<div class="disclaimer-box"><strong>Заказ отменён</strong></div>`
        : `<div class="timeline">
      ${steps
        .map((s, i) => {
          const done = idx > i || (idx === i && s === "completed");
          const current = idx === i && s !== "completed";
          return `
          <div class="timeline-item ${done ? "done" : ""} ${current ? "current" : ""}">
            <div class="timeline-dot"></div>
            <div class="timeline-body">
              <h4>${STATUS_LABELS[s]}</h4>
              <p>${done || current ? "✓" : "—"}</p>
            </div>
          </div>
        `;
        })
        .join("")}
    </div>`
    }

    <div class="divider"></div>
    <div class="order-meta" style="flex-direction:column;gap:10px">
      <div class="flex justify-between"><span class="text-muted">Агент</span><strong>${o.agentName}</strong></div>
      <div class="flex justify-between"><span class="text-muted">Количество</span><strong>${o.qty}</strong></div>
      <div class="flex justify-between"><span class="text-muted">Timezone</span><strong>${o.timezone}</strong></div>
      <div class="flex justify-between"><span class="text-muted">Pixel</span><strong>${o.pixel ? "Авто" : "Нет"}</strong></div>
      <div class="flex justify-between"><span class="text-muted">Business Manager</span><strong>${o.bm === "new" ? "Новый" : "Существующий"}</strong></div>
      <div class="flex justify-between"><span class="text-muted">Fan Pages</span><strong>${o.fanPages ? o.fanPageCount || "Да" : "Нет"}</strong></div>
      <div class="flex justify-between"><span class="text-muted">AdsPower</span><strong class="font-mono">${o.adsPower || "—"}</strong></div>
      ${o.comment ? `<div><span class="text-muted">Комментарий</span><p class="mt-8 text-sm">${o.comment}</p></div>` : ""}
    </div>

    ${
      o.status === "ready"
        ? `<button type="button" class="btn btn-primary mt-20" onclick="confirmOrderReceive('${o.id}')">Подтвердить получение</button>`
        : ""
    }
    ${
      ["created"].includes(o.status)
        ? `<button type="button" class="btn btn-danger btn-sm mt-12 w-full" onclick="cancelOrder('${o.id}')">Отменить заказ</button>`
        : ""
    }
  `
  );
}

async function confirmOrderReceive(id) {
  try {
    const updated = await Api.updateOrderStatus(id, "completed");
    const o = state.orders.find((x) => x.id === id);
    if (o) Object.assign(o, updated);
    closeSheet();
    renderOrders();
    toast("Заказ подтверждён ✓", "success");
  } catch (e) {
    toast(e.message || "Не удалось обновить заказ", "error");
  }
}

async function cancelOrder(id) {
  try {
    const updated = await Api.updateOrderStatus(id, "cancelled");
    const o = state.orders.find((x) => x.id === id);
    if (o) Object.assign(o, updated);
    closeSheet();
    renderOrders();
    toast("Заказ отменён", "info");
  } catch (e) {
    toast(e.message || "Не удалось отменить заказ", "error");
  }
}

// ─── Order Wizard ───
function openOrderWizard() {
  wizard = {
    step: 1,
    agentId: null,
    qty: 10,
    timezone: "UTC+2",
    pixel: true,
    pixelCount: 1,
    pixelNames: [""],
    bm: "new",
    fanPages: false,
    fanPageCount: 3,
    fanPageNames: ["", "", ""],
    adsPower: "",
    comment: "",
  };
  renderWizard();
  openSheet("Создать заказ", `<div id="wizard-root"></div>`);
  // re-render into sheet
  setTimeout(() => {
    const root = $("#wizard-root");
    if (root) {
      renderWizardContent(root);
    }
  }, 0);
}

function renderWizard() {
  const root = $("#wizard-root");
  if (root) renderWizardContent(root);
}

function renderWizardContent(root) {
  const step = wizard.step;
  root.innerHTML = `
    <div class="wizard-steps">
      ${[1, 2, 3, 4]
        .map(
          (s) =>
            `<div class="wizard-step ${s < step ? "done" : ""} ${s === step ? "active" : ""}"></div>`
        )
        .join("")}
    </div>
    <div class="wizard-label">Шаг <strong>${step}</strong> из 4 — ${
      ["Выбор агента", "Количество", "Настройки", "Подтверждение"][step - 1]
    }</div>
    <div id="wizard-step-body"></div>
    <div class="wizard-actions">
      ${
        step > 1
          ? `<button type="button" class="btn btn-secondary" id="wiz-back">Назад</button>`
          : ""
      }
      <button type="button" class="btn btn-primary" id="wiz-next">
        ${step === 4 ? "Отправить заказ" : "Далее"}
      </button>
    </div>
  `;

  const body = $("#wizard-step-body", root);
  if (step === 1) renderWizardStep1(body);
  if (step === 2) renderWizardStep2(body);
  if (step === 3) renderWizardStep3(body);
  if (step === 4) renderWizardStep4(body);

  const back = $("#wiz-back", root);
  const next = $("#wiz-next", root);
  if (back)
    back.onclick = () => {
      wizard.step--;
      renderWizard();
    };
  if (next) next.onclick = () => wizardNext();
}

function renderWizardStep1(body) {
  body.innerHTML = `
    <div class="option-grid">
      ${AGENTS.map(
        (a) => `
        <button type="button" class="option-card ${wizard.agentId === a.id ? "selected" : ""}" data-agent="${a.id}">
          <div class="option-radio"></div>
          <div class="option-body">
            <h4>${a.name}</h4>
            <p>Среднее время: ${a.avgTime}</p>
            <div class="tags">
              ${a.verticals.map((v) => `<span class="tag">${v}</span>`).join("")}
            </div>
            <div class="stars mt-8">${formatStars(a.rating)}</div>
          </div>
          <div class="option-side">${a.percent}%</div>
        </button>
      `
      ).join("")}
    </div>
  `;
  body.querySelectorAll(".option-card").forEach((card) => {
    card.onclick = () => {
      wizard.agentId = parseInt(card.dataset.agent, 10);
      renderWizard();
    };
  });
}

function renderWizardStep2(body) {
  body.innerHTML = `
    <p class="text-center text-secondary text-sm mb-16">Сколько аккаунтов заказать?</p>
    <div class="counter">
      <button type="button" class="counter-btn" id="qty-minus">−</button>
      <div class="counter-value" id="qty-val">${wizard.qty}</div>
      <button type="button" class="counter-btn" id="qty-plus">+</button>
    </div>
    <div class="flex gap-8 justify-center mt-16">
      ${[5, 10, 25, 50]
        .map(
          (n) =>
            `<button type="button" class="filter-chip ${wizard.qty === n ? "active" : ""}" data-qty="${n}">${n}</button>`
        )
        .join("")}
    </div>
  `;
  $("#qty-minus", body).onclick = () => {
    wizard.qty = Math.max(1, wizard.qty - 1);
    renderWizard();
  };
  $("#qty-plus", body).onclick = () => {
    wizard.qty = Math.min(500, wizard.qty + 1);
    renderWizard();
  };
  body.querySelectorAll("[data-qty]").forEach((b) => {
    b.onclick = () => {
      wizard.qty = parseInt(b.dataset.qty, 10);
      renderWizard();
    };
  });
}

function renderWizardStep3(body) {
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">Timezone</label>
      <select class="form-select" id="wiz-tz">
        ${TIMEZONES.map(
          (tz) =>
            `<option value="${tz}" ${wizard.timezone === tz ? "selected" : ""}>${tz}</option>`
        ).join("")}
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Pixel</label>
      <div class="option-grid">
        <button type="button" class="option-card ${wizard.pixel ? "selected" : ""}" data-pixel="1">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Создать Pixel автоматически</h4></div>
        </button>
        <button type="button" class="option-card ${!wizard.pixel ? "selected" : ""}" data-pixel="0">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Не создавать</h4></div>
        </button>
      </div>
      <div id="pixel-fields" class="${wizard.pixel ? "" : "hidden"} mt-12">
        <label class="form-label">Количество</label>
        <input type="number" class="form-input mb-12" id="pixel-count" min="1" max="20" value="${wizard.pixelCount}" />
        <div class="fanpage-list" id="pixel-names">
          ${Array.from({ length: wizard.pixelCount }, (_, i) => `
            <div class="fanpage-row">
              <input class="form-input" placeholder="ES_Casino_Pixel_${i + 1}" data-pixel-name="${i}" value="${wizard.pixelNames[i] || ""}" />
            </div>
          `).join("")}
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Business Manager</label>
      <div class="option-grid">
        <button type="button" class="option-card ${wizard.bm === "new" ? "selected" : ""}" data-bm="new">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Выдать полный доступ к БМ</h4></div>
        </button>
        <button type="button" class="option-card ${wizard.bm === "existing" ? "selected" : ""}" data-bm="existing">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Не нужен полный доступ</h4></div>
        </button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Fan Pages</label>
      <div class="option-grid">
        <button type="button" class="option-card ${wizard.fanPages ? "selected" : ""}" data-fp="1">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Да, нужны</h4></div>
        </button>
        <button type="button" class="option-card ${!wizard.fanPages ? "selected" : ""}" data-fp="0">
          <div class="option-radio"></div>
          <div class="option-body"><h4>Нет</h4></div>
        </button>
      </div>
      <div id="fanpage-fields" class="${wizard.fanPages ? "" : "hidden"} mt-12">
        <label class="form-label">Количество</label>
        <input type="number" class="form-input mb-12" id="fp-count" min="1" max="20" value="${wizard.fanPageCount}" />
        <div class="fanpage-list" id="fp-names">
          ${Array.from({ length: wizard.fanPageCount }, (_, i) => `
            <div class="fanpage-row">
              <input class="form-input" placeholder="Casino Spain ${i + 1}" data-fp-name="${i}" value="${wizard.fanPageNames[i] || ""}" />
            </div>
          `).join("")}
        </div>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">AdsPower Login</label>
      <input class="form-input" id="wiz-adspower" placeholder="buyer_ads123" value="${wizard.adsPower}" />
      <p class="form-hint">По нему агент расшаривает профили</p>
    </div>

    <div class="form-group">
      <label class="form-label">Дополнительные комментарии</label>
      <textarea class="form-textarea" id="wiz-comment" placeholder="Особые требования...">${wizard.comment}</textarea>
    </div>
  `;

  $("#wiz-tz", body).onchange = (e) => (wizard.timezone = e.target.value);
  body.querySelectorAll("[data-pixel]").forEach((b) => {
    b.onclick = () => {
      wizard.pixel = b.dataset.pixel === "1";
      renderWizard();
    };
  });
  const pixelCountInput = $("#pixel-count", body);
  if (pixelCountInput) {
    pixelCountInput.onchange = (e) => {
      wizard.pixelCount = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1));
      while (wizard.pixelNames.length < wizard.pixelCount) wizard.pixelNames.push("");
      wizard.pixelNames = wizard.pixelNames.slice(0, wizard.pixelCount);
      renderWizard();
    };
  }
  body.querySelectorAll("[data-pixel-name]").forEach((inp) => {
    inp.oninput = () => {
      wizard.pixelNames[parseInt(inp.dataset.pixelName, 10)] = inp.value;
    };
  });
  body.querySelectorAll("[data-bm]").forEach((b) => {
    b.onclick = () => {
      wizard.bm = b.dataset.bm;
      renderWizard();
    };
  });
  body.querySelectorAll("[data-fp]").forEach((b) => {
    b.onclick = () => {
      wizard.fanPages = b.dataset.fp === "1";
      renderWizard();
    };
  });

  const fpCount = $("#fp-count", body);
  if (fpCount) {
    fpCount.onchange = (e) => {
      wizard.fanPageCount = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1));
      while (wizard.fanPageNames.length < wizard.fanPageCount) wizard.fanPageNames.push("");
      wizard.fanPageNames = wizard.fanPageNames.slice(0, wizard.fanPageCount);
      renderWizard();
    };
  }
  body.querySelectorAll("[data-fp-name]").forEach((inp) => {
    inp.oninput = () => {
      wizard.fanPageNames[parseInt(inp.dataset.fpName, 10)] = inp.value;
    };
  });
  $("#wiz-adspower", body).oninput = (e) => (wizard.adsPower = e.target.value);
  $("#wiz-comment", body).oninput = (e) => (wizard.comment = e.target.value);
}

function renderWizardStep4(body) {
  const agent = AGENTS.find((a) => a.id === wizard.agentId);
  body.innerHTML = `
    <div class="card">
      <div class="order-meta" style="flex-direction:column;gap:10px">
        <div class="flex justify-between"><span class="text-muted">Агент</span><strong>${agent ? agent.name : "—"}</strong></div>
        <div class="flex justify-between"><span class="text-muted">Количество</span><strong>${wizard.qty}</strong></div>
        <div class="flex justify-between"><span class="text-muted">Timezone</span><strong>${wizard.timezone}</strong></div>
        <div class="flex justify-between"><span class="text-muted">Pixel</span><strong>${wizard.pixel ? wizard.pixelCount : "Нет"}</strong></div>
        <div class="flex justify-between"><span class="text-muted">BM</span><strong>${wizard.bm === "new" ? "Новый" : "Существующий"}</strong></div>
        <div class="flex justify-between"><span class="text-muted">Fan Pages</span><strong>${wizard.fanPages ? wizard.fanPageCount : "Нет"}</strong></div>
        <div class="flex justify-between"><span class="text-muted">AdsPower</span><strong class="font-mono">${wizard.adsPower || "—"}</strong></div>
      </div>
    </div>
  `;
}

function wizardNext() {
  if (wizard.step === 1 && !wizard.agentId) {
    toast("Выберите агента", "error");
    return;
  }
  if (wizard.step === 3 && !wizard.adsPower.trim()) {
    toast("Укажите AdsPower Login", "error");
    return;
  }
  if (wizard.step < 4) {
    wizard.step++;
    renderWizard();
    return;
  }
  // Submit — creates the order on the backend (owner_id is derived server-side
  // from the verified Telegram user, never trusted from the client).
  const agent = AGENTS.find((a) => a.id === wizard.agentId);
  submitOrderToServer(agent);
}

async function submitOrderToServer(agent) {
  try {
    const order = await Api.createOrder({
      agentId: wizard.agentId,
      qty: wizard.qty,
      timezone: wizard.timezone,
      pixel: wizard.pixel,
      pixelNames: wizard.pixel ? wizard.pixelNames.filter(Boolean) : [],
      bm: wizard.bm,
      fanPages: wizard.fanPages,
      fanPageCount: wizard.fanPageCount,
      fanPageNames: wizard.fanPageNames.filter(Boolean),
      adsPower: wizard.adsPower,
      comment: wizard.comment,
    });
    state.orders.unshift(order);
    closeSheet();
    showSuccessModal(
      "Заказ создан!",
      `Ваш заказ <strong class="order-id">${order.id}</strong> отправлен агенту ${agent ? agent.name : order.agentName}.`,
      () => showPage("orders")
    );
  } catch (e) {
    if (e.code === "PAYMENT_REQUIRED") {
      closeSheet();
      showSubscriptionModal(e.message);
    } else {
      toast(e.message || "Не удалось создать заказ", "error");
    }
  }
}

// ─── Top-up ───
function renderTopupList() {
  const el = $("#page-topup");
  if (!el) return;

  el.innerHTML = `
    <h1 class="page-title">Пополнение</h1>
    <p class="page-sub">Прямые платежи агентам · USDT TRC20</p>

    <div class="disclaimer-box">
      <strong>⚠ AdVerse не принимает платежи</strong>
      Платформа не хранит и не переводит средства. Все переводы — напрямую между вами и агентом.
    </div>

    <div class="section-title">Выберите агента</div>
    <div class="agent-table mb-20">
      ${AGENTS.map(
        (a) => `
        <div class="agent-row" onclick="openTopupAgent(${a.id})">
          <div class="agent-row-main">
            <div class="agent-row-top">
              <span class="agent-name">${a.name}</span>
              <span class="badge badge-accent">${a.percent}%</span>
            </div>
            <div class="agent-stats">
              <span>Мин. ${formatMoney(a.minTopup)}</span>
              <span>TRC20</span>
            </div>
          </div>
          <div class="agent-row-side">
            <div class="agent-balance">${formatMoney(a.balance)}</div>
            <div class="agent-updated">ваш баланс</div>
          </div>
        </div>
      `
      ).join("")}
    </div>

    <div class="section-title">История пополнений</div>
    <div class="topup-list">
      ${state.topups
        .map(
          (t) => `
        <div class="topup-card">
          <div class="order-card-header">
            <span class="order-id">${t.id}</span>
            <span class="status status-${t.status}">${STATUS_LABELS[t.status]}</span>
          </div>
          <div class="order-meta">
            <span><strong>${t.agentName}</strong></span>
            <span class="text-green"><strong>${formatMoney(t.amount)}</strong></span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function openTopupAgent(id) {
  topupAgentId = id;
  const a = AGENTS.find((x) => x.id === id);
  if (!a) return;

  openSheet(
    a.name,
    `
    <div class="wallet-card">
      <div class="text-xs text-muted mb-8">TRC20 Wallet</div>
      <div class="wallet-address" id="wallet-addr" onclick="copyWallet('${a.wallet}')">${a.wallet}</div>
      <div class="wallet-info">
        <div>Минимум: <strong>${formatMoney(a.minTopup)}</strong></div>
        <div>Ваш баланс: <strong class="text-green">${formatMoney(a.balance)}</strong></div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="section-title" style="margin-bottom:8px">Инструкция</div>
      <p class="text-sm text-secondary">${a.instruction}</p>
    </div>

    <div class="form-group">
      <label class="form-label">Сумма (USDT)</label>
      <input type="number" class="form-input" id="topup-amount" placeholder="${a.minTopup}" min="${a.minTopup}" />
    </div>
    <div class="form-group">
      <label class="form-label">Hash (Tronscan)</label>
      <input class="form-input font-mono" id="topup-hash" placeholder="Tx Hash транзакции" />
      <p class="form-hint">Скопируйте hash из Tronscan после оплаты</p>
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий</label>
      <input class="form-input" id="topup-comment" placeholder="Опционально" />
    </div>

    <button type="button" class="btn btn-primary" onclick="submitTopup()">Создать заявку</button>
  `
  );
}

function copyWallet(addr) {
  navigator.clipboard?.writeText(addr).then(() => toast("Кошелёк скопирован", "success"));
}

async function submitTopup() {
  const a = AGENTS.find((x) => x.id === topupAgentId);
  const amount = parseFloat($("#topup-amount")?.value || "0");
  const hash = $("#topup-hash")?.value?.trim() || "";
  const comment = $("#topup-comment")?.value?.trim() || "";

  if (!a) return;
  if (!amount || amount < a.minTopup) {
    toast(`Минимум ${formatMoney(a.minTopup)}`, "error");
    return;
  }
  if (hash.length < 20) {
    toast("Укажите корректный Tx Hash", "error");
    return;
  }

  try {
    const topup = await Api.createTopup({ agentId: a.id, amount, hash, comment });
    state.topups.unshift(topup);
    closeSheet();
    showSuccessModal(
      "Заявка создана",
      `Пополнение <strong>${formatMoney(amount)}</strong> для ${a.name}<br><span class="order-id">${topup.id}</span>`,
      () => showPage("topup")
    );
  } catch (e) {
    if (e.code === "PAYMENT_REQUIRED") {
      closeSheet();
      showSubscriptionModal(e.message);
    } else {
      toast(e.message || "Не удалось создать заявку", "error");
    }
  }
}

// ─── Accounts ───
function renderAccounts() {
  const el = $("#page-accounts");
  if (!el) return;

  let list = state.accounts;
  if (currentAccountFilter === "active") list = list.filter((a) => a.status === "active");
  if (currentAccountFilter === "error") list = list.filter((a) => a.status === "error");
  if (currentAccountFilter === "pending") list = list.filter((a) => a.status === "pending");

  el.innerHTML = `
    <h1 class="page-title">Мои аккаунты</h1>
    <p class="page-sub">${state.accounts.length} подключено · Facebook Marketing API</p>

    <button type="button" class="btn btn-primary mb-16" onclick="openAddAccount()">+ Подключить рекламный кабинет</button>

    <div class="filter-bar">
      ${[
        ["all", "Все"],
        ["active", "Active"],
        ["pending", "Не синхр."],
        ["error", "Ошибка"],
      ]
        .map(
          ([f, l]) =>
            `<button type="button" class="filter-chip ${currentAccountFilter === f ? "active" : ""}" data-filter="${f}">${l}</button>`
        )
        .join("")}
    </div>

    <div class="account-list">
      ${
        list.length
          ? list
              .map(
                (a) => `
        <div class="account-card" onclick="openAccountDetail(${a.id})">
          <div class="account-card-header">
            <div>
              <div style="font-weight:600;font-size:14px">${a.name}</div>
              <div class="text-xs text-muted mt-8">${a.fbAccountId ? "act_" + a.fbAccountId : "нет токена"}${a.agentName ? " · " + a.agentName : ""}</div>
            </div>
            <span class="status status-${a.status === "active" ? "active" : a.status === "error" ? "disabled" : "created"}">
              ${a.status === "active" ? "Active" : a.status === "error" ? "Ошибка" : "Не синхронизирован"}
            </span>
          </div>
          <div class="account-meta">
            ${
              a.status === "active"
                ? `<span>Spend (мес.) <strong>${formatMoney(a.spend.month)}</strong></span>`
                : a.status === "error"
                ? `<span class="badge badge-red">${a.lastError || "Ошибка синхронизации"}</span>`
                : `<span class="badge badge-muted">Ещё не синхронизирован</span>`
            }
            <span>${a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString("ru-RU") : "никогда"}</span>
          </div>
        </div>
      `
              )
              .join("")
          : `<p class="text-secondary text-sm">Пока нет подключённых кабинетов — нажмите «Подключить» выше.</p>`
      }
    </div>
  `;

  el.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentAccountFilter = chip.dataset.filter;
      renderAccounts();
    });
  });
}

function openAddAccount() {
  openSheet(
    "Подключить рекламный кабинет",
    `
    <div class="disclaimer-box mt-4 mb-16">
      <strong>🔒 Как получить токен</strong>
      Нужен access token с правом <code>ads_read</code> — например System User
      Token из Facebook Business Manager. Платформа хранит только этот токен,
      логины/пароли/куки не запрашиваются.
    </div>
    <div class="form-group">
      <label class="form-label">Название (для себя)</label>
      <input class="form-input" id="acc-name" placeholder="ES Gambling 01" />
    </div>
    <div class="form-group">
      <label class="form-label">Выдан агентом</label>
      <select class="form-select" id="acc-agent">
        <option value="">— не указан —</option>
        ${AGENTS.map((a) => `<option value="${a.id}">${a.name}</option>`).join("")}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">ID рекламного кабинета <span class="text-muted">(можно добавить позже)</span></label>
      <input class="form-input font-mono" id="acc-fbid" placeholder="1234567890 или act_1234567890" />
    </div>
    <div class="form-group">
      <label class="form-label">Access Token <span class="text-muted">(можно добавить позже)</span></label>
      <input class="form-input font-mono" id="acc-token" placeholder="EAAxxxx..." />
    </div>
    <button type="button" class="btn btn-primary" onclick="submitAddAccount()">Добавить кабинет</button>
  `
  );
}

async function submitAddAccount() {
  const name = $("#acc-name")?.value?.trim();
  const agentId = $("#acc-agent")?.value;
  const fbId = $("#acc-fbid")?.value?.trim();
  const token = $("#acc-token")?.value?.trim();
  try {
    const acc = await Api.createAccount({
      name,
      agent_id: agentId ? parseInt(agentId, 10) : null,
      fb_account_id: fbId,
      access_token: token,
    });
    state.accounts.unshift(fromApiAccount(acc));
    closeSheet();
    renderAccounts();
    if (fbId && token) {
      toast("Кабинет добавлен, синхронизирую...", "info");
      await syncAccountFromCard(acc.id);
    } else {
      toast("Кабинет добавлен — вставьте токен позже, чтобы увидеть spend", "success");
    }
  } catch (e) {
    toast(e.message || "Не удалось добавить кабинет", "error");
  }
}

function openAccountDetail(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;

  const needsToken = !a.hasToken || !a.fbAccountId;

  openSheet(
    a.name,
    `
    <div class="flex justify-between items-center mb-16">
      ${a.agentName ? `<span class="badge badge-accent">${a.agentName}</span>` : `<span></span>`}
      <span class="status status-${a.status === "active" ? "active" : a.status === "error" ? "disabled" : "created"}">
        ${a.status === "active" ? "Active" : a.status === "error" ? "Ошибка" : "Не синхронизирован"}
      </span>
    </div>
    ${a.orderId ? `<p class="text-xs text-muted mb-12">Из заказа <span class="order-id">${a.orderId}</span></p>` : ""}

    ${a.status === "error" ? `<div class="disclaimer-box mb-16" style="border-color:var(--red)">⚠️ ${a.lastError}</div>` : ""}

    ${
      needsToken
        ? `
      <div class="form-group">
        <label class="form-label">ID рекламного кабинета</label>
        <input class="form-input font-mono" id="acc-detail-fbid" placeholder="1234567890" value="${a.fbAccountId || ""}" />
      </div>
      <div class="form-group">
        <label class="form-label">Access Token</label>
        <input class="form-input font-mono" id="acc-detail-token" placeholder="EAAxxxx..." />
      </div>
      <button type="button" class="btn btn-primary mb-12" onclick="attachAccountToken(${a.id})">Привязать токен и синхронизировать</button>
    `
        : `
      <div class="spend-periods mb-12">
        <div class="period-chip"><div class="val">${formatMoney(a.spend.today)}</div><div class="lbl">Сегодня</div></div>
        <div class="period-chip"><div class="val">${formatMoney(a.spend.week)}</div><div class="lbl">Неделя</div></div>
        <div class="period-chip"><div class="val">${formatMoney(a.spend.month)}</div><div class="lbl">Месяц</div></div>
        <div class="period-chip"><div class="val">${formatMoney(a.spend.lifetime)}</div><div class="lbl">Lifetime</div></div>
      </div>
      <div class="stat-row">
        <div class="stat-box"><div class="val">${a.campaigns}</div><div class="lbl">Campaigns</div></div>
        <div class="stat-box"><div class="val">${a.adsets}</div><div class="lbl">Ad Sets</div></div>
        <div class="stat-box"><div class="val">${a.ads}</div><div class="lbl">Ads</div></div>
      </div>
      <p class="text-xs text-muted text-center mt-12">Синхронизировано: ${a.lastSyncedAt ? new Date(a.lastSyncedAt).toLocaleString("ru-RU") : "никогда"}</p>
      <button type="button" class="btn btn-primary mt-12" onclick="syncAccountFromCard(${a.id})">🔄 Синхронизировать сейчас</button>
    `
    }
    <button type="button" class="btn btn-secondary w-full mt-8" style="color:var(--red)" onclick="removeAccount(${a.id})">Отключить и удалить</button>
  `
  );
}

async function attachAccountToken(id) {
  const fbId = $("#acc-detail-fbid")?.value?.trim();
  const token = $("#acc-detail-token")?.value?.trim();
  if (!fbId || !token) {
    toast("Укажите ID кабинета и токен", "error");
    return;
  }
  try {
    const acc = await Api.setAccountToken(id, fbId, token);
    const a = state.accounts.find((x) => x.id === id);
    if (a) Object.assign(a, fromApiAccount(acc));
    toast("Токен привязан, синхронизирую...", "info");
    await syncAccountFromCard(id);
  } catch (e) {
    toast(e.message || "Не удалось привязать токен", "error");
  }
}

async function syncAccountFromCard(id) {
  try {
    const fresh = await Api.syncAccount(id);
    const a = state.accounts.find((x) => x.id === id);
    if (a) Object.assign(a, fromApiAccount(fresh));
    renderAccounts();
    if ($("#sheet")?.classList.contains("open")) openAccountDetail(id);
    toast("Синхронизировано", "success");
  } catch (e) {
    // 502 с сообщением от Facebook (например, невалидный токен) — покажем как есть
    const acc = state.accounts.find((x) => x.id === id);
    if (acc) {
      acc.status = "error";
      acc.lastError = e.message;
    }
    renderAccounts();
    toast(e.message || "Ошибка синхронизации", "error");
  }
}

async function removeAccount(id) {
  try {
    await Api.deleteAccount(id);
    state.accounts = state.accounts.filter((x) => x.id !== id);
    closeSheet();
    renderAccounts();
    toast("Кабинет отключён", "info");
  } catch (e) {
    toast(e.message || "Не удалось отключить кабинет", "error");
  }
}

// ─── More / Menu ───
function renderMore() {
  const el = $("#page-more");
  if (!el) return;
  const role = state.sessionRole || ROLES[state.role];

  const buyerItems = `
    <div class="settings-group">
      <div class="settings-row" onclick="showPage('agents-browse')"><span>🏢 Агенты</span><span class="arrow">›</span></div>
      <div class="settings-row" onclick="showPage('analytics')"><span>📊 Аналитика</span><span class="arrow">›</span></div>
      <div class="settings-row" onclick="showPage('support')"><span>🎧 Support</span><span class="arrow">›</span></div>
      <div class="settings-row" onclick="showPage('pricing')"><span>✦ Тарифы</span><span class="arrow">›</span></div>
      ${state.role === "team" ? `<div class="settings-row" onclick="showPage('team')"><span>👥 Команда</span><span class="arrow">›</span></div>` : ""}
    </div>
  `;

  const agentItems = `
    <div class="settings-group">
      <div class="settings-row" onclick="showPage('support')"><span>🎧 Написать в Support</span><span class="arrow">›</span></div>
    </div>
  `;

  el.innerHTML = `
    <h1 class="page-title">Ещё</h1>
    <p class="page-sub">Настройки и разделы</p>

    <div class="profile-header">
      <div class="avatar lg">${role.avatar}</div>
      <h2 style="font-size:18px;font-weight:700">${role.displayName}</h2>
      <p class="text-secondary text-sm">@${role.username} · ${role.plan}</p>
    </div>

    ${["buyer", "team"].includes(state.role) ? buyerItems : ""}
    ${state.role === "agent" ? agentItems : ""}

    ${
      state.isAdmin
        ? `<div class="settings-group">
            <div class="settings-row" onclick="showPage('admin-agents')"><span>⚙️ Управление агентами</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-users')"><span>🛡️ Пользователи (Центр управления)</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-topups')"><span>💰 Пополнения</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-tickets')"><span>🎫 Тикеты поддержки</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-settings')"><span>🔧 Настройки</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-health')"><span>🟢 Статусы</span><span class="arrow">›</span></div>
            <div class="settings-row" onclick="showPage('admin-logs')"><span>📜 Аудит-лог</span><span class="arrow">›</span></div>
          </div>`
        : ""
    }

    <div class="settings-group">
      <div class="settings-row" onclick="openNotifications()"><span>🔔 Уведомления</span>
        <span class="badge badge-accent">${state.notifications.filter((n) => n.unread).length}</span>
      </div>
      <div class="settings-row" onclick="showPage('profile')"><span>👤 Профиль</span><span class="arrow">›</span></div>
      <div class="settings-row" onclick="openSupportChat()"><span>💬 Telegram Support</span><span class="arrow">›</span></div>
    </div>

    <div class="settings-group">
      <div class="settings-row" onclick="switchRole()"><span>🔄 Сменить роль (демо)</span><span class="value">${role.name}</span></div>
      <div class="settings-row" onclick="logout()" style="color:var(--red)"><span>Выйти</span></div>
    </div>

    <p class="text-center text-xs text-muted mt-20">AdVerse CRM MVP · Subscription only<br>Платформа не является финансовым посредником</p>
  `;
}

function switchRole() {
  logout();
}

// ─── Team ───
function renderTeam() {
  const el = $("#page-team");
  if (!el) return;

  el.innerHTML = `
    <h1 class="page-title">Команда</h1>
    <p class="page-sub">${TEAM_MEMBERS.length} участников · Team тариф</p>

    <div class="kpi-grid mb-20">
      <div class="kpi-card team">
        <div class="kpi-label">Members</div>
        <div class="kpi-value">${TEAM_MEMBERS.length}</div>
      </div>
      <div class="kpi-card spend">
        <div class="kpi-label">Team Spend</div>
        <div class="kpi-value">${formatMoney(TEAM_MEMBERS.reduce((s, m) => s + m.spend, 0))}</div>
      </div>
    </div>

    <div class="section-title">
      Участники
      <button type="button" class="link" onclick="inviteMember()">+ Пригласить</button>
    </div>
    <div class="member-list">
      ${TEAM_MEMBERS.map(
        (m) => `
        <div class="member-row">
          <div class="avatar sm">${m.avatar}</div>
          <div class="member-info">
            <h4>${m.name}</h4>
            <p>${m.role} · ${m.accounts} акк. · ${formatMoney(m.spend)} spend</p>
          </div>
          ${
            m.role !== "Owner"
              ? `<button type="button" class="btn btn-ghost btn-sm" onclick="toast('Права обновлены','info')">Права</button>`
              : `<span class="badge badge-accent">Owner</span>`
          }
        </div>
      `
      ).join("")}
    </div>
  `;
}

function inviteMember() {
  openSheet(
    "Пригласить сотрудника",
    `
    <div class="form-group">
      <label class="form-label">Telegram Username</label>
      <input class="form-input" id="invite-user" placeholder="@username" />
    </div>
    <div class="form-group">
      <label class="form-label">Роль</label>
      <select class="form-select" id="invite-role">
        <option value="buyer">Buyer</option>
        <option value="viewer">Viewer</option>
      </select>
    </div>
    <button type="button" class="btn btn-primary" onclick="sendInvite()">Отправить приглашение</button>
  `
  );
}

function sendInvite() {
  const user = $("#invite-user")?.value?.trim();
  if (!user) {
    toast("Укажите username", "error");
    return;
  }
  closeSheet();
  toast(`Приглашение отправлено ${user}`, "success");
}

// ─── Pricing ───
function renderPricing() {
  const el = $("#page-pricing");
  if (!el) return;

  if (!state.isAdmin && !state.isPaid) {
    el.innerHTML = `
      <h1 class="page-title">Тарифы</h1>
      <div class="card text-center mt-20" style="padding:32px 20px">
        <div style="font-size:40px;margin-bottom:12px">⏳</div>
        <h2 style="font-size:17px;font-weight:700;margin-bottom:8px">Ожидание активации</h2>
        <p class="text-secondary text-sm mb-20">
          Доступ к тарифам открывает администратор после проверки заявки.
          Мы уже получили ваш запрос — обычно активация занимает немного времени.
        </p>
        <button type="button" class="btn btn-primary" onclick="showPage('support')">Связаться с поддержкой</button>
      </div>
    `;
    return;
  }

  // Тариф назначает только админ (см. /api/admin/users/update) — раньше
  // кнопка "Выбрать" просто меняла state.currentPlan локально, без единого
  // запроса на бэкенд, то есть любой оплативший buyer мог "включить" себе
  // Unlimited бесплатно в один клик на клиенте. Теперь тарифы — read-only
  // витрина текущего плана, смена — только через заявку в поддержку.
  const myPlan = state.currentUser?.subscription_plan || null;

  el.innerHTML = `
    <h1 class="page-title">Тарифы</h1>
    <p class="page-sub">${myPlan ? "Ваш текущий тариф отмечен ниже" : "Тариф ещё не назначен — обратитесь в поддержку"}</p>

    <div class="pricing-grid">
      ${PLANS.map(
        (p) => `
        <div class="plan-card ${p.featured ? "featured" : ""} ${myPlan === p.id ? "current" : ""}">
          ${myPlan === p.id ? `<div class="plan-current-badge">Текущий тариф</div>` : ""}
          <div class="plan-name">${p.name}</div>
          <div class="plan-price">$${p.price}<span>/мес</span></div>
          <div class="plan-desc">${p.desc}</div>
          <ul class="plan-features">
            ${p.features.map((f) => `<li>${f}</li>`).join("")}
          </ul>
          ${
            myPlan === p.id
              ? `<button type="button" class="btn btn-secondary w-full" disabled>Активен</button>`
              : `<button type="button" class="btn btn-primary w-full" onclick="requestPlanChange('${p.id}')">Запросить смену</button>`
          }
        </div>
      `
      ).join("")}
    </div>
  `;
}

async function requestPlanChange(planId) {
  const p = PLANS.find((x) => x.id === planId);
  try {
    await Api.createTicket("Смена тарифа", `Прошу перевести меня на тариф "${p.name}" ($${p.price}/мес).`);
    toast("Заявка на смену тарифа отправлена в поддержку", "success");
    showPage("support");
  } catch (e) {
    toast(e.message || "Не удалось отправить заявку", "error");
  }
}

// ─── Support ───
// ─── Agents browse (filter by vertical, view reviews) ───
let currentAgentVerticalFilter = "all";
function renderAgentsBrowse() {
  const el = $("#page-agents-browse");
  if (!el) return;

  const allVerticals = [...new Set(AGENTS.flatMap((a) => a.verticals))];
  let list = AGENTS;
  if (currentAgentVerticalFilter !== "all") {
    list = list.filter((a) => a.verticals.includes(currentAgentVerticalFilter));
  }

  el.innerHTML = `
    <h1 class="page-title">Агенты</h1>
    <p class="page-sub">${AGENTS.length} агентов · фильтр по вертикали</p>

    <div class="filter-bar">
      <button type="button" class="filter-chip ${currentAgentVerticalFilter === "all" ? "active" : ""}" data-vertical="all">Все</button>
      ${allVerticals
        .map((v) => `<button type="button" class="filter-chip ${currentAgentVerticalFilter === v ? "active" : ""}" data-vertical="${v}">${v}</button>`)
        .join("")}
    </div>

    <div class="order-list mt-12">
      ${
        list.length
          ? list
              .map(
                (a) => `
        <div class="card mb-12" style="padding:14px" onclick="openAgentDetail(${a.id})">
          <div class="flex justify-between items-center mb-8">
            <strong>${a.name}</strong>
            <span class="badge badge-accent">${a.percent}%</span>
          </div>
          <div class="flex gap-8 mb-8">
            <span class="stars">${formatStars(a.rating)}</span>
            <span class="text-xs text-muted">${a.reviewCount ? `${a.avgRating} · ${a.reviewCount} отзыв(ов)` : "нет отзывов"}</span>
          </div>
          <div class="tags">${a.verticals.map((v) => `<span class="tag">${v}</span>`).join("")}</div>
        </div>
      `
              )
              .join("")
          : `<p class="text-secondary text-sm">Нет агентов с такой вертикалью</p>`
      }
    </div>
  `;

  el.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      currentAgentVerticalFilter = chip.dataset.vertical;
      renderAgentsBrowse();
    });
  });
}

function renderSupport() {
  const el = $("#page-support");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Api.listTickets()
    .then((tickets) => {
      state.myTickets = tickets;
      el.innerHTML = `
        <h1 class="page-title">Support</h1>
        <p class="page-sub">Сообщение уходит администратору напрямую в Telegram</p>

        <button type="button" class="btn btn-primary mb-16" onclick="openCreateTicket()">+ Новое обращение</button>

        <div class="ticket-list">
          ${
            tickets.length
              ? tickets
                  .map(
                    (t) => `
            <div class="ticket-card" onclick="openTicketDetail(${t.id})">
              <div class="ticket-card-header">
                <span class="order-id">TKT-${t.id}</span>
                <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
              </div>
              <div style="font-weight:600;font-size:13px;margin-bottom:6px">${t.subject}</div>
              <div class="order-meta"><span>${t.messages.length} сообщени${t.messages.length === 1 ? "е" : "й"}</span></div>
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Пока нет обращений</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить тикеты: ${e.message}</p>`;
    });
}

function openCreateTicket() {
  openSheet(
    "Новое обращение",
    `
    <div class="form-group">
      <label class="form-label">Тема</label>
      <input class="form-input" id="tkt-subject" placeholder="Кратко опишите проблему" />
    </div>
    <div class="form-group">
      <label class="form-label">Сообщение</label>
      <textarea class="form-textarea" id="tkt-msg" placeholder="Подробности..."></textarea>
    </div>
    <button type="button" class="btn btn-primary" onclick="submitTicket()">Отправить</button>
  `
  );
}

async function submitTicket() {
  const subject = $("#tkt-subject")?.value?.trim();
  const message = $("#tkt-msg")?.value?.trim();
  if (!subject || !message) {
    toast("Заполните тему и сообщение", "error");
    return;
  }
  try {
    await Api.createTicket(subject, message);
    closeSheet();
    renderSupport();
    toast("Отправлено администратору в Telegram", "success");
  } catch (e) {
    toast(e.message || "Не удалось отправить тикет", "error");
  }
}

function openTicketDetail(id) {
  const t = (state.myTickets || []).find((x) => x.id === id);
  if (!t) return;
  openSheet(
    `TKT-${t.id}`,
    `
    <div class="flex gap-8 mb-12">
      <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
    </div>
    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">${t.subject}</h3>
    <div class="mb-16" style="display:flex;flex-direction:column;gap:8px">
      ${t.messages
        .map(
          (m) => `
        <div style="align-self:${m.sender === "admin" ? "flex-start" : "flex-end"};max-width:85%;padding:8px 12px;border-radius:12px;background:${m.sender === "admin" ? "var(--bg-glass-strong)" : "var(--accent-soft)"}">
          <div class="text-xs text-secondary mb-4">${m.sender === "admin" ? "Поддержка" : "Вы"} · ${new Date(m.createdAt).toLocaleString("ru-RU")}</div>
          <div class="text-sm">${escapeHtml(m.text)}</div>
        </div>
      `
        )
        .join("")}
    </div>
    <div class="form-group">
      <label class="form-label">Написать ещё</label>
      <textarea class="form-textarea" id="tkt-reply" placeholder="Ваше сообщение..."></textarea>
    </div>
    <button type="button" class="btn btn-primary" onclick="submitSupportMessage(${t.id})">Отправить</button>
  `
  );
}

async function submitSupportMessage(ticketId) {
  const msg = $("#tkt-reply")?.value?.trim();
  if (!msg) {
    toast("Введите сообщение", "error");
    return;
  }
  try {
    await Api.addTicketMessage(ticketId, msg);
    closeSheet();
    renderSupport();
    toast("Отправлено", "success");
  } catch (e) {
    toast(e.message || "Не удалось отправить", "error");
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ─── Profile / Analytics ───
function renderProfile() {
  const el = $("#page-profile");
  if (!el) return;
  // Баг из ТЗ v2.0: раньше здесь брался статический мок ROLES[state.role],
  // из-за чего в профиле всегда показывался фейковый "alex_buyer" вместо
  // реального ника. Правильный источник — state.sessionRole (собран в
  // enterApp() из ответа сервера user.username) или сам state.currentUser.
  const role = state.sessionRole || ROLES[state.role];
  const u = state.currentUser;
  const paidBadge = state.isAdmin
    ? `<span class="badge badge-accent mt-8">Admin · бесплатно</span>`
    : u && !u.is_paid
    ? `<span class="badge badge-muted mt-8">Ожидание активации</span>`
    : `<span class="badge badge-green mt-8">Оплачено</span>`;

  el.innerHTML = `
    <h1 class="page-title">Профиль</h1>
    <div class="profile-header">
      <div class="avatar lg">${role.avatar}</div>
      <h2 style="font-size:18px;font-weight:700">${role.displayName}</h2>
      <p class="text-secondary">@${role.username}</p>
      ${paidBadge}
    </div>

    <div class="section-title">Балансы по агентам</div>
    <div class="agent-table">
      ${AGENTS.map(
        (a) => `
        <div class="agent-row">
          <div class="agent-name">${a.name}</div>
          <div class="agent-balance">${formatMoney(a.balance)}</div>
        </div>
      `
      ).join("")}
    </div>
    <div class="card mt-12 text-center">
      <div class="kpi-label">Общий баланс</div>
      <div class="kpi-value text-green">${formatMoney(totalBalance())}</div>
    </div>
  `;
}

function renderAnalytics() {
  const el = $("#page-analytics");
  if (!el) return;
  const spend = totalSpend(state.accounts);

  el.innerHTML = `
    <h1 class="page-title">Аналитика</h1>
    <p class="page-sub">Facebook Marketing API</p>

    <div class="card mb-16">
      <div class="section-title">Общий Spend</div>
      <div class="spend-periods">
        <div class="period-chip"><div class="val">${formatMoney(spend.today)}</div><div class="lbl">Сегодня</div></div>
        <div class="period-chip"><div class="val">${formatMoney(spend.week)}</div><div class="lbl">Неделя</div></div>
        <div class="period-chip"><div class="val">${formatMoney(spend.month)}</div><div class="lbl">Месяц</div></div>
        <div class="period-chip"><div class="val">${formatMoney(spend.lifetime)}</div><div class="lbl">Lifetime</div></div>
      </div>
      <div class="mini-chart mt-12">
        ${[30, 50, 45, 70, 60, 85, 55, 90, 75, 95, 80, 100]
          .map((h) => `<div class="bar" style="height:${h}%"></div>`)
          .join("")}
      </div>
    </div>

    <div class="stat-row mb-16">
      <div class="stat-box"><div class="val">${state.accounts.filter((a) => a.status === "active").reduce((s, a) => s + a.campaigns, 0)}</div><div class="lbl">Campaigns</div></div>
      <div class="stat-box"><div class="val">${state.accounts.filter((a) => a.status === "active").reduce((s, a) => s + a.adsets, 0)}</div><div class="lbl">Ad Sets</div></div>
      <div class="stat-box"><div class="val">${state.accounts.filter((a) => a.status === "active").reduce((s, a) => s + a.ads, 0)}</div><div class="lbl">Ads</div></div>
      <div class="stat-box"><div class="val" style="color:var(--red)">${state.accounts.filter((a) => a.status === "error").length}</div><div class="lbl">С ошибкой</div></div>
    </div>

    <div class="section-title">Статусы аккаунтов</div>
    <div class="account-list">
      ${
        state.accounts.length
          ? state.accounts
              .map(
                (a) => `
        <div class="account-card">
          <div class="flex justify-between">
            <strong class="text-sm">${a.name}</strong>
            <span class="status status-${a.status === "active" ? "active" : a.status === "error" ? "disabled" : "created"}">
              ${a.status === "active" ? "Active" : a.status === "error" ? "Ошибка" : "Не синхронизирован"}
            </span>
          </div>
          ${a.status === "error" ? `<p class="text-xs mt-8" style="color:var(--red)">${a.lastError}</p>` : ""}
        </div>
      `
              )
              .join("")
          : `<p class="text-secondary text-sm">Подключите рекламный кабинет на странице «Мои аккаунты»</p>`
      }
    </div>
  `;
}

// ─── Agent Panel ───
function renderAgentHome() {
  const el = $("#page-agent-home");
  if (!el) return;
  const myOrders = state.orders.filter((o) => o.agentId === 1);
  const myTopups = state.topups.filter((t) => t.agentId === 1);
  const pending = myOrders.filter((o) => ["created", "accepted", "preparing"].includes(o.status));
  const pendingTopups = myTopups.filter((t) => ["submitted", "waiting"].includes(t.status));

  el.innerHTML = `
    <h1 class="page-title">Agent Panel</h1>
    <p class="page-sub">Только ваши данные</p>

    <div class="kpi-grid">
      <div class="kpi-card agents">
        <div class="kpi-label">Новые</div>
        <div class="kpi-value">${myOrders.filter((o) => o.status === "created").length}</div>
      </div>
      <div class="kpi-card accounts">
        <div class="kpi-label">В работе</div>
        <div class="kpi-value">${pending.length}</div>
      </div>
      <div class="kpi-card balance">
        <div class="kpi-label">Пополнения</div>
        <div class="kpi-value">${pendingTopups.length}</div>
      </div>
      <div class="kpi-card spend">
        <div class="kpi-label">Готовые</div>
        <div class="kpi-value">${myOrders.filter((o) => o.status === "ready").length}</div>
      </div>
    </div>

    <div class="section-title">Быстрые действия</div>
    <div class="admin-grid">
      <div class="admin-tile" onclick="showPage('agent-orders')">
        <div class="icon">📦</div>
        <h4>Заказы</h4>
        <p>${myOrders.length} всего</p>
      </div>
      <div class="admin-tile" onclick="showPage('agent-topups')">
        <div class="icon">💰</div>
        <h4>Пополнения</h4>
        <p>${pendingTopups.length} ждут</p>
      </div>
      <div class="admin-tile" onclick="showPage('agent-balances')">
        <div class="icon">📊</div>
        <h4>Балансы</h4>
        <p>Обновить</p>
      </div>
      <div class="admin-tile" onclick="toast('Sheets sync started','info')">
        <div class="icon">📑</div>
        <h4>Sheets Sync</h4>
        <p>Excel / GSheets</p>
      </div>
    </div>
  `;
}

function renderAgentOrders() {
  const el = $("#page-agent-orders");
  if (!el) return;
  const myOrders = state.orders.filter((o) => o.agentId === 1);

  el.innerHTML = `
    <h1 class="page-title">Мои заказы</h1>
    <p class="page-sub">Управление статусами</p>

    <div class="tabs" id="agent-order-tabs">
      <button type="button" class="tab active" data-tab="new">Новые</button>
      <button type="button" class="tab" data-tab="work">В работе</button>
      <button type="button" class="tab" data-tab="ready">Готовые</button>
      <button type="button" class="tab" data-tab="all">Все</button>
    </div>
    <div id="agent-orders-list"></div>
  `;

  const renderList = (tab) => {
    let list = myOrders;
    if (tab === "new") list = myOrders.filter((o) => o.status === "created");
    if (tab === "work") list = myOrders.filter((o) => ["accepted", "preparing"].includes(o.status));
    if (tab === "ready") list = myOrders.filter((o) => ["ready", "completed"].includes(o.status));

    const container = $("#agent-orders-list");
    container.innerHTML =
      `<div class="order-list">` +
      (list.length
        ? list
            .map(
              (o) => `
        <div class="order-card">
          <div class="order-card-header">
            <span class="order-id">${o.id}</span>
            <span class="status status-${o.status}">${STATUS_LABELS[o.status]}</span>
          </div>
          <div class="order-meta mb-12">
            <span>${o.qty} акк.</span>
            <span>${o.timezone}</span>
            <span class="font-mono">${o.adsPower}</span>
          </div>
          <div class="flex gap-8">
            ${orderAgentActions(o)}
          </div>
        </div>
      `
            )
            .join("")
        : `<div class="empty"><div class="icon">📦</div><h3>Пусто</h3></div>`) +
      `</div>`;
  };

  renderList("new");
  $$("#agent-order-tabs .tab").forEach((tab) => {
    tab.onclick = () => {
      $$("#agent-order-tabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      renderList(tab.dataset.tab);
    };
  });
}

function orderAgentActions(o) {
  const next = {
    created: { status: "accepted", label: "Принять" },
    accepted: { status: "preparing", label: "В подготовку" },
    preparing: { status: "ready", label: "Готово" },
  };
  const n = next[o.status];
  if (!n) return `<span class="text-xs text-muted">Нет действий</span>`;
  return `<button type="button" class="btn btn-primary btn-sm" onclick="agentUpdateOrder('${o.id}','${n.status}')">${n.label}</button>`;
}

async function agentUpdateOrder(id, status) {
  try {
    const updated = await Api.updateOrderStatus(id, status);
    const o = state.orders.find((x) => x.id === id);
    if (o) Object.assign(o, updated);
    renderAgentOrders();
    toast(`Статус → ${STATUS_LABELS[status]}`, "success");
  } catch (e) {
    toast(e.message || "Не удалось обновить статус", "error");
  }
}

function renderAgentTopups() {
  const el = $("#page-agent-topups");
  if (!el) return;
  const myTopups = state.topups.filter((t) => t.agentId === 1);

  el.innerHTML = `
    <h1 class="page-title">Пополнения</h1>
    <p class="page-sub">Подтверждение заявок</p>

    <div class="topup-list">
      ${myTopups
        .map(
          (t) => `
        <div class="topup-card">
          <div class="order-card-header">
            <span class="order-id">${t.id}</span>
            <span class="status status-${t.status}">${STATUS_LABELS[t.status]}</span>
          </div>
          <div class="order-meta mb-12">
            <span class="text-green"><strong>${formatMoney(t.amount)}</strong></span>
            <span class="font-mono text-xs">${t.hash.slice(0, 16)}…</span>
          </div>
          ${
            ["submitted", "waiting"].includes(t.status)
              ? `<div class="flex gap-8">
                  <button type="button" class="btn btn-success btn-sm" onclick="agentConfirmTopup('${t.id}')">Подтвердить</button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="agentWaitTopup('${t.id}')">Waiting</button>
                </div>`
              : ""
          }
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

async function agentConfirmTopup(id) {
  try {
    // Server sets status to "confirmed" and credits the buyer's balance atomically.
    const updated = await Api.updateTopupStatus(id, "confirmed");
    const t = state.topups.find((x) => x.id === id);
    if (t) Object.assign(t, updated);
    renderAgentTopups();
    toast("Пополнение подтверждено, баланс обновлён", "success");
  } catch (e) {
    toast(e.message || "Не удалось подтвердить пополнение", "error");
  }
}

async function agentWaitTopup(id) {
  try {
    const updated = await Api.updateTopupStatus(id, "waiting");
    const t = state.topups.find((x) => x.id === id);
    if (t) Object.assign(t, updated);
    renderAgentTopups();
    toast("Статус: Waiting Confirmation", "info");
  } catch (e) {
    toast(e.message || "Не удалось обновить статус", "error");
  }
}

function renderAgentBalances() {
  const el = $("#page-agent-balances");
  if (!el) return;
  const agent = AGENTS[0];

  el.innerHTML = `
    <h1 class="page-title">Балансы</h1>
    <p class="page-sub">Источник: Excel / Google Sheets</p>

    <div class="card mb-16 text-center">
      <div class="kpi-label">Текущий баланс байеров</div>
      <div class="kpi-value text-green" style="font-size:32px">${formatMoney(agent.balance)}</div>
      <div class="kpi-hint mt-8">Updated ${agent.updated}</div>
    </div>

    <div class="form-group">
      <label class="form-label">Обновить баланс вручную</label>
      <input type="number" class="form-input" id="agent-balance-input" value="${agent.balance}" />
    </div>
    <button type="button" class="btn btn-primary mb-12" onclick="agentUpdateBalance()">Обновить баланс</button>
    <button type="button" class="btn btn-secondary w-full" onclick="toast('Google Sheets sync OK','success')">Синхронизировать Sheets</button>
  `;
}

function agentUpdateBalance() {
  const val = parseFloat($("#agent-balance-input")?.value || "0");
  AGENTS[0].balance = val;
  AGENTS[0].updated = "just now";
  renderAgentBalances();
  toast("Баланс обновлён", "success");
}

// ─── Support Panel ───
function renderSupportHome() {
  const el = $("#page-support-home");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:100px"></div>`;

  Promise.all([Api.supportMyTickets(), Api.supportMyOrders()])
    .then(([tickets, orders]) => {
      state.supportTickets = tickets;
      state.supportOrders = orders;
      const openCount = tickets.filter((t) => t.status !== "closed").length;
      el.innerHTML = `
        <h1 class="page-title">Support Desk</h1>
        <p class="page-sub">Тикеты и заказы закреплённых за вами покупателей</p>

        <div class="kpi-grid">
          <div class="kpi-card agents">
            <div class="kpi-label">Открытых тикетов</div>
            <div class="kpi-value">${openCount}</div>
          </div>
          <div class="kpi-card accounts">
            <div class="kpi-label">Заказы</div>
            <div class="kpi-value">${orders.length}</div>
          </div>
        </div>

        <div class="disclaimer-box">
          <strong>Ограничение доступа</strong>
          Support не имеет доступа к Facebook-токенам аккаунтов пользователей — только к тикетам и заказам.
        </div>

        <div class="admin-grid">
          <div class="admin-tile" onclick="showPage('support-tickets')">
            <div class="icon">🎫</div>
            <h4>Тикеты</h4>
            <p>${openCount} открыто</p>
          </div>
          <div class="admin-tile" onclick="showPage('support-orders')">
            <div class="icon">📦</div>
            <h4>Заказы</h4>
            <p>${orders.length} всего</p>
          </div>
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить: ${e.message}</p>`;
    });
}

function renderSupportTickets() {
  const el = $("#page-support-tickets");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px"></div>`;

  Api.supportMyTickets()
    .then((tickets) => {
      state.supportTickets = tickets;
      el.innerHTML = `
        <h1 class="page-title">Тикеты</h1>
        <p class="page-sub">Только от закреплённых за вами покупателей/агентов</p>
        <div class="ticket-list mt-16">
          ${
            tickets.length
              ? tickets
                  .map(
                    (t) => `
            <div class="ticket-card" onclick="supportOpenTicket(${t.id})">
              <div class="ticket-card-header">
                <span class="order-id">TKT-${t.id}</span>
                <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
              </div>
              <div style="font-weight:600;font-size:13px">${t.subject}</div>
              <div class="order-meta mt-8">
                <span class="badge badge-muted">${t.owner}${t.ownerRole ? " · " + t.ownerRole : ""}</span>
              </div>
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Пока нет тикетов на вас</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить тикеты: ${e.message}</p>`;
    });
}

function supportOpenTicket(id) {
  const t = (state.supportTickets || []).find((x) => x.id === id);
  if (!t) return;
  openSheet(
    `TKT-${t.id} · ${t.owner}`,
    `
    <div class="flex gap-8 mb-12">
      <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
    </div>
    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">${t.subject}</h3>
    <div class="mb-16" style="display:flex;flex-direction:column;gap:8px">
      ${t.messages
        .map(
          (m) => `
        <div style="align-self:${m.sender === "admin" ? "flex-end" : "flex-start"};max-width:85%;padding:8px 12px;border-radius:12px;background:${m.sender === "admin" ? "var(--accent-soft)" : "var(--bg-glass-strong)"}">
          <div class="text-xs text-secondary mb-4">${m.sender === "admin" ? "Вы (поддержка)" : t.owner} · ${new Date(m.createdAt).toLocaleString("ru-RU")}</div>
          <div class="text-sm">${escapeHtml(m.text)}</div>
        </div>
      `
        )
        .join("")}
    </div>
    <div class="form-group">
      <textarea class="form-textarea" id="sup-reply" placeholder="Ответ..."></textarea>
    </div>
    <button type="button" class="btn btn-primary" onclick="supportReply(${t.id})">Ответить</button>
  `
  );
}

async function supportReply(id) {
  const msg = $("#sup-reply")?.value?.trim();
  if (!msg) {
    toast("Введите сообщение", "error");
    return;
  }
  try {
    await Api.supportReplyTicket(id, msg);
    closeSheet();
    renderSupportTickets();
    toast("Ответ отправлен", "success");
  } catch (e) {
    toast(e.message || "Не удалось отправить ответ", "error");
  }
}

function renderSupportOrders() {
  const el = $("#page-support-orders");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px"></div>`;

  Api.supportMyOrders()
    .then((orders) => {
      state.supportOrders = orders;
      el.innerHTML = `
        <h1 class="page-title">Заказы</h1>
        <p class="page-sub">Покупателей, закреплённых за вами — можно менять статус</p>
        <div class="order-list mt-16">
          ${
            orders.length
              ? orders
                  .map(
                    (o) => `
            <div class="order-card">
              <div class="order-card-header">
                <span class="order-id">${o.id}</span>
                <span class="status status-${o.status}">${STATUS_LABELS[o.status] || o.status}</span>
              </div>
              <div class="order-meta mb-8">
                <span>${o.agentName || "—"}</span>
                <span>${o.qty} акк.</span>
              </div>
              <select class="form-select" onchange="supportUpdateOrderStatus('${o.id}', this.value)">
                ${["created", "accepted", "preparing", "ready", "completed", "cancelled"]
                  .map((s) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${STATUS_LABELS[s] || s}</option>`)
                  .join("")}
              </select>
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Нет заказов у закреплённых покупателей</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить заказы: ${e.message}</p>`;
    });
}

async function supportUpdateOrderStatus(orderId, status) {
  try {
    await Api.updateOrderStatus(orderId, status);
    renderSupportOrders();
    toast(`Статус → ${STATUS_LABELS[status] || status}`, "success");
  } catch (e) {
    toast(e.message || "Не удалось обновить статус", "error");
  }
}

// ─── Admin Panel ───
function renderAdminHome() {
  const el = $("#page-admin-home");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:180px;margin-bottom:12px"></div>`;

  Promise.all([Api.adminListUsers(), Api.listTopups(), Api.adminListTickets()])
    .then(([users, topups, tickets]) => {
      state.adminHomeUsers = users;
      const paidCount = users.filter((u) => u.is_paid).length;
      const waitingTopups = topups.filter((t) => t.status === "waiting").length;
      const openTickets = tickets.filter((t) => t.status !== "closed").length;

      el.innerHTML = `
        <h1 class="page-title">Admin</h1>
        <p class="page-sub">Полный доступ к платформе</p>

        <div class="kpi-grid">
          <div class="kpi-card agents"><div class="kpi-label">Users</div><div class="kpi-value">${users.length}</div></div>
          <div class="kpi-card balance"><div class="kpi-label">Оплачено</div><div class="kpi-value">${paidCount}</div></div>
          <div class="kpi-card accounts"><div class="kpi-label">Agents</div><div class="kpi-value">${AGENTS.length}</div></div>
          <div class="kpi-card spend"><div class="kpi-label">Orders</div><div class="kpi-value">${state.orders.length}</div></div>
        </div>

        <div class="admin-grid">
          <div class="admin-tile" onclick="showPage('admin-users')"><div class="icon">👥</div><h4>Пользователи</h4><p>Подписки, роли</p></div>
          <div class="admin-tile" onclick="showPage('admin-agents')"><div class="icon">🏢</div><h4>Агенты</h4><p>${AGENTS.length} партнёров</p></div>
          <div class="admin-tile" onclick="showPage('admin-orders')"><div class="icon">📦</div><h4>Заказы</h4><p>${state.orders.length} всего</p></div>
          <div class="admin-tile" onclick="showPage('admin-topups')"><div class="icon">💰</div><h4>Пополнения</h4><p>${waitingTopups} ожидают</p></div>
          <div class="admin-tile" onclick="showPage('admin-tickets')"><div class="icon">🎫</div><h4>Тикеты</h4><p>${openTickets} открыто</p></div>
          <div class="admin-tile" onclick="showPage('admin-logs')"><div class="icon">📋</div><h4>Логи</h4><p>Аудит</p></div>
          <div class="admin-tile" onclick="showPage('admin-settings')"><div class="icon">⚙️</div><h4>Настройки</h4><p>Саппорт, доступы</p></div>
          <div class="admin-tile" onclick="showPage('admin-health')"><div class="icon">🟢</div><h4>Статусы</h4><p>Health</p></div>
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить сводку: ${e.message}</p>`;
    });
}

function renderAdminUsers() {
  const el = $("#page-admin-users");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Promise.all([Api.adminListUsers(), Api.listAgents(), Api.adminListSupportUsers()])
    .then(([users, agents, supportUsers]) => {
      state.allAgentsForAdmin = agents;
      state.allSupportForAdmin = supportUsers;
      // Новые (role="new") — ещё не выбрали Buyer/Agent сами — всегда наверху,
      // чтобы админ сразу их видел и не путал с уже назначенными юзерами.
      const sorted = [...users].sort((a, b) => (a.role === "new" ? -1 : 0) - (b.role === "new" ? -1 : 0));
      const newCount = users.filter((u) => u.role === "new" && !u.is_admin).length;

      el.innerHTML = `
        <h1 class="page-title">Пользователи</h1>
        <p class="page-sub">
          Центр управления · поиск по нику, оплата, роли, тариф, саппорт
          ${newCount ? `<span class="badge badge-accent" style="margin-left:6px">${newCount} новых</span>` : ""}
        </p>
        <div class="search-box mt-12">
          <span class="icon">⌕</span>
          <input placeholder="Поиск по @нику или ID..." id="user-search" />
        </div>
        <div class="member-list" id="user-list">
          ${sorted.map((u) => userRowHtml(u, agents, supportUsers)).join("")}
        </div>
      `;
      $("#user-search")?.addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase().replace(/^@/, "");
        $$("#user-list .member-row").forEach((row) => {
          row.style.display = row.dataset.search.includes(q) ? "" : "none";
        });
      });
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить пользователей: ${e.message}<br><button class="btn btn-secondary btn-sm mt-8" onclick="renderAdminUsers()">Повторить</button></p>`;
    });
}

const PLAN_LABELS = { solo: "Solo", team: "Team", unlimited: "Unlimited" };

function userRowHtml(u, agents, supportUsers) {
  const name = u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(" ") || `tg:${u.telegram_id}`;
  const linkedAgent = agents.find((a) => a.id === u.managed_agent_id);

  if (u.is_admin) {
    return `
      <div class="member-row" data-search="${(name + " " + u.telegram_id).toLowerCase()}">
        <div class="avatar sm">⚙️</div>
        <div class="member-info">
          <h4>${name} · Admin</h4>
          <p>tg:${u.telegram_id} · полный доступ, бесплатно</p>
        </div>
        <span class="status status-active">Admin</span>
      </div>
    `;
  }

  // Ещё не выбрал роль сам (только что открыл Mini App) — раньше эти юзеры
  // выглядели как обычные Buyer из-за бага с <select>. Теперь — отдельный
  // явный блок с двумя кнопками быстрого назначения.
  if (u.role === "new") {
    return `
      <div class="member-row" style="flex-direction:column;align-items:stretch;gap:8px;border:1px solid var(--accent);border-radius:12px" data-search="${(name + " " + u.telegram_id).toLowerCase()}">
        <div class="flex justify-between items-center">
          <div class="member-info">
            <h4>${name} <span class="badge badge-accent">🆕 Новый</span></h4>
            <p>tg:${u.telegram_id} · роль ещё не назначена</p>
          </div>
        </div>
        <div class="flex gap-8">
          <button type="button" class="btn btn-primary btn-sm" style="flex:1" onclick="adminChangeRole(${u.id}, 'buyer')">Назначить Buyer</button>
          <button type="button" class="btn btn-secondary btn-sm" style="flex:1" onclick="adminChangeRole(${u.id}, 'agent')">Назначить Agent</button>
        </div>
      </div>
    `;
  }

  const roleOptions = ["buyer", "team", "agent", "support"]
    .map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLES[r]?.name || r}</option>`)
    .join("");
  const isBuyerLike = ["buyer", "team"].includes(u.role);
  const assignedSupport = supportUsers.find((s) => s.id === u.assigned_support_id);

  return `
    <div class="member-row" style="flex-direction:column;align-items:stretch;gap:8px" data-search="${(name + " " + u.telegram_id).toLowerCase()}">
      <div class="flex justify-between items-center">
        <div class="member-info">
          <h4>${name}</h4>
          <p>tg:${u.telegram_id}${linkedAgent ? ` · агент: ${linkedAgent.name}` : ""}${u.subscription_plan ? ` · тариф: ${PLAN_LABELS[u.subscription_plan] || u.subscription_plan}` : ""}</p>
        </div>
        <button type="button" class="btn btn-sm ${u.is_paid ? "btn-secondary" : "btn-primary"}" onclick="adminTogglePaid(${u.id}, ${!u.is_paid})">
          ${u.is_paid ? "✓ Оплачено" : "Активировать"}
        </button>
      </div>
      <div class="flex gap-8">
        <select class="form-select" style="flex:1" id="role-select-${u.id}" onchange="adminChangeRole(${u.id}, this.value)">
          ${roleOptions}
        </select>
        ${
          u.role === "agent"
            ? `<select class="form-select" style="flex:1" onchange="adminLinkAgent(${u.id}, this.value)">
                <option value="">— не привязан —</option>
                ${agents.map((a) => `<option value="${a.id}" ${a.id === u.managed_agent_id ? "selected" : ""}>${a.name}</option>`).join("")}
              </select>`
            : ""
        }
      </div>
      ${
        isBuyerLike
          ? `
      <div class="flex gap-8">
        <select class="form-select" style="flex:1" onchange="adminSetPlan(${u.id}, this.value)">
          <option value="">Тариф: не выбран</option>
          <option value="solo" ${u.subscription_plan === "solo" ? "selected" : ""}>Solo</option>
          <option value="team" ${u.subscription_plan === "team" ? "selected" : ""}>Team</option>
          <option value="unlimited" ${u.subscription_plan === "unlimited" ? "selected" : ""}>Unlimited</option>
        </select>
        <select class="form-select" style="flex:1" onchange="adminAssignSupport(${u.id}, this.value)">
          <option value="">Саппорт: не закреплён</option>
          ${supportUsers.map((s) => `<option value="${s.id}" ${s.id === u.assigned_support_id ? "selected" : ""}>${s.username ? "@" + s.username : "tg:" + s.telegram_id}</option>`).join("")}
        </select>
      </div>
      ${assignedSupport ? `<p class="text-xs text-muted">Саппорт: @${assignedSupport.username || assignedSupport.telegram_id}</p>` : ""}
      `
          : ""
      }
      ${
        linkedAgent
          ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openAdminAgentEdit(${linkedAgent.id})">Кошелёк / % / лимиты этого агента</button>`
          : ""
      }
    </div>
  `;
}

function auditActionLabel(action) {
  const labels = {
    agent_create: "Создан агент",
    agent_toggle: "Изменена видимость агента",
    agent_update: "Изменены данные агента",
    subscription_extend: "Продлена подписка",
    user_update: "Изменены права/оплата пользователя",
    topup_confirm: "Подтверждено пополнение (баланс изменён)",
  };
  return labels[action] || action;
}

async function adminTogglePaid(userId, value) {
  try {
    await Api.adminUpdateUser({ user_id: userId, is_paid: value });
    renderAdminUsers();
    toast(value ? "Доступ активирован" : "Доступ отключён", "success");
  } catch (e) {
    toast(e.message || "Не удалось обновить статус оплаты", "error");
  }
}

async function adminChangeRole(userId, role) {
  try {
    await Api.adminUpdateUser({ user_id: userId, role });
    renderAdminUsers();
    toast(`Роль изменена → ${ROLES[role]?.name || role}`, "success");
  } catch (e) {
    toast(e.message || "Не удалось изменить роль", "error");
    renderAdminUsers();
  }
}

async function adminLinkAgent(userId, agentId) {
  try {
    await Api.adminUpdateUser({ user_id: userId, managed_agent_id: agentId ? parseInt(agentId, 10) : 0 });
    renderAdminUsers();
    toast("Агент-профиль привязан", "success");
  } catch (e) {
    toast(e.message || "Не удалось привязать агента", "error");
  }
}

async function adminSetPlan(userId, plan) {
  try {
    await Api.adminUpdateUser({ user_id: userId, subscription_plan: plan });
    renderAdminUsers();
    toast(plan ? `Тариф → ${PLAN_LABELS[plan] || plan}` : "Тариф снят", "success");
  } catch (e) {
    toast(e.message || "Не удалось изменить тариф", "error");
  }
}

async function adminAssignSupport(userId, supportId) {
  try {
    await Api.adminUpdateUser({ user_id: userId, assigned_support_id: supportId ? parseInt(supportId, 10) : 0 });
    renderAdminUsers();
    toast(supportId ? "Саппорт закреплён" : "Саппорт снят", "success");
  } catch (e) {
    toast(e.message || "Не удалось закрепить саппорта", "error");
  }
}

function renderAdminAgents() {
  const el = $("#page-admin-agents");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Api.adminListAgents()
    .then((agents) => {
      el.innerHTML = `
        <h1 class="page-title">Агенты</h1>
        <p class="page-sub">Видимость и % для агентов, доступных байерам</p>
        <button type="button" class="btn btn-secondary mb-16" onclick="openAdminAgentCreate()">+ Добавить агента</button>
        <div class="order-list">
          ${agents
            .map(
              (a) => `
            <div class="card mb-12" style="padding:14px">
              <div class="flex justify-between items-center mb-8">
                <strong>${a.name}</strong>
                <span class="badge ${a.visible ? "badge-green" : "badge-muted"}">${a.visible ? "Виден" : "Скрыт"}</span>
              </div>
              ${a.description ? `<p class="text-xs text-secondary mb-8">${a.description}</p>` : ""}
              <div class="agent-stats mb-12">
                <span>${a.percent}%</span>
                <span>${formatMoney(a.balance)}</span>
                <span>${(a.verticals || []).join(", ") || "—"}</span>
              </div>
              <div class="flex gap-8">
                <button type="button" class="btn btn-secondary btn-sm" onclick="adminToggleAgentVisibility(${a.id})">${a.visible ? "Скрыть" : "Показать"}</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="openAdminAgentEdit(${a.id})">Редактировать</button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить агентов: ${e.message}</p>`;
    });
}

async function adminToggleAgentVisibility(agentId) {
  try {
    await Api.adminToggleAgent(agentId);
    renderAdminAgents();
    toast("Видимость обновлена", "success");
  } catch (e) {
    toast(e.message || "Не удалось обновить агента", "error");
  }
}

const AGENT_VERTICALS = ["Gambling", "Crypto", "Nutra", "White"];

function verticalsCheckboxes(idPrefix, selected) {
  return `
    <div class="flex gap-8" style="flex-wrap:wrap">
      ${AGENT_VERTICALS.map(
        (v) => `
        <label class="tag" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">
          <input type="checkbox" id="${idPrefix}-${v}" ${selected.includes(v) ? "checked" : ""} />
          ${v}
        </label>
      `
      ).join("")}
    </div>
  `;
}

function readCheckedVerticals(idPrefix) {
  return AGENT_VERTICALS.filter((v) => $(`#${idPrefix}-${v}`)?.checked);
}

function openAdminAgentEdit(agentId) {
  Api.adminListAgents().then((agents) => {
    const a = agents.find((x) => x.id === agentId);
    if (!a) return;
    openSheet(
      `Редактировать: ${a.name}`,
      `
      <div class="form-group">
        <label class="form-label">Название</label>
        <input class="form-input" id="ag-name" value="${a.name}" />
      </div>
      <div class="form-group">
        <label class="form-label">Описание</label>
        <textarea class="form-input" id="ag-description" rows="2" placeholder="Краткое описание агента для байеров">${a.description || ""}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Вертикали</label>
        ${verticalsCheckboxes("ag-v", a.verticals || [])}
      </div>
      <div class="form-group">
        <label class="form-label">Процент (%)</label>
        <input type="number" class="form-input" id="ag-percent" value="${a.percent}" />
      </div>
      <div class="form-group">
        <label class="form-label">Кошелёк (TRC20)</label>
        <input class="form-input font-mono" id="ag-wallet" value="${a.wallet || ""}" />
      </div>
      <div class="form-group">
        <label class="form-label">Мин. пополнение</label>
        <input type="number" class="form-input" id="ag-mintopup" value="${a.minTopup}" />
      </div>
      <div class="form-group">
        <label class="form-label">Инструкция</label>
        <textarea class="form-input" id="ag-instruction" rows="3">${a.instruction || ""}</textarea>
      </div>
      <button type="button" class="btn btn-primary" onclick="saveAdminAgentEdit(${a.id})">Сохранить</button>
    `
    );
  });
}

async function saveAdminAgentEdit(agentId) {
  const payload = {
    agent_id: agentId,
    name: $("#ag-name")?.value?.trim(),
    description: $("#ag-description")?.value?.trim(),
    verticals: readCheckedVerticals("ag-v"),
    percent: parseFloat($("#ag-percent")?.value || "0"),
    wallet: $("#ag-wallet")?.value?.trim(),
    min_topup: parseFloat($("#ag-mintopup")?.value || "0"),
    instruction: $("#ag-instruction")?.value?.trim(),
  };
  try {
    await Api.adminUpdateAgent(payload);
    closeSheet();
    renderAdminAgents();
    toast("Агент обновлён", "success");
  } catch (e) {
    toast(e.message || "Не удалось сохранить изменения", "error");
  }
}

function openAdminAgentCreate() {
  openSheet(
    "Новый агент",
    `
    <div class="form-group">
      <label class="form-label">Название</label>
      <input class="form-input" id="ag-new-name" placeholder="Agent #6" />
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="form-input" id="ag-new-description" rows="2" placeholder="Краткое описание агента для байеров"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Вертикали</label>
      ${verticalsCheckboxes("ag-new-v", [])}
    </div>
    <div class="form-group">
      <label class="form-label">Процент (%)</label>
      <input type="number" class="form-input" id="ag-new-percent" value="5" />
    </div>
    <div class="form-group">
      <label class="form-label">Кошелёк (TRC20)</label>
      <input class="form-input font-mono" id="ag-new-wallet" placeholder="T..." />
    </div>
    <div class="form-group">
      <label class="form-label">Мин. пополнение</label>
      <input type="number" class="form-input" id="ag-new-mintopup" value="50" />
    </div>
    <button type="button" class="btn btn-primary" onclick="saveAdminAgentCreate()">Создать</button>
  `
  );
}

async function saveAdminAgentCreate() {
  const name = $("#ag-new-name")?.value?.trim();
  if (!name) {
    toast("Укажите название агента", "error");
    return;
  }
  try {
    await Api.adminCreateAgent({
      name,
      description: $("#ag-new-description")?.value?.trim() || "",
      verticals: readCheckedVerticals("ag-new-v"),
      percent: parseFloat($("#ag-new-percent")?.value || "5"),
      wallet: $("#ag-new-wallet")?.value?.trim() || "",
      min_topup: parseFloat($("#ag-new-mintopup")?.value || "50"),
    });
    closeSheet();
    renderAdminAgents();
    toast("Агент создан", "success");
  } catch (e) {
    toast(e.message || "Не удалось создать агента", "error");
  }
}

function renderAdminOrders() {
  const el = $("#page-admin-orders");
  if (!el) return;

  el.innerHTML = `
    <h1 class="page-title">Все заказы</h1>
    <div class="order-list mt-16">
      ${state.orders
        .map(
          (o) => `
        <div class="order-card">
          <div class="order-card-header">
            <span class="order-id">${o.id}</span>
            <span class="status status-${o.status}">${STATUS_LABELS[o.status]}</span>
          </div>
          <div class="order-meta">
            <span>${o.agentName}</span>
            <span>${o.qty} акк.</span>
            <span>${o.adsPower}</span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderAdminTopups() {
  const el = $("#page-admin-topups");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Api.listTopups()
    .then((topups) => {
      state.adminTopups = topups;
      el.innerHTML = `
        <h1 class="page-title">Пополнения</h1>
        <p class="page-sub">${topups.filter((t) => t.status === "waiting").length} ожидают подтверждения</p>
        <div class="order-list mt-16">
          ${
            topups.length
              ? topups
                  .map(
                    (t) => `
            <div class="card mb-12" style="padding:14px">
              <div class="flex justify-between items-center mb-8">
                <span class="order-id">${t.id}</span>
                <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
              </div>
              <div class="order-meta mb-8">
                <span>${t.agentName || "—"}</span>
                <span>${formatMoney(t.amount)}</span>
                <span>${new Date(t.createdAt).toLocaleString("ru-RU")}</span>
              </div>
              <p class="text-xs text-muted font-mono mb-8" style="word-break:break-all">Hash: ${t.hash || "—"}</p>
              ${
                t.status === "waiting"
                  ? `<div class="flex gap-8">
                      <button type="button" class="btn btn-primary btn-sm" style="flex:1" onclick="adminConfirmTopup('${t.id}')">Подтвердить</button>
                      <button type="button" class="btn btn-secondary btn-sm" style="flex:1" onclick="adminRejectTopup('${t.id}')">Отклонить</button>
                    </div>`
                  : ""
              }
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Пока нет заявок</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить пополнения: ${e.message}</p>`;
    });
}

async function adminConfirmTopup(id) {
  try {
    await Api.updateTopupStatus(id, "confirmed");
    renderAdminTopups();
    toast("Пополнение подтверждено, баланс начислен", "success");
  } catch (e) {
    toast(e.message || "Не удалось подтвердить", "error");
  }
}

async function adminRejectTopup(id) {
  try {
    await Api.updateTopupStatus(id, "updated");
    renderAdminTopups();
    toast("Заявка отклонена", "info");
  } catch (e) {
    toast(e.message || "Не удалось отклонить", "error");
  }
}

function renderAdminHealth() {
  const el = $("#page-admin-health");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px"></div>`;

  Api.health()
    .then((h) => {
      el.innerHTML = `
        <h1 class="page-title">Статусы</h1>
        <p class="page-sub">Диагностика бэкенда в реальном времени</p>
        <div class="card mt-16" style="padding:16px">
          <div class="flex justify-between mb-12"><span class="text-secondary text-sm">API</span><span class="status status-active">🟢 OK</span></div>
          <div class="flex justify-between mb-12"><span class="text-secondary text-sm">База данных</span><span class="text-sm">${h.db_backend}</span></div>
          <div class="flex justify-between mb-12"><span class="text-secondary text-sm">ADMIN_IDS настроено</span><span class="text-sm">${h.admin_ids_configured}</span></div>
          <div class="flex justify-between mb-12"><span class="text-secondary text-sm">BOT_TOKEN настроен</span><span class="text-sm">${h.bot_token_configured ? "✓ да" : "✗ нет"}</span></div>
          <div class="flex justify-between"><span class="text-secondary text-sm">CORS_ORIGINS</span><span class="text-xs font-mono">${(h.cors_origins || []).join(", ")}</span></div>
        </div>
        <p class="text-xs text-muted mt-12">Время сервера: ${new Date(h.time).toLocaleString("ru-RU")}</p>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Бэкенд не отвечает: ${e.message}</p>`;
    });
}

function renderAdminSettings() {
  const el = $("#page-admin-settings");
  if (!el) return;
  el.innerHTML = `
    <h1 class="page-title">Настройки</h1>
    <p class="page-sub">Быстрые административные действия</p>
    <div class="card mb-16" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:8px">Назначить саппорта по нику</h3>
      <p class="text-xs text-secondary mb-12">Пользователь должен хотя бы раз открыть приложение (чтобы завести аккаунт), дальше можно выдать ему роль Support здесь по нику.</p>
      <div class="form-group">
        <input class="form-input" id="settings-support-username" placeholder="@username" />
      </div>
      <button type="button" class="btn btn-primary" onclick="promoteUserToSupport()">Сделать саппортом</button>
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:8px">Прочее</h3>
      <div class="settings-row" onclick="showPage('admin-users')"><span>Управление ролями/оплатой</span><span class="arrow">›</span></div>
      <div class="settings-row" onclick="showPage('admin-health')"><span>Статусы системы</span><span class="arrow">›</span></div>
    </div>
  `;
}

async function promoteUserToSupport() {
  const raw = $("#settings-support-username")?.value?.trim().replace(/^@/, "");
  if (!raw) {
    toast("Введите @username", "error");
    return;
  }
  try {
    const users = await Api.adminListUsers();
    const target = users.find((u) => u.username && u.username.toLowerCase() === raw.toLowerCase());
    if (!target) {
      toast("Такой пользователь ещё не открывал приложение", "error");
      return;
    }
    await Api.adminUpdateUser({ user_id: target.id, role: "support" });
    toast(`@${raw} теперь Support`, "success");
    $("#settings-support-username").value = "";
  } catch (e) {
    toast(e.message || "Не удалось назначить саппорта", "error");
  }
}

function renderAdminTickets() {
  const el = $("#page-admin-tickets");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Api.adminListTickets()
    .then((tickets) => {
      state.adminTickets = tickets;
      el.innerHTML = `
        <h1 class="page-title">Тикеты поддержки</h1>
        <p class="page-sub">Ответ отсюда всегда доходит до пользователя (и в приложение, и в личку)</p>
        <div class="ticket-list mt-12">
          ${
            tickets.length
              ? tickets
                  .map(
                    (t) => `
            <div class="ticket-card" onclick="openAdminTicketDetail(${t.id})">
              <div class="ticket-card-header">
                <span class="order-id">TKT-${t.id}</span>
                <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
              </div>
              <div style="font-weight:600;font-size:13px;margin-bottom:6px">${t.subject}</div>
              <div class="order-meta"><span>${t.owner}</span><span>${t.messages.length} сообщени${t.messages.length === 1 ? "е" : "й"}</span></div>
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Нет тикетов</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить тикеты: ${e.message}</p>`;
    });
}

function openAdminTicketDetail(id) {
  const t = (state.adminTickets || []).find((x) => x.id === id);
  if (!t) return;
  openSheet(
    `TKT-${t.id} · ${t.owner}`,
    `
    <div class="flex gap-8 mb-12">
      <span class="status status-${t.status}">${STATUS_LABELS[t.status] || t.status}</span>
    </div>
    <h3 style="font-size:16px;font-weight:700;margin-bottom:8px">${t.subject}</h3>
    <div class="mb-16" style="display:flex;flex-direction:column;gap:8px">
      ${t.messages
        .map(
          (m) => `
        <div style="align-self:${m.sender === "admin" ? "flex-end" : "flex-start"};max-width:85%;padding:8px 12px;border-radius:12px;background:${m.sender === "admin" ? "var(--accent-soft)" : "var(--bg-glass-strong)"}">
          <div class="text-xs text-secondary mb-4">${m.sender === "admin" ? "Вы (поддержка)" : t.owner} · ${new Date(m.createdAt).toLocaleString("ru-RU")}</div>
          <div class="text-sm">${escapeHtml(m.text)}</div>
        </div>
      `
        )
        .join("")}
    </div>
    <div class="form-group">
      <label class="form-label">Ответить</label>
      <textarea class="form-textarea" id="admin-tkt-reply" placeholder="Ваш ответ..."></textarea>
    </div>
    <button type="button" class="btn btn-primary" onclick="submitAdminTicketReply(${t.id})">Отправить</button>
  `
  );
}

async function submitAdminTicketReply(ticketId) {
  const msg = $("#admin-tkt-reply")?.value?.trim();
  if (!msg) {
    toast("Введите сообщение", "error");
    return;
  }
  try {
    await Api.adminReplyTicket(ticketId, msg);
    closeSheet();
    renderAdminTickets();
    toast("Ответ отправлен", "success");
  } catch (e) {
    toast(e.message || "Не удалось отправить ответ", "error");
  }
}

function renderAdminLogs() {
  const el = $("#page-admin-logs");
  if (!el) return;
  el.innerHTML = `<div class="skeleton-block" style="height:80px;margin-bottom:12px"></div>`;

  Api.adminAuditLog()
    .then((log) => {
      el.innerHTML = `
        <h1 class="page-title">Аудит-лог</h1>
        <p class="page-sub">Все действия с деньгами и правами — кто, кому, сколько, когда</p>
        <div class="order-list mt-16">
          ${
            log.length
              ? log
                  .map(
                    (r) => `
            <div class="card" style="padding:12px">
              <div class="flex justify-between">
                <span class="font-mono text-xs text-muted">${new Date(r.createdAt).toLocaleString("ru-RU")}</span>
                <span class="badge badge-muted">${r.actorRole || "—"}</span>
              </div>
              <p class="text-sm mt-8">${auditActionLabel(r.action)} — actor <span class="font-mono">${r.actor}</span> → ${r.target || "—"}${r.amount != null ? ` · ${r.amount}` : ""}</p>
            </div>
          `
                  )
                  .join("")
              : `<p class="text-secondary text-sm">Пока пусто</p>`
          }
        </div>
      `;
    })
    .catch((e) => {
      el.innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить лог: ${e.message}</p>`;
    });
}

// ─── Notifications ───
function openNotifications() {
  openSheet(
    "Уведомления",
    `
    <div class="notif-list">
      ${state.notifications
        .map(
          (n) => `
        <div class="notif-item ${n.unread ? "unread" : ""}">
          <div class="notif-icon">${n.icon}</div>
          <div class="notif-body">
            <h4>${n.title}</h4>
            <p>${n.text}</p>
            <div class="notif-time">${n.time}</div>
          </div>
        </div>
      `
        )
        .join("")}
    </div>
    <button type="button" class="btn btn-secondary w-full mt-16" onclick="markAllRead()">Прочитать все</button>
  `
  );
}

function markAllRead() {
  state.notifications.forEach((n) => (n.unread = false));
  updateHeader(state.sessionRole || ROLES[state.role]);
  closeSheet();
  toast("Все прочитаны", "info");
}

function openAgentDetail(id) {
  const a = AGENTS.find((x) => x.id === id);
  if (!a) return;
  openSheet(
    a.name,
    `
    <div class="flex gap-8 mb-16">
      <span class="badge badge-accent">${a.percent}%</span>
      <span class="stars">${formatStars(a.rating)}</span>
      ${a.reviewCount ? `<span class="text-secondary text-xs">${a.avgRating} · ${a.reviewCount} отзыв(ов)</span>` : `<span class="text-secondary text-xs">пока нет отзывов</span>`}
    </div>
    ${a.description ? `<p class="text-sm text-secondary mb-12">${a.description}</p>` : ""}
    <div class="tags mb-16">
      ${a.verticals.map((v) => `<span class="tag">${v}</span>`).join("")}
    </div>
    <div class="stat-row">
      <div class="stat-box"><div class="val">${a.accounts}</div><div class="lbl">Заказано</div></div>
      <div class="stat-box"><div class="val">${a.active}</div><div class="lbl">Активных</div></div>
      <div class="stat-box"><div class="val">${formatMoney(a.spend)}</div><div class="lbl">Spend</div></div>
      <div class="stat-box"><div class="val text-green">${formatMoney(a.balance)}</div><div class="lbl">Баланс</div></div>
    </div>
    <p class="text-xs text-muted text-center mt-12">Updated ${a.updated} · Avg. ${a.avgTime}</p>
    <button type="button" class="btn btn-primary mt-16" onclick="closeSheet();openTopupAgent(${a.id})">Пополнить</button>
    <button type="button" class="btn btn-secondary w-full mt-8" onclick="closeSheet();openOrderWizard();setTimeout(()=>{wizard.agentId=${a.id};renderWizard()},100)">Заказать аккаунты</button>
    <button type="button" class="btn btn-secondary w-full mt-8" onclick="openAgentReview(${a.id})">⭐ Оставить отзыв</button>
    <button type="button" class="btn btn-secondary w-full mt-8" onclick="openAgentReviewsList(${a.id})">💬 Смотреть отзывы${a.reviewCount ? ` (${a.reviewCount})` : ""}</button>
  `
  );
}

async function openAgentReviewsList(agentId) {
  const a = AGENTS.find((x) => x.id === agentId);
  openSheet(`Отзывы — ${a ? a.name : ""}`, `<div class="skeleton-block" style="height:60px"></div>`);
  try {
    const reviews = await Api.listReviews(agentId);
    $("#sheet-body").innerHTML = reviews.length
      ? reviews
          .map(
            (r) => `
        <div class="card mb-8" style="padding:12px">
          <div class="flex justify-between mb-4">
            <span class="stars">${formatStars(r.rating)}</span>
            <span class="text-xs text-muted">${new Date(r.createdAt).toLocaleDateString("ru-RU")}</span>
          </div>
          <div class="text-xs text-secondary mb-4">${r.author}</div>
          ${r.comment ? `<div class="text-sm">${escapeHtml(r.comment)}</div>` : ""}
        </div>
      `
          )
          .join("")
      : `<p class="text-secondary text-sm">Пока нет отзывов</p>`;
  } catch (e) {
    $("#sheet-body").innerHTML = `<p class="text-secondary text-sm">Не удалось загрузить отзывы: ${e.message}</p>`;
  }
}

function openAgentReview(agentId) {
  openSheet(
    "Оставить отзыв",
    `
    <div class="form-group">
      <label class="form-label">Оценка</label>
      <div class="flex gap-8" id="review-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="btn btn-secondary btn-sm" data-star="${n}" onclick="setReviewStars(${n})">${n}★</button>`).join("")}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Комментарий</label>
      <textarea class="form-textarea" id="review-comment" placeholder="Как прошла работа с агентом?"></textarea>
    </div>
    <button type="button" class="btn btn-primary" onclick="submitAgentReview(${agentId})">Отправить отзыв</button>
  `
  );
  reviewRating = 5;
}

let reviewRating = 5;
function setReviewStars(n) {
  reviewRating = n;
  toast(`Оценка: ${n}★`, "info");
}

async function submitAgentReview(agentId) {
  const comment = $("#review-comment")?.value?.trim() || "";
  try {
    const updated = await Api.createReview(agentId, { rating: reviewRating, comment });
    const a = AGENTS.find((x) => x.id === agentId);
    if (a) Object.assign(a, updated);
    closeSheet();
    toast("Спасибо за отзыв!", "success");
  } catch (e) {
    toast(e.message || "Не удалось отправить отзыв", "error");
  }
}

// ─── UI helpers ───
function openSheet(title, html) {
  const overlay = $("#overlay");
  const sheet = $("#sheet");
  $("#sheet-title").textContent = title;
  $("#sheet-body").innerHTML = html;
  overlay.classList.add("open");
  sheet.classList.add("open");
  if (typeof tgShowBackButton === "function") tgShowBackButton(true);
  if (typeof tgHaptic === "function") tgHaptic("light");
}

function closeSheet() {
  $("#overlay")?.classList.remove("open");
  $("#sheet")?.classList.remove("open");
  if (typeof tgShowBackButton === "function") tgShowBackButton(false);
}

function openModal(html) {
  const overlay = $("#overlay");
  const modal = $("#modal");
  $("#modal-body").innerHTML = html;
  overlay.classList.add("open");
  modal.classList.add("open");
}

function closeModal() {
  $("#modal")?.classList.remove("open");
  if (!$("#sheet")?.classList.contains("open")) {
    $("#overlay")?.classList.remove("open");
  }
}

function closeAllOverlays() {
  closeSheet();
  closeModal();
}

function showSuccessModal(title, text, onClose) {
  openModal(`
    <div class="text-center">
      <div class="success-check">✓</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">${title}</h2>
      <p class="text-secondary text-sm mb-20">${text}</p>
      <button type="button" class="btn btn-primary" id="success-ok">Готово</button>
    </div>
  `);
  $("#success-ok").onclick = () => {
    closeModal();
    $("#overlay")?.classList.remove("open");
    if (onClose) onClose();
  };
}

function showSubscriptionModal(message) {
  openModal(`
    <div class="text-center">
      <div style="font-size:40px;margin-bottom:8px">🔒</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:8px">Нужна подписка</h2>
      <p class="text-secondary text-sm mb-20">${message || "Оформите подписку, чтобы продолжить."}</p>
      <button type="button" class="btn btn-primary" id="sub-ok">Понятно</button>
    </div>
  `);
  $("#sub-ok").onclick = () => {
    closeModal();
    $("#overlay")?.classList.remove("open");
  };
}

function toast(message, type = "info") {
  const container = $("#toast-container");
  if (!container) return;
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || "ℹ"}</span><span>${message}</span>`;
  container.appendChild(el);
  if (typeof tgHaptic === "function") {
    tgHaptic(type === "success" ? "success" : type === "error" ? "error" : "light");
  }
  // Native Telegram popup as fallback for important messages (optional)
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    el.style.transition = "all 0.3s";
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

function openSupportChat() {
  const user =
    (typeof APP_CONFIG !== "undefined" && APP_CONFIG.supportUsername) ||
    "adverse_support";
  const link = `https://t.me/${user.replace(/^@/, "")}`;
  if (typeof tgOpenTelegramLink === "function" && TG.isTelegram) {
    tgOpenTelegramLink(link);
  } else {
    window.open(link, "_blank");
  }
}

function bindGlobalEvents() {
  $("#btn-login")?.addEventListener("click", () => {
    if (pendingRegistration) completeRegistration();
    else login();
  });
  $("#overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeAllOverlays();
  });
  $("#notif-btn")?.addEventListener("click", openNotifications);
  $("#header-avatar")?.addEventListener("click", () => {
    if (state.role) showPage("more");
  });
}

// Expose for inline handlers
Object.assign(window, {
  showPage,
  login,
  logout,
  openSupportChat,
  openOrderWizard,
  openOrderDetail,
  confirmOrderReceive,
  cancelOrder,
  openTopupAgent,
  submitTopup,
  copyWallet,
  openAccountDetail,
  openAddAccount,
  submitAddAccount,
  attachAccountToken,
  syncAccountFromCard,
  removeAccount,
  openAgentDetail,
  openNotifications,
  markAllRead,
  inviteMember,
  sendInvite,
  requestPlanChange,
  openCreateTicket,
  submitTicket,
  openTicketDetail,
  replyTicket,
  switchRole,
  agentUpdateOrder,
  agentConfirmTopup,
  agentWaitTopup,
  agentUpdateBalance,
  supportOpenTicket,
  supportReply,
  supportUpdateOrderStatus,
  closeSheet,
  closeModal,
  toast,
  renderWizard,
  completeRegistration,
  retryLoad,
  adminToggleAgentVisibility,
  openAdminAgentEdit,
  saveAdminAgentEdit,
  openAdminAgentCreate,
  saveAdminAgentCreate,
  showSubscriptionModal,
  adminTogglePaid,
  adminChangeRole,
  adminLinkAgent,
  adminSetPlan,
  adminAssignSupport,
  openAdminTicketDetail,
  submitAdminTicketReply,
  adminConfirmTopup,
  adminRejectTopup,
  promoteUserToSupport,
  openAgentReview,
  openAgentReviewsList,
  setReviewStars,
  submitAgentReview,
  submitSupportMessage,
});
