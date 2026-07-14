"""
Проверка Telegram WebApp initData по официальной схеме:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Алгоритм:
1. secret_key = HMAC_SHA256("WebAppData", BOT_TOKEN)
2. data_check_string = все поля initData (кроме hash), отсортированные по ключу,
   склеенные как "key=value" через "\n"
3. вычисляем HMAC_SHA256(data_check_string, secret_key) и сравниваем с hash
"""

import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
# Список Telegram ID админов. Пример: ADMIN_IDS="111111,222222"
ADMIN_IDS = {
    x.strip() for x in os.environ.get("ADMIN_IDS", "").split(",") if x.strip()
}
# Насколько "старым" может быть initData (в секундах). Telegram обновляет auth_date
# при каждом открытии мини-аппы.
MAX_AUTH_AGE_SECONDS = int(os.environ.get("MAX_AUTH_AGE_SECONDS", "86400"))

# Для локальной разработки без реального Telegram (НЕ использовать в проде)
DEV_BYPASS = os.environ.get("DEV_BYPASS", "false").lower() == "true"


class InitDataError(Exception):
    pass


def validate_init_data(init_data: str) -> dict:
    """
    Возвращает словарь с данными пользователя, если initData валиден.
    Бросает InitDataError, если нет.
    """
    if DEV_BYPASS:
        # Позволяет тестировать без настоящего Telegram — читает user из query-like строки
        parsed = dict(parse_qsl(init_data))
        user_raw = parsed.get("user")
        user = json.loads(user_raw) if user_raw else {"id": "0", "first_name": "Dev"}
        return user

    if not BOT_TOKEN:
        raise InitDataError("BOT_TOKEN не настроен на сервере")
    if not init_data:
        raise InitDataError("initData отсутствует")

    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise InitDataError("hash отсутствует в initData")

    data_check_arr = [f"{k}={v}" for k, v in sorted(parsed.items())]
    data_check_string = "\n".join(data_check_arr)

    secret_key = hmac.new(
        b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256
    ).digest()
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise InitDataError("Неверная подпись initData (hash mismatch)")

    auth_date = int(parsed.get("auth_date", "0"))
    if MAX_AUTH_AGE_SECONDS and (time.time() - auth_date) > MAX_AUTH_AGE_SECONDS:
        raise InitDataError("initData устарела, откройте приложение заново")

    user_raw = parsed.get("user")
    if not user_raw:
        raise InitDataError("В initData нет данных пользователя")

    return json.loads(user_raw)


def is_admin_id(telegram_id) -> bool:
    return str(telegram_id) in ADMIN_IDS
