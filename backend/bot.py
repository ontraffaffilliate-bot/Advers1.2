#!/usr/bin/env python3
"""
AdVerse CRM — Telegram bot that opens the Mini App.

Requirements:
  pip install -r requirements.txt

Environment:
  BOT_TOKEN      — from @BotFather
  MINI_APP_URL   — HTTPS URL of the hosted frontend
  BOT_USERNAME   — optional, without @ (for deep links)

Run:
  export BOT_TOKEN="123456:ABC..."
  export MINI_APP_URL="https://your-domain.com"
  export BOT_USERNAME="AdVerseCRM_bot"
  python3 bot.py
"""

from __future__ import annotations

import os
import logging
from datetime import datetime

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    WebAppInfo,
    MenuButtonWebApp,
)
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

# Бот работает в отдельном процессе от FastAPI, но читает/пишет ту же SQLite
# базу через общие models.py/database.py — так тикеты и подписки видны обеим
# сторонам без лишнего API между ними.
from database import SessionLocal, Base, engine
import models
from auth import ADMIN_IDS

Base.metadata.create_all(bind=engine)

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("adverse-bot")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
MINI_APP_URL = os.environ.get("MINI_APP_URL", "").strip().rstrip("/")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "").strip().lstrip("@")
ADMIN_ID_INTS = {int(x) for x in ADMIN_IDS if x.isdigit()}


def open_crm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    text="🚀 Открыть AdVerse CRM",
                    web_app=WebAppInfo(url=MINI_APP_URL),
                )
            ],
        ]
    )


def role_links_text() -> str:
    if not BOT_USERNAME:
        return ""
    return (
        "\n\nБыстрые роли (deep link):\n"
        f"• Buyer: https://t.me/{BOT_USERNAME}?startapp=role_buyer\n"
        f"• Agent: https://t.me/{BOT_USERNAME}?startapp=role_agent\n"
        f"• Admin: https://t.me/{BOT_USERNAME}?startapp=role_admin"
    )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    name = user.first_name if user else "друг"
    text = (
        f"Привет, *{name}*!\n\n"
        "Это *AdVerse* — CRM для медиабайеров и агентов Facebook Ads.\n\n"
        "• Заказы аккаунтов\n"
        "• Пополнения (напрямую агенту)\n"
        "• Аналитика и поддержка\n\n"
        "_Платформа не хранит и не переводит деньги — только подписка CRM._"
        f"{role_links_text()}"
    )
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=open_crm_keyboard(),
        disable_web_page_preview=True,
    )


async def app_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "Откройте CRM внутри Telegram:",
        reply_markup=open_crm_keyboard(),
    )


async def myid_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Helper: prints your numeric Telegram ID so you can put it in the
    backend's ADMIN_IDS env var to unlock the admin panel for yourself."""
    user = update.effective_user
    await update.message.reply_text(
        f"Ваш Telegram ID: `{user.id}`\n\n"
        "Добавьте его в переменную окружения `ADMIN_IDS` на бэкенде, "
        "чтобы получить доступ к админ-панели.",
        parse_mode="Markdown",
    )


async def admin_reply_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Админ отвечает (reply) в личке боту на пересланное сообщение о тикете →
    находим тикет по message_id уведомления, сохраняем ответ в БД и шлём его
    пользователю в личку. Пользователь увидит этот же ответ и в Mini App
    (эндпоинт GET /api/support/tickets).
    """
    msg = update.message
    if not msg or not msg.reply_to_message or not msg.text:
        return

    db = SessionLocal()
    try:
        source = db.query(models.TicketMessage).filter(
            models.TicketMessage.admin_msg_id == msg.reply_to_message.message_id
        ).first()
        if not source:
            return  # not a reply to a ticket notification — ignore

        ticket = db.query(models.Ticket).get(source.ticket_id)
        if not ticket:
            return

        reply = models.TicketMessage(ticket_id=ticket.id, sender="admin", text=msg.text)
        db.add(reply)
        ticket.status = "answered"
        ticket.updated_at = datetime.utcnow()
        db.commit()

        await context.bot.send_message(
            chat_id=ticket.owner_telegram_id,
            text=f"💬 *Ответ поддержки* (тикет #{ticket.id}):\n\n{msg.text}",
            parse_mode="Markdown",
        )
        await msg.reply_text("✅ Ответ отправлен пользователю.")
    finally:
        db.close()


async def check_subscription_expirations(context: ContextTypes.DEFAULT_TYPE) -> None:
    """Runs periodically; DMs users whose subscription just expired."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        expired = (
            db.query(models.User)
            .filter(
                models.User.is_approved == True,  # noqa: E712
                models.User.subscription_end_date.isnot(None),
                models.User.subscription_end_date < now,
                models.User.expiry_notified == False,  # noqa: E712
            )
            .all()
        )
        for u in expired:
            try:
                await context.bot.send_message(
                    chat_id=u.telegram_id,
                    text=(
                        "⏰ Ваша подписка AdVerse истекла.\n"
                        "Доступ к заказам и пополнениям приостановлен до продления. "
                        "Обратитесь к администратору, чтобы продлить доступ."
                    ),
                )
            except Exception as e:
                log.warning("Could not DM user %s: %s", u.telegram_id, e)
            u.expiry_notified = True
        if expired:
            db.commit()
    finally:
        db.close()


async def post_init(app: Application) -> None:
    """Menu button (left of message input) → Mini App."""
    await app.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="AdVerse",
            web_app=WebAppInfo(url=MINI_APP_URL),
        )
    )
    me = await app.bot.get_me()
    log.info("Bot @%s ready | Mini App: %s", me.username, MINI_APP_URL)


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("Set BOT_TOKEN (from @BotFather)")
    if not MINI_APP_URL:
        raise SystemExit("Set MINI_APP_URL (HTTPS URL of Mini App)")
    if not MINI_APP_URL.startswith("https://"):
        raise SystemExit("MINI_APP_URL must start with https://")

    application = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", app_cmd))
    application.add_handler(CommandHandler("crm", app_cmd))
    application.add_handler(CommandHandler("myid", myid_cmd))

    if ADMIN_ID_INTS:
        application.add_handler(
            MessageHandler(
                filters.REPLY & filters.User(user_id=list(ADMIN_ID_INTS)) & filters.TEXT,
                admin_reply_handler,
            )
        )
    else:
        log.warning("ADMIN_IDS не задан — ответы в тикеты поддержки работать не будут.")

    if application.job_queue:
        application.job_queue.run_repeating(check_subscription_expirations, interval=21600, first=60)

    log.info("Starting AdVerse bot…")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
