const APP_CONFIG = {
  appName: "AdVerse",
  botUsername: "adverscrm_bot",
  miniAppUrl: "https://adverse-crm.vercel.app",
  // ⚠️ Замени на реальный HTTPS-адрес твоего FastAPI бэкенда (см. backend/).
  // Временный туннель (serveo/ngrok) годится только для разработки — для
  // продакшна нужен постоянный хостинг (Railway/Render/Fly/VPS), см. README.
  apiBaseUrl: "https://your-backend-domain.example.com",
  supportUsername: "adverse_support",
  allowRolePickerInTelegram: true,
  autoLoginInTelegram: false,
  defaultRole: "buyer",
};