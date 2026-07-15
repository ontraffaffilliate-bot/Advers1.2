"""
AdVerse CRM — Backend API (FastAPI + SQLite)

Запуск:
  pip install -r requirements.txt
  export BOT_TOKEN="123456:ABC..."      # тот же токен, что у бота
  export ADMIN_IDS="565099645"           # твой Telegram ID (можно несколько через запятую)
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

from database import Base, engine, get_db
import models
from auth import validate_init_data, is_admin_id, ADMIN_IDS, InitDataError
from telegram_notify import send_telegram_message

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AdVerse CRM API")

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
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
        "balance": u.balance,
        "is_approved": u.is_approved,
        "subscription_end_date": u.subscription_end_date.isoformat() if u.subscription_end_date else None,
    }


def agent_out(a: models.Agent, db: Session = None) -> dict:
    avg_rating, review_count = None, 0
    if db is not None:
        row = (
            db.query(func.avg(models.Review.rating), func.count(models.Review.id))
            .filter(models.Review.agent_id == a.id)
            .first()
        )
        if row and row[1]:
            avg_rating, review_count = round(row[0], 1), row[1]
    return {
        "id": a.id,
        "name": a.name,
        "percent": a.percent,
        "verticals": [v for v in a.verticals.split(",") if v],
        "rating": round(avg_rating) if avg_rating else a.rating,
        "avgRating": avg_rating,
        "reviewCount": review_count,
        "avgTime": a.avg_time,
        "accounts": a.accounts,
        "active": a.active,
        "spend": a.spend,
        "balance": a.balance,
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


class ReviewIn(BaseModel):
    rating: int
    comment: str = ""
    screenshot_url: Optional[str] = None


class TicketCreateIn(BaseModel):
    subject: str = "Обращение в поддержку"
    message: str


class TicketMessageIn(BaseModel):
    message: str


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
    return [agent_out(a, db) for a in q.all()]


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
def create_order(payload: OrderCreateIn, user: models.User = Depends(require_paid_access), db: Session = Depends(get_db)):
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
    o.status = payload.status
    o.updated_at = datetime.utcnow()
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
def create_topup(payload: TopupCreateIn, user: models.User = Depends(require_paid_access), db: Session = Depends(get_db)):
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


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


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


@app.post("/api/support/tickets")
async def create_ticket(payload: TicketCreateIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = models.Ticket(owner_id=user.id, owner_telegram_id=user.telegram_id, subject=payload.subject)
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    who = user.username or user.first_name or user.telegram_id
    admin_msg = None
    if ADMIN_IDS:
        primary_admin = sorted(ADMIN_IDS)[0]
        admin_msg = await send_telegram_message(
            primary_admin,
            f"🎫 *Новый тикет #{ticket.id}* от @{who} (id `{user.telegram_id}`)\n"
            f"_{payload.subject}_\n\n{payload.message}\n\n"
            f"↩️ Ответьте на это сообщение, чтобы ответ ушёл пользователю в приложение и в личку.",
        )

    msg = models.TicketMessage(
        ticket_id=ticket.id, sender="user", text=payload.message,
        admin_msg_id=admin_msg["message_id"] if admin_msg else None,
    )
    db.add(msg)
    db.commit()
    return {"id": ticket.id, "status": ticket.status}


@app.post("/api/support/tickets/{ticket_id}/messages")
async def add_ticket_message(ticket_id: int, payload: TicketMessageIn, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket or ticket.owner_id != user.id:
        raise HTTPException(404, "Тикет не найден")

    who = user.username or user.first_name or user.telegram_id
    admin_msg = None
    if ADMIN_IDS:
        primary_admin = sorted(ADMIN_IDS)[0]
        admin_msg = await send_telegram_message(
            primary_admin,
            f"🎫 *Тикет #{ticket.id}* — новое сообщение от @{who}:\n\n{payload.message}",
        )

    msg = models.TicketMessage(
        ticket_id=ticket.id, sender="user", text=payload.message,
        admin_msg_id=admin_msg["message_id"] if admin_msg else None,
    )
    ticket.status = "open"
    ticket.updated_at = datetime.utcnow()
    db.add(msg)
    db.commit()
    return {"status": "ok"}
