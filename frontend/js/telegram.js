/**
 * AdVerse — Telegram Mini App bridge
 * Works inside Telegram WebView; gracefully degrades in regular browser.
 */

const TG = {
  /** @type {TelegramWebApp|null} */
  webApp: null,
  isTelegram: false,
  user: null,
  initData: "",
  startParam: "",
  colorScheme: "dark",
};

/**
 * Initialize Telegram WebApp SDK
 */
function initTelegram() {
  const wa = window.Telegram?.WebApp;
  if (!wa) {
    document.documentElement.classList.add("browser-mode");
    return TG;
  }

  TG.webApp = wa;
  TG.isTelegram = Boolean(wa.initData || wa.platform !== "unknown");
  TG.initData = wa.initData || "";
  TG.startParam = wa.initDataUnsafe?.start_param || "";
  TG.colorScheme = wa.colorScheme || "dark";

  // User from Telegram (only present inside real Mini App)
  if (wa.initDataUnsafe?.user) {
    TG.user = {
      id: wa.initDataUnsafe.user.id,
      firstName: wa.initDataUnsafe.user.first_name || "",
      lastName: wa.initDataUnsafe.user.last_name || "",
      username: wa.initDataUnsafe.user.username || "",
      languageCode: wa.initDataUnsafe.user.language_code || "ru",
      isPremium: Boolean(wa.initDataUnsafe.user.is_premium),
      photoUrl: wa.initDataUnsafe.user.photo_url || null,
    };
  }

  // Signal ready + expand to full height
  try {
    wa.ready();
    wa.expand();

    // Full-screen feel on modern clients
    if (typeof wa.requestFullscreen === "function") {
      // optional — some clients support it
    }

    // Disable vertical swipes that close the app (if available)
    if (typeof wa.disableVerticalSwipes === "function") {
      wa.disableVerticalSwipes();
    }

    applyTelegramTheme(wa);
    setupTelegramChrome(wa);
  } catch (e) {
    console.warn("[AdVerse] Telegram WebApp init warning:", e);
  }

  document.documentElement.classList.add(
    TG.isTelegram ? "telegram-mode" : "browser-mode"
  );
  document.documentElement.setAttribute("data-tg-platform", wa.platform || "unknown");

  return TG;
}

/**
 * Map Telegram theme params to CSS variables
 */
function applyTelegramTheme(wa) {
  const tp = wa.themeParams || {};
  const root = document.documentElement;

  // Prefer our dark SaaS palette; only override if Telegram provides values
  if (tp.bg_color) {
    root.style.setProperty("--tg-bg", tp.bg_color);
  }
  if (tp.secondary_bg_color) {
    root.style.setProperty("--tg-secondary-bg", tp.secondary_bg_color);
  }
  if (tp.text_color) {
    root.style.setProperty("--tg-text", tp.text_color);
  }
  if (tp.hint_color) {
    root.style.setProperty("--tg-hint", tp.hint_color);
  }
  if (tp.button_color) {
    root.style.setProperty("--tg-button", tp.button_color);
  }
  if (tp.button_text_color) {
    root.style.setProperty("--tg-button-text", tp.button_text_color);
  }
  if (tp.link_color) {
    root.style.setProperty("--tg-link", tp.link_color);
  }

  // Header / background colors for native chrome
  try {
    const bg = "#0c0e18";
    const header = "#0c0e18";
    if (typeof wa.setHeaderColor === "function") wa.setHeaderColor(header);
    if (typeof wa.setBackgroundColor === "function") wa.setBackgroundColor(bg);
    if (typeof wa.setBottomBarColor === "function") wa.setBottomBarColor(bg);
  } catch (_) {
    /* older clients */
  }

  // Keep dark class for our design system
  document.body.classList.add("tg-dark");
  if (wa.colorScheme === "light") {
    // We stay dark by design; optional light support later
  }
}

/**
 * MainButton / BackButton helpers
 */
function setupTelegramChrome(wa) {
  if (wa.BackButton) {
    wa.BackButton.hide();
    wa.BackButton.onClick(() => {
      if (typeof window.onTelegramBack === "function") {
        window.onTelegramBack();
      }
    });
  }

  if (wa.MainButton) {
    wa.MainButton.hide();
    wa.MainButton.setParams({
      text: "Продолжить",
      color: "#6c5ce7",
      text_color: "#ffffff",
      is_active: true,
      is_visible: false,
    });
  }

  // Safe area for notched devices
  if (wa.viewportStableHeight) {
    document.documentElement.style.setProperty(
      "--tg-viewport-stable-height",
      wa.viewportStableHeight + "px"
    );
  }

  wa.onEvent?.("viewportChanged", () => {
    if (wa.viewportStableHeight) {
      document.documentElement.style.setProperty(
        "--tg-viewport-stable-height",
        wa.viewportStableHeight + "px"
      );
    }
  });
}

function tgHaptic(type = "light") {
  const h = TG.webApp?.HapticFeedback;
  if (!h) return;
  try {
    if (type === "success") h.notificationOccurred("success");
    else if (type === "error") h.notificationOccurred("error");
    else if (type === "warning") h.notificationOccurred("warning");
    else if (type === "medium") h.impactOccurred("medium");
    else if (type === "heavy") h.impactOccurred("heavy");
    else h.impactOccurred("light");
  } catch (_) {}
}

function tgShowMainButton(text, onClick) {
  const mb = TG.webApp?.MainButton;
  if (!mb) return;
  mb.setText(text);
  mb.show();
  mb.onClick(onClick);
}

function tgHideMainButton() {
  TG.webApp?.MainButton?.hide();
  TG.webApp?.MainButton?.offClick?.();
}

function tgShowBackButton(show = true) {
  if (!TG.webApp?.BackButton) return;
  if (show) TG.webApp.BackButton.show();
  else TG.webApp.BackButton.hide();
}

function tgClose() {
  TG.webApp?.close();
}

function tgOpenLink(url, tryInstantView = false) {
  if (TG.webApp?.openLink) {
    TG.webApp.openLink(url, { try_instant_view: tryInstantView });
  } else {
    window.open(url, "_blank");
  }
}

function tgOpenTelegramLink(url) {
  if (TG.webApp?.openTelegramLink) {
    TG.webApp.openTelegramLink(url);
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Display name from Telegram user or fallback
 */
function getTelegramDisplayName() {
  if (!TG.user) return null;
  const parts = [TG.user.firstName, TG.user.lastName].filter(Boolean);
  return parts.join(" ") || TG.user.username || `User ${TG.user.id}`;
}

function getTelegramAvatarLetters() {
  if (!TG.user) return "TG";
  const f = (TG.user.firstName || "").charAt(0);
  const l = (TG.user.lastName || "").charAt(0);
  if (f || l) return (f + l).toUpperCase() || "TG";
  return (TG.user.username || "TG").slice(0, 2).toUpperCase();
}

/**
 * Role from start_param: e.g. t.me/bot?startapp=role_agent
 */
function getRoleFromStartParam() {
  const p = (TG.startParam || "").toLowerCase();
  if (p.startsWith("role_")) {
    const role = p.replace("role_", "");
    if (["buyer", "team", "agent", "support", "admin"].includes(role)) return role;
  }
  if (["buyer", "team", "agent", "support", "admin"].includes(p)) return p;
  return null;
}

/**
 * For production: send initData to your backend for HMAC validation.
 * Placeholder — wire to your API when ready.
 */
async function validateInitDataOnServer(apiUrl) {
  if (!TG.initData || !apiUrl) {
    return { ok: false, reason: "no_init_data_or_url" };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: TG.initData }),
    });
    if (!res.ok) return { ok: false, reason: "http_" + res.status };
    return await res.json();
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// Auto-init when script loads (after telegram-web-app.js)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initTelegram());
} else {
  initTelegram();
}
