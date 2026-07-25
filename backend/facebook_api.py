"""
Минимальный клиент Facebook Marketing API (Graph API) для синхронизации
реальных данных рекламных кабинетов: spend, статус, кол-во кампаний/адсетов/
объявлений. Не требует собственного Facebook-приложения с App Review — токен
доступа (например, System User Token из Business Manager с правом ads_read)
пользователь вставляет вручную при добавлении кабинета.
"""

import httpx

GRAPH_VERSION = "v19.0"
GRAPH_URL = f"https://graph.facebook.com/{GRAPH_VERSION}"


class FacebookAPIError(Exception):
    def __init__(self, message: str, code: int = None):
        super().__init__(message)
        self.message = message
        self.code = code


async def _get(path: str, access_token: str, params: dict = None) -> dict:
    params = {**(params or {}), "access_token": access_token}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{GRAPH_URL}{path}", params=params)
            data = resp.json()
    except Exception as e:
        raise FacebookAPIError(f"Сеть/таймаут: {e}")

    if "error" in data:
        err = data["error"]
        raise FacebookAPIError(err.get("message", "Facebook API error"), err.get("code"))
    return data


async def sync_ad_account(fb_account_id: str, access_token: str) -> dict:
    """
    Возвращает свежие данные по рекламному кабинету. Бросает FacebookAPIError,
    если токен невалиден/нет прав/кабинет не найден — вызывающий код должен
    сохранить это как last_error и не падать целиком.
    """
    act = f"act_{fb_account_id}" if not fb_account_id.startswith("act_") else fb_account_id

    info = await _get(f"/{act}", access_token, {"fields": "name,account_status,currency"})

    async def spend_for(date_preset: str) -> float:
        try:
            res = await _get(f"/{act}/insights", access_token, {"fields": "spend", "date_preset": date_preset})
            rows = res.get("data", [])
            return float(rows[0]["spend"]) if rows else 0.0
        except FacebookAPIError:
            # Пустой период (нет показов) Facebook иногда отдаёт как ошибку
            # с пустым data, а не как 0 — в таком случае просто считаем 0.
            return 0.0

    async def count_for(edge: str) -> int:
        try:
            res = await _get(f"/{act}/{edge}", access_token, {"summary": "total_count", "limit": 1})
            return int(res.get("summary", {}).get("total_count", 0))
        except FacebookAPIError:
            return 0

    spend_today = await spend_for("today")
    spend_week = await spend_for("last_7d")
    spend_month = await spend_for("this_month")
    spend_lifetime = await spend_for("maximum")
    campaigns = await count_for("campaigns")
    adsets = await count_for("adsets")
    ads = await count_for("ads")

    return {
        "name": info.get("name"),
        "account_status": info.get("account_status"),
        "currency": info.get("currency"),
        "spend_today": spend_today,
        "spend_week": spend_week,
        "spend_month": spend_month,
        "spend_lifetime": spend_lifetime,
        "campaigns": campaigns,
        "adsets": adsets,
        "ads": ads,
    }
