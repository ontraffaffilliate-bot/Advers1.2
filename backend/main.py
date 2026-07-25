"""
AdVerse CRM — Backend API (FastAPI + SQLite)

Запуск:
  pip install -r requirements.txt
  export BOT_TOKEN="123456:ABC..."      # тот же токен, что у бота
  export ADMIN_IDS="123456789"           # твой Telegram ID (можно несколько через запятую)
  export CORS_ORIGINS="https://adverse-crm.vercel.app"
  uvicorn main:app --host 0.0.0.0 --port 8000
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import Base, engine, get_db, DATABASE_URL
import models
from auth import validate_init_data, is_admin_id, ADMIN_IDS, InitDataError
from telegram_notify import send_telegram_message
from facebook_api import sync_ad_account, FacebookAPIError

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AdVerse CRM API")

if DATABASE_URL.startswith("postgresql"):
    print(f"✅ [AdVerse] DB backend: Postgres (Supabase) — {DATABASE_URL.split('@')[-1]}")
else:
    print(
        "⚠️  [AdVerse] DB backend: SQLite fallback! "
        "DATABASE_URL is not set — on Render this file is WIPED on every "
        "redeploy/restart. Set DATABASE_URL in Render → Environment to your "
        "Supabase connection string to fix persistence."
    )

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,  # we never send cookies, only a custom header — no need for credentialed CORS
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_ROLES = {"buyer", "agent"}  # самостоятельно регистрируются только эти;
# "team"/"support" назначаются админом вручную через /api/admin/users/update,
# "admin" никогда не выбирается — только по ADMIN_IDS.


# ───────────────────────── helpers ─────────────────────────

async def _resolve_user(tg_user: dict, db: Session) -> models.User:
    """
    Единая точка входа для «найти или создать» пользователя по данным из
    initData. Используется и в /api/auth, и в get_current_user, чтобы логика
    (принудительный admin, актуальный username, уведомление админу) не
    расходилась в двух местах.
    """
    telegram_id = str(tg_user["id"])
    username = tg_user.get("username")
    first_name = tg_user.get("first_name")
    last_name = tg_user.get("last_name")
    forced_admin = is_admin_id(telegram_id)

    user = db.query(models.User).filter(models.User.telegram_id == telegram_id).first()
    is_new = user is None

    if is_new:
        user = models.User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            last_name=last_name,
            role="admin" if forced_admin else "new",
            is_admin=forced_admin,
            is_paid=forced_admin,  # админ всегда в доступе и бесплатно
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Ник в Telegram мог поменяться — обновляем при каждом входе, чтобы
        # в профиле и в админке всегда был реальный @username, а не старый
        # кэш с момента первой регистрации.
        changed = False
        if user.username != username:
            user.username = username
            changed = True
        if user.first_name != first_name:
            user.first_name = first_name
            changed = True
        if user.last_name != last_name:
            user.last_name = last_name
            changed = True
        # ADMIN_IDS — источник истины при каждом заходе: если ID туда
        # добавили/убрали, роль и доступ подтягиваются автоматически.
        if forced_admin and (not user.is_admin or user.role != "admin"):
            user.is_admin = True
            user.role = "admin"
            user.is_paid = True
            changed = True
        elif not forced_admin and user.is_admin:
            user.is_admin = False
            changed = True
        if changed:
            db.commit()

    if is_new and not forced_admin:
        who = f"@{username}" if username else (first_name or telegram_id)
        for admin_tid in sorted(ADMIN_IDS):
            await send_telegram_message(
                admin_tid,
                f"🚨 *Новая заявка*: {who} (ID: `{telegram_id}`)\nОжидает подтверждения оплаты в админ-панели.",
            )

    return user


async def get_current_user(
    x_telegram_init_data: Optional[str] = Header(None), db: Session = Depends(get_db)
) -> models.User:
    """
    Каждый защищённый запрос должен нести заголовок X-Telegram-Init-Data
    с сырой строкой initData из Telegram.WebApp.initData.
    """
    if not x_telegram_init_data:
        raise HTTPException(401, "Нет X-Telegram-Init-Data")
    try:
        tg_user = validate_init_data(x_telegram_init_data)
    except InitDataError as e:
        raise HTTPException(401, str(e))
    return await _resolve_user(tg_user, db)


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.is_admin:
        raise HTTPException(403, "Доступно только администратору")
    return user


def audit(db: Session, actor: models.User, action: str, target: str = "", amount: float = None, meta: dict = None):
    entry = models.AuditLog(
        actor_telegram_id=actor.telegram_id,
        actor_role=actor.role,
        action=action,
        target=target,
        amount=amount,
        meta=json.dumps(meta or {}, ensure_ascii=False),
    )
    db.add(entry)
    db.commit()


def require_paid_access(
    user: models.User = Depends(get_current_user), db: Session = Depends(get_db)
) -> models.User:
    """
    Гейт платного доступа (v2.0): один флаг is_paid, который админ переключает
    в один клик в /api/admin/users/update. Админы/агенты/саппорт не платят —
    это внутренние роли. Buyer/Team без is_paid получают структурированную
    403, которую фронтенд показывает как экран "Ожидание активации".
    """
    if user.is_admin or user.role in ("agent", "support"):
        return user
    if not user.is_paid:
        raise HTTPException(403, detail={"code": "PAYMENT_REQUIRED", "message": "Доступ ещё не активирован администратором. Свяжитесь с поддержкой."})
    return user


def user_out(u: models.User) -> dict:
    return {
        "id": u.id,
        "telegram_id": u.telegram_id,
        "username": u.username,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "role": u.role,
        "is_admin": u.is_admin,
        "is_paid": u.is_paid,
        "managed_agent_id": u.managed_agent_id,
        "subscription_plan": u.subscription_plan,
        "assigned_support_id": u.assigned_support_id,
        "balance": u.balance,
        "is_approved": u.is_approved,
        "subscription_end_date": u.subscription_end_date.isoformat() if u.subscription_end_date else None,
    }


def _agent_stats(db: Session, agent_id: int, owner_id: int = None) -> dict:
    """
    Живая статистика агента. owner_id=None -> агрегат по ВСЕМ покупателям
    (для админа/агента/саппорта). owner_id=<id> -> только связь этого
    конкретного buyer/team с этим агентом (что видит сам buyer).
    Раньше это были статичные числа в Agent.accounts/active/spend/balance,
    которые не имели отношения к конкретному пользователю — отсюда жалоба
    "аналитика агентов одинаковая у всех".
    """
    oq = db.query(models.Order).filter(models.Order.agent_id == agent_id)
    aq = db.query(models.AdAccount).filter(models.AdAccount.agent_id == agent_id)
    tq = db.query(models.Topup).filter(models.Topup.agent_id == agent_id, models.Topup.status == "confirmed")
    if owner_id is not None:
        oq = oq.filter(models.Order.owner_id == owner_id)
        aq = aq.filter(models.AdAccount.owner_id == owner_id)
        tq = tq.filter(models.Topup.owner_id == owner_id)

    orders_count = oq.count()
    active_accounts = aq.filter(models.AdAccount.status == "active").count()
    spend_lifetime = aq.with_entities(func.coalesce(func.sum(models.AdAccount.spend_lifetime), 0.0)).scalar() or 0.0
    balance = tq.with_entities(func.coalesce(func.sum(models.Topup.amount), 0.0)).scalar() or 0.0
    return {"orders": orders_count, "active": active_accounts, "spend": spend_lifetime, "balance": balance}


def agent_out(a: models.Agent, db: Session = None, owner_id: int = None) -> dict:
    avg_rating, review_count = None, 0
    stats = {"orders": 0, "active": 0, "spend": 0, "balance": 0}
    if db is not None:
        row = (
            db.query(func.avg(models.Review.rating), func.count(models.Review.id))
            .filter(models.Review.agent_id == a.id)
            .first()
        )
        if row and row[1]:
            avg_rating, review_count = round(row[0], 1), row[1]
        stats = _agent_stats(db, a.id, owner_id)
    return {
        "id": a.id,
        "name": a.name,
        "percent": a.percent,
        "verticals": [v for v in a.verticals.split(",") if v],
        "rating": round(avg_rating) if avg_rating else a.rating,
        "avgRating": avg_rating,
        "reviewCount": review_count,
        "avgTime": a.avg_time,
        "accounts": stats["orders"],
        "active": stats["active"],
        "spend": stats["spend"],
        "balance": stats["balance"],
        "wallet": a.wallet,
        "minTopup": a.min_topup,
        "instruction": a.instruction,
        "visible": a.visible,
    }


def order_out(o: models.Order) -> dict:
    return {
        "id": o.id,
        "agentId": o.agent_id,
        "agentName": o.agent.name if o.agent else None,
        "qty": o.qty,
        "timezone": o.timezone,
        "pixel": o.pixel,
        "pixelName": o.pixel_name,
        "bm": o.bm,
        "fanPages": o.fan_pages,
        "fanPageCount": o.fan_page_count,
        "fanPageNames": json.loads(o.fan_page_names) if o.fan_page_names else [],
        "adsPower": o.ads_power,
        "comment": o.comment,
        "status": o.status,
        "createdAt": o.created_at.isoformat(),
        "updatedAt": o.updated_at.isoformat(),
    }


def topup_out(t: models.Topup) -> dict:
    return {
        "id": t.id,
        "agentId": t.agent_id,
        "agentName": t.agent.name if t.agent else None,
        "amount": t.amount,
        "hash": t.hash,
        "comment": t.comment,
        "status": t.status,
        "createdAt": t.created_at.isoformat(),
    }


def next_id(db: Session, model, prefix: str, pad_start: int) -> str:
    rows = db.query(model.id).all()
    nums = []
    for (rid,) in rows:
        try:
            nums.append(int(rid.replace(prefix, "")))
        except ValueError:
            pass
    return f"{prefix}{max(nums + [pad_start]) + 1}"


# ───────────────────────── schemas ─────────────────────────

class AuthIn(BaseModel):
    initData: str


class RegisterIn(BaseModel):
    role: str


class AgentToggleIn(BaseModel):
    agent_id: int


class AgentUpdateIn(BaseModel):
    agent_id: int
    name: Optional[str] = None
    percent: Optional[float] = None
    verticals: Optional[List[str]] = None
    wallet: Optional[str] = None
    min_topup: Optional[float] = None
    instruction: Optional[str] = None
    balance: Optional[float] = None


class AgentCreateIn(BaseModel):
    name: str
    percent: float = 5
    verticals: List[str] = []
    wallet: str = ""
    min_topup: float = 50
    instruction: str = ""


class OrderCreateIn(BaseModel):
    agentId: int
    qty: int
    timezone: str
    pixel: bool = False
    pixelName: str = ""
    bm: str = "new"
    fanPages: bool = False
    fanPageCount: int = 0
    fanPageNames: List[str] = []
    adsPower: str = ""
    comment: str = ""


class OrderStatusIn(BaseModel):
    status: str


class TopupCreateIn(BaseModel):
    agentId: int
    amount: float
    hash: str
    comment: str = ""


class TopupStatusIn(BaseModel):
    status: str


class ExtendSubscriptionIn(BaseModel):
    user_id: int
    days: int = 30


class AdminUserUpdateIn(BaseModel):
    user_id: int
    is_paid: Optional[bool] = None
    role: Optional[str] = None  # buyer | team | agent | support (admin is never set here)
    managed_agent_id: Optional[int] = None
    subscription_plan: Optional[str] = None  # solo | team | unlimited
    assigned_support_id: Optional[int] = None


class ReviewIn(BaseModel):
    rating: int
    comment: str = ""
    screenshot_url: Optional[str] = None


class TicketCreateIn(BaseModel):
    subject: str = "Обращение в поддержку"
    message: str


class TicketMessageIn(BaseModel):
    message: str


class AdAccountCreateIn(BaseModel):
    name: str = ""
    agent_id: Optional[int] = None
    fb_account_id: str = ""
    access_token: str = ""


class AdAccountTokenIn(BaseModel):
    fb_account_id: str
    access_token: str


# ───────────────────────── auth / registration ─────────────────────────

@app.post("/api/auth")
async def auth(payload: AuthIn, db: Session = Depends(get_db)):
    try:
        tg_user = validate_init_data(payload.initData)
    except InitDataError as e:
        raise HTTPException(401, str(e))

    user = await _resolve_user(tg_user, db)

    if user.role == "new":
        return {"status": "needs_registration", "user": user_out(user)}
    return {"status": "ok", "role": user.role, "user": user_out(user)}


@app.post("/api/register")
def register(payload: RegisterIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_admin:
        # Админ никогда не проходит обычную регистрацию — роль уже выставлена
        # принудительно в _resolve_user.
        return {"status": "ok", "user": user_out(user)}
    if payload.role not in VALID_ROLES:
        raise HTTPException(400, f"Недопустимая роль. Разрешены: {sorted(VALID_ROLES)}")
    user.role = payload.role
    db.commit()
    return {"status": "ok", "user": user_out(user)}


@app.get("/api/me")
def me(user: models.User = Depends(get_current_user)):
    return user_out(user)


# ───────────────────────── agents ─────────────────────────

@app.get("/api/agents")
def list_agents(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(models.Agent)
    if not user.is_admin:
        q = q.filter(models.Agent.visible == True)  # noqa: E712
    scope = None if (user.is_admin or user.role in ("agent", "support")) else user.id
    return [agent_out(a, db, scope) for a in q.all()]


@app.get("/api/admin/agents")
def admin_list_agents(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    return [agent_out(a, db) for a in db.query(models.Agent).all()]


@app.post("/api/admin/agents/create")
def admin_create_agent(payload: AgentCreateIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    a = models.Agent(
        name=payload.name,
        percent=payload.percent,
        verticals=",".join(payload.verticals),
        wallet=payload.wallet,
        min_topup=payload.min_topup,
        instruction=payload.instruction,
        visible=True,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    audit(db, admin, "agent_create", target=f"agent:{a.id}", meta={"name": a.name})
    return agent_out(a, db)


@app.post("/api/admin/agents/toggle")
def admin_toggle_agent(payload: AgentToggleIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.query(models.Agent).get(payload.agent_id)
    if not a:
        raise HTTPException(404, "Агент не найден")
    a.visible = not a.visible
    db.commit()
    audit(db, admin, "agent_toggle", target=f"agent:{a.id}", meta={"visible": a.visible})
    return agent_out(a, db)


@app.post("/api/admin/agents/update")
def admin_update_agent(payload: AgentUpdateIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    a = db.query(models.Agent).get(payload.agent_id)
    if not a:
        raise HTTPException(404, "Агент не найден")
    if payload.name is not None:
        a.name = payload.name
    if payload.percent is not None:
        a.percent = payload.percent
    if payload.verticals is not None:
        a.verticals = ",".join(payload.verticals)
    if payload.wallet is not None:
        a.wallet = payload.wallet
    if payload.min_topup is not None:
        a.min_topup = payload.min_topup
    if payload.instruction is not None:
        a.instruction = payload.instruction
    if payload.balance is not None:
        a.balance = payload.balance
    a.updated_at = datetime.utcnow()
    db.commit()
    audit(db, admin, "agent_update", target=f"agent:{a.id}", meta=payload.dict(exclude_unset=True))
    return agent_out(a, db)


# ───────────────────────── orders (изоляция по owner_id) ─────────────────────────

@app.get("/api/orders")
def list_orders(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role in ("agent", "support", "admin") or user.is_admin:
        # Агент видит заказы, назначенные ему; саппорт/админ видят всё
        if user.role == "agent":
            agent = db.query(models.Agent).filter(models.Agent.name == user.username).first()
            q = db.query(models.Order)
            orders = q.all()
        else:
            orders = db.query(models.Order).all()
    else:
        orders = db.query(models.Order).filter(models.Order.owner_id == user.id).all()
    return [order_out(o) for o in orders]


@app.post("/api/orders")
async def create_order(payload: OrderCreateIn, user: models.User = Depends(require_paid_access), db: Session = Depends(get_db)):
    if user.role not in ("buyer", "team"):
        raise HTTPException(403, "Заказывать аккаунты может только Buyer/Team")
    agent = db.query(models.Agent).get(payload.agentId)
    if not agent or not agent.visible:
        raise HTTPException(400, "Агент недоступен")

    order_id = next_id(db, models.Order, "ADV-", 20000)
    o = models.Order(
        id=order_id,
        owner_id=user.id,
        agent_id=payload.agentId,
        qty=payload.qty,
        timezone=payload.timezone,
        pixel=payload.pixel,
        pixel_name=payload.pixelName,
        bm=payload.bm,
        fan_pages=payload.fanPages,
        fan_page_count=payload.fanPageCount,
        fan_page_names=json.dumps(payload.fanPageNames),
        ads_power=payload.adsPower,
        comment=payload.comment,
        status="created",
    )
    db.add(o)
    db.commit()
    db.refresh(o)

    who = user.username or user.first_name or user.telegram_id
    recipients = set(ADMIN_IDS)
    if user.assigned_support_id:
        support = db.query(models.User).get(user.assigned_support_id)
        if support:
            recipients.add(support.telegram_id)
    for chat_id in recipients:
        await send_telegram_message(
            chat_id,
            f"🛒 *Новый заказ* {o.id} от @{who}\nАгент: {agent.name} · Кол-во: {o.qty}",
        )
    return order_out(o)


@app.post("/api/orders/{order_id}/status")
def update_order_status(order_id: str, payload: OrderStatusIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    o = db.query(models.Order).get(order_id)
    if not o:
        raise HTTPException(404, "Заказ не найден")
    is_owner = o.owner_id == user.id
    is_privileged = user.is_admin or user.role in ("agent", "support")
    if not (is_owner or is_privileged):
        raise HTTPException(403, "Нет доступа к этому заказу")
    was_fulfilled = o.status in ("ready", "completed")
    o.status = payload.status
    o.updated_at = datetime.utcnow()

    # Агент выдал аккаунты → сразу создаём заготовки в "Моих аккаунтах" байера
    # (имя + привязка к агенту уже проставлены), чтобы не набирать их вручную —
    # остаётся только вставить токен и синхронизировать.
    if payload.status in ("ready", "completed") and not was_fulfilled:
        already = db.query(models.AdAccount).filter(models.AdAccount.order_id == o.id).count()
        if not already:
            agent = db.query(models.Agent).get(o.agent_id) if o.agent_id else None
            agent_name = agent.name if agent else "агент"
            for i in range(max(o.qty, 1)):
                db.add(models.AdAccount(
                    owner_id=o.owner_id,
                    agent_id=o.agent_id,
                    order_id=o.id,
                    name=f"{agent_name} — {o.id} #{i + 1}",
                    status="pending",
                ))
    db.commit()
    return order_out(o)


# ───────────────────────── topups (изоляция по owner_id) ─────────────────────────

@app.get("/api/topups")
def list_topups(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_admin or user.role in ("agent", "support"):
        topups = db.query(models.Topup).all()
    else:
        topups = db.query(models.Topup).filter(models.Topup.owner_id == user.id).all()
    return [topup_out(t) for t in topups]


@app.post("/api/topups")
async def create_topup(payload: TopupCreateIn, user: models.User = Depends(require_paid_access), db: Session = Depends(get_db)):
    if user.role not in ("buyer", "team"):
        raise HTTPException(403, "Пополнять баланс может только Buyer/Team")
    agent = db.query(models.Agent).get(payload.agentId)
    if not agent or not agent.visible:
        raise HTTPException(400, "Агент недоступен")

    topup_id = next_id(db, models.Topup, "TOP-", 8000)
    t = models.Topup(
        id=topup_id,
        owner_id=user.id,
        agent_id=payload.agentId,
        amount=payload.amount,
        hash=payload.hash,
        comment=payload.comment,
        status="waiting",
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    who = user.username or user.first_name or user.telegram_id
    recipients = set(ADMIN_IDS)
    if user.assigned_support_id:
        support = db.query(models.User).get(user.assigned_support_id)
        if support:
            recipients.add(support.telegram_id)
    for chat_id in recipients:
        await send_telegram_message(
            chat_id,
            f"💰 *Новое пополнение* {t.id} от @{who}\nАгент: {agent.name} · Сумма: ${t.amount}",
        )
    return topup_out(t)


@app.post("/api/topups/{topup_id}/status")
def update_topup_status(topup_id: str, payload: TopupStatusIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.query(models.Topup).get(topup_id)
    if not t:
        raise HTTPException(404, "Пополнение не найдено")
    is_privileged = user.is_admin or user.role == "agent"
    if not is_privileged:
        raise HTTPException(403, "Подтверждать пополнения может только агент/админ")
    t.status = payload.status
    if payload.status == "confirmed":
        owner = db.query(models.User).get(t.owner_id)
        if owner:
            owner.balance += t.amount
            audit(db, user, "topup_confirm", target=f"user:{owner.id}", amount=t.amount, meta={"topup_id": t.id})
    db.commit()
    return topup_out(t)


def ad_account_out(a: models.AdAccount, db: Session = None) -> dict:
    agent = None
    if db is not None and a.agent_id:
        agent = db.query(models.Agent).get(a.agent_id)
    return {
        "id": a.id,
        "name": a.name or (f"act_{a.fb_account_id}" if a.fb_account_id else "Без названия"),
        "agentId": a.agent_id,
        "agentName": agent.name if agent else None,
        "orderId": a.order_id,
        "fbAccountId": a.fb_account_id,
        "hasToken": bool(a.access_token),
        "status": a.status,
        "lastError": a.last_error,
        "currency": a.currency,
        "spend": {
            "today": a.spend_today,
            "week": a.spend_week,
            "month": a.spend_month,
            "lifetime": a.spend_lifetime,
        },
        "campaigns": a.campaigns,
        "adsets": a.adsets,
        "ads": a.ads,
        "lastSyncedAt": a.last_synced_at.isoformat() if a.last_synced_at else None,
        "createdAt": a.created_at.isoformat(),
    }


@app.get("/api/accounts")
def list_accounts(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_admin or user.role in ("agent", "support"):
        rows = db.query(models.AdAccount).all()
    else:
        rows = db.query(models.AdAccount).filter(models.AdAccount.owner_id == user.id).all()
    return [ad_account_out(a, db) for a in rows]


@app.post("/api/accounts")
def create_account(payload: AdAccountCreateIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.agent_id:
        agent = db.query(models.Agent).get(payload.agent_id)
        if not agent:
            raise HTTPException(404, "Агент не найден")
    fb_id = payload.fb_account_id.strip().replace("act_", "")
    token = payload.access_token.strip()
    a = models.AdAccount(
        owner_id=user.id,
        agent_id=payload.agent_id,
        name=payload.name.strip(),
        fb_account_id=fb_id or None,
        access_token=token or None,
        status="pending",  # станет active/error после первой синхронизации
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return ad_account_out(a, db)


@app.post("/api/accounts/{account_id}/token")
def set_account_token(account_id: int, payload: AdAccountTokenIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Привязать/обновить токен для уже существующего (в т.ч. авто-созданного при выдаче заказа) кабинета."""
    a = db.query(models.AdAccount).get(account_id)
    if not a:
        raise HTTPException(404, "Кабинет не найден")
    if a.owner_id != user.id and not user.is_admin:
        raise HTTPException(403, "Нет доступа к этому кабинету")
    a.fb_account_id = payload.fb_account_id.strip().replace("act_", "")
    a.access_token = payload.access_token.strip()
    a.status = "pending"
    a.last_error = None
    db.commit()
    return ad_account_out(a, db)


@app.post("/api/accounts/{account_id}/sync")
async def sync_account(account_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.query(models.AdAccount).get(account_id)
    if not a:
        raise HTTPException(404, "Кабинет не найден")
    if a.owner_id != user.id and not (user.is_admin or user.role in ("agent", "support")):
        raise HTTPException(403, "Нет доступа к этому кабинету")
    if not a.fb_account_id or not a.access_token:
        raise HTTPException(400, "Сначала укажите ID кабинета и токен доступа")

    try:
        fresh = await sync_ad_account(a.fb_account_id, a.access_token)
    except FacebookAPIError as e:
        a.status = "error"
        a.last_error = e.message
        a.last_synced_at = datetime.utcnow()
        db.commit()
        raise HTTPException(502, f"Facebook API: {e.message}")

    a.name = fresh["name"] or a.name
    a.currency = fresh["currency"] or a.currency
    a.spend_today = fresh["spend_today"]
    a.spend_week = fresh["spend_week"]
    a.spend_month = fresh["spend_month"]
    a.spend_lifetime = fresh["spend_lifetime"]
    a.campaigns = fresh["campaigns"]
    a.adsets = fresh["adsets"]
    a.ads = fresh["ads"]
    a.status = "active"
    a.last_error = None
    a.last_synced_at = datetime.utcnow()
    db.commit()
    return ad_account_out(a, db)


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.query(models.AdAccount).get(account_id)
    if not a:
        raise HTTPException(404, "Кабинет не найден")
    if a.owner_id != user.id and not user.is_admin:
        raise HTTPException(403, "Нет доступа к этому кабинету")
    db.delete(a)
    db.commit()
    return {"status": "ok"}


@app.get("/api/health")
def health():
    db_backend = "postgres (Supabase)" if DATABASE_URL.startswith("postgresql") else "sqlite (⚠️ EPHEMERAL on Render — data will be lost on redeploy/restart)"
    return {
        "status": "ok",
        "time": datetime.utcnow().isoformat(),
        "db_backend": db_backend,
        "admin_ids_configured": len(ADMIN_IDS),
        "bot_token_configured": bool(os.environ.get("BOT_TOKEN")),
        "cors_origins": CORS_ORIGINS,
    }


# ───────────────────────── admin: users & subscriptions ─────────────────────────

@app.get("/api/admin/users")
def admin_list_users(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    return [user_out(u) for u in db.query(models.User).order_by(models.User.created_at.desc()).all()]


ASSIGNABLE_ROLES = {"buyer", "team", "agent", "support"}  # admin никогда не назначается вручную


@app.post("/api/admin/users/update")
def admin_update_user(payload: AdminUserUpdateIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.query(models.User).get(payload.user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if target.is_admin:
        raise HTTPException(400, "Нельзя менять роль/доступ другого администратора")

    changes = {}
    if payload.is_paid is not None:
        target.is_paid = payload.is_paid
        changes["is_paid"] = payload.is_paid
    if payload.role is not None:
        if payload.role not in ASSIGNABLE_ROLES:
            raise HTTPException(400, f"Недопустимая роль. Разрешены: {sorted(ASSIGNABLE_ROLES)}")
        target.role = payload.role
        changes["role"] = payload.role
    if payload.managed_agent_id is not None:
        agent = db.query(models.Agent).get(payload.managed_agent_id) if payload.managed_agent_id else None
        if payload.managed_agent_id and not agent:
            raise HTTPException(404, "Агент не найден")
        target.managed_agent_id = payload.managed_agent_id or None
        changes["managed_agent_id"] = payload.managed_agent_id
    if payload.subscription_plan is not None:
        if payload.subscription_plan not in ("solo", "team", "unlimited", ""):
            raise HTTPException(400, "Недопустимый тариф. Разрешены: solo, team, unlimited")
        target.subscription_plan = payload.subscription_plan or None
        changes["subscription_plan"] = payload.subscription_plan
    if payload.assigned_support_id is not None:
        support = db.query(models.User).get(payload.assigned_support_id) if payload.assigned_support_id else None
        if payload.assigned_support_id and (not support or support.role != "support"):
            raise HTTPException(400, "Этот пользователь не имеет роли Support")
        target.assigned_support_id = payload.assigned_support_id or None
        changes["assigned_support_id"] = payload.assigned_support_id

    db.commit()
    if changes:
        audit(db, admin, "user_update", target=f"user:{target.id}", meta=changes)
    return user_out(target)


@app.post("/api/admin/users/extend")
def admin_extend_subscription(payload: ExtendSubscriptionIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.query(models.User).get(payload.user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    base = target.subscription_end_date if (target.subscription_end_date and target.subscription_end_date > datetime.utcnow()) else datetime.utcnow()
    target.subscription_end_date = base + timedelta(days=payload.days)
    target.is_approved = True
    target.expiry_notified = False
    db.commit()
    audit(db, admin, "subscription_extend", target=f"user:{target.id}", amount=payload.days,
          meta={"new_end_date": target.subscription_end_date.isoformat()})
    return user_out(target)


class AdminTicketReplyIn(BaseModel):
    message: str


@app.get("/api/admin/tickets")
def admin_list_tickets(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    tickets = db.query(models.Ticket).order_by(models.Ticket.updated_at.desc()).all()
    out = []
    for t in tickets:
        owner = db.query(models.User).get(t.owner_id)
        out.append({
            "id": t.id,
            "subject": t.subject,
            "status": t.status,
            "owner": f"@{owner.username}" if owner and owner.username else f"tg:{t.owner_telegram_id}",
            "ownerTelegramId": t.owner_telegram_id,
            "createdAt": t.created_at.isoformat(),
            "updatedAt": t.updated_at.isoformat(),
            "messages": [
                {"sender": m.sender, "text": m.text, "createdAt": m.created_at.isoformat()}
                for m in t.messages
            ],
        })
    return out


@app.post("/api/admin/tickets/{ticket_id}/reply")
async def admin_reply_ticket(ticket_id: int, payload: AdminTicketReplyIn, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    """
    Надёжный канал ответа: работает всегда, даже если процесс bot.py не
    запущен или отвал парсинг reply-сообщений в Telegram. Ответ сразу
    сохраняется в БД (виден в приложении) и дублируется пользователю в
    личку ботом.
    """
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Тикет не найден")
    msg = models.TicketMessage(ticket_id=ticket.id, sender="admin", text=payload.message)
    ticket.status = "answered"
    ticket.updated_at = datetime.utcnow()
    db.add(msg)
    db.commit()

    owner = db.query(models.User).get(ticket.owner_id)
    if owner:
        await send_telegram_message(
            owner.telegram_id,
            f"💬 *Ответ поддержки* (тикет #{ticket.id}):\n\n{payload.message}",
        )
    return {"status": "ok"}


@app.get("/api/admin/support-users")
def admin_list_support_users(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    """Список пользователей с ролью Support — для выпадающего списка 'закрепить саппорта за байером'."""
    rows = db.query(models.User).filter(models.User.role == "support").all()
    return [user_out(u) for u in rows]


@app.get("/api/admin/audit-log")
def admin_audit_log(admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc()).limit(200).all()
    return [
        {
            "id": r.id,
            "actor": r.actor_telegram_id,
            "actorRole": r.actor_role,
            "action": r.action,
            "target": r.target,
            "amount": r.amount,
            "meta": json.loads(r.meta) if r.meta else {},
            "createdAt": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ───────────────────────── agent reviews / rating ─────────────────────────

@app.get("/api/agents/{agent_id}/reviews")
def list_reviews(agent_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(models.Review)
        .filter(models.Review.agent_id == agent_id)
        .order_by(models.Review.created_at.desc())
        .all()
    )
    out = []
    for r in rows:
        author = db.query(models.User).get(r.user_id)
        out.append({
            "rating": r.rating,
            "comment": r.comment,
            "author": f"@{author.username}" if author and author.username else "Аноним",
            "createdAt": r.created_at.isoformat(),
        })
    return out


@app.post("/api/agents/{agent_id}/review")
def create_review(agent_id: int, payload: ReviewIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not (1 <= payload.rating <= 5):
        raise HTTPException(400, "Рейтинг должен быть от 1 до 5")
    agent = db.query(models.Agent).get(agent_id)
    if not agent:
        raise HTTPException(404, "Агент не найден")
    r = models.Review(
        agent_id=agent_id, user_id=user.id, rating=payload.rating,
        comment=payload.comment, screenshot_url=payload.screenshot_url,
    )
    db.add(r)
    db.commit()
    return agent_out(agent, db)


# ───────────────────────── support tickets (forwarded to admin's DM) ─────────────────────────

@app.get("/api/support/tickets")
def list_tickets(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    tickets = db.query(models.Ticket).filter(models.Ticket.owner_id == user.id).order_by(models.Ticket.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "subject": t.subject,
            "status": t.status,
            "createdAt": t.created_at.isoformat(),
            "updatedAt": t.updated_at.isoformat(),
            "messages": [
                {"sender": m.sender, "text": m.text, "createdAt": m.created_at.isoformat()}
                for m in t.messages
            ],
        }
        for t in tickets
    ]


async def _notify_ticket_recipients(db: Session, ticket: models.Ticket, text: str):
    """Send the Telegram DM to the admin(s) and the assigned support (if any), recording each (chat_id, message_id) so a reply from ANY of them can be matched back to this ticket."""
    owner = db.query(models.User).get(ticket.owner_id)
    recipients = set(ADMIN_IDS)
    if owner and owner.assigned_support_id:
        support = db.query(models.User).get(owner.assigned_support_id)
        if support:
            recipients.add(support.telegram_id)
    for chat_id in recipients:
        sent = await send_telegram_message(chat_id, text)
        if sent:
            db.add(models.TicketNotification(ticket_id=ticket.id, chat_id=chat_id, message_id=sent["message_id"]))
    db.commit()


@app.post("/api/support/tickets")
async def create_ticket(payload: TicketCreateIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = models.Ticket(owner_id=user.id, owner_telegram_id=user.telegram_id, subject=payload.subject)
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    who = user.username or user.first_name or user.telegram_id
    msg = models.TicketMessage(ticket_id=ticket.id, sender="user", text=payload.message)
    db.add(msg)
    db.commit()

    await _notify_ticket_recipients(
        db, ticket,
        f"🎫 *Новый тикет #{ticket.id}* от @{who} (id `{user.telegram_id}`)\n"
        f"_{payload.subject}_\n\n{payload.message}\n\n"
        f"↩️ Ответьте на это сообщение, чтобы ответ ушёл пользователю в приложение и в личку.",
    )
    return {"id": ticket.id, "status": ticket.status}


@app.post("/api/support/tickets/{ticket_id}/messages")
async def add_ticket_message(ticket_id: int, payload: TicketMessageIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket or ticket.owner_id != user.id:
        raise HTTPException(404, "Тикет не найден")

    who = user.username or user.first_name or user.telegram_id
    msg = models.TicketMessage(ticket_id=ticket.id, sender="user", text=payload.message)
    ticket.status = "open"
    ticket.updated_at = datetime.utcnow()
    db.add(msg)
    db.commit()

    await _notify_ticket_recipients(
        db, ticket,
        f"🎫 *Тикет #{ticket.id}* — новое сообщение от @{who}:\n\n{payload.message}\n\n"
        f"↩️ Ответьте на это сообщение, чтобы ответ ушёл пользователю.",
    )
    return {"status": "ok"}
