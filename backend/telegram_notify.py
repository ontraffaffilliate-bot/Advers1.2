"""
Прямой вызов Telegram Bot API из бэкенда (без общего процесса с bot.py).
Используется, чтобы переслать сообщение из тикета поддержки админу в личку
и получить обратно message_id — по нему bot.py потом сопоставит ответ админа
(reply) с нужным тикетом.
"""

import os
import httpx

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"


async def send_telegram_message(chat_id: str, text: str, reply_to_message_id: int = None) -> dict | None:
    if not BOT_TOKEN:
        return None
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if reply_to_message_id:
        payload["reply_to_message_id"] = reply_to_message_id
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{API_URL}/sendMessage", json=payload)
            data = resp.json()
            if data.get("ok"):
                return data["result"]
    except Exception:
        pass
    return None
