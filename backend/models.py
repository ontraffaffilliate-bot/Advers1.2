from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, Float, DateTime, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    role = Column(String, default="new")  # new | buyer | team | agent | support | admin
    is_admin = Column(Boolean, default=False)
    balance = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    # ── v2.0: единый флаг платного доступа. Админ переключает его в один
    # клик в /api/admin/users/update. Пока is_paid=False, тарифы закрыты и
    # юзер видит "Ожидание активации". Админ (is_admin=True) всегда в доступе.
    is_paid = Column(Boolean, default=False)

    # Если роль = agent, эта колонка указывает, каким Agent-профилем
    # (кошелёк/%/лимиты) управляет этот Telegram-аккаунт. Назначается
    # админом при выдаче роли Агент/Саппорт конкретному человеку.
    managed_agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)

    # Тариф, который админ выдал этому buyer/team (см. PLANS на фронте):
    # "solo" | "team" | "unlimited" | None (ещё не назначен).
    subscription_plan = Column(String, nullable=True)

    # Саппорт, закреплённый персонально за этим buyer/team — все его тикеты
    # уходят в личку именно этому саппорту (плюс копия админу).
    assigned_support_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Оставлено для обратной совместимости с первой версией подписки
    # (сейчас не используется как гейт — см. is_paid выше).
    is_approved = Column(Boolean, default=False)
    subscription_end_date = Column(DateTime, nullable=True)
    expiry_notified = Column(Boolean, default=False)

    orders = relationship("Order", back_populates="owner")
    topups = relationship("Topup", back_populates="owner")


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    percent = Column(Float, default=5)
    verticals = Column(String, default="")  # comma-separated
    rating = Column(Integer, default=5)
    avg_time = Column(String, default="")
    accounts = Column(Integer, default=0)
    active = Column(Integer, default=0)
    spend = Column(Float, default=0)
    balance = Column(Float, default=0)
    wallet = Column(String, default="")
    min_topup = Column(Float, default=50)
    instruction = Column(Text, default="")
    visible = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Order(Base):
    __tablename__ = "orders"

    id = Column(String, primary_key=True, index=True)  # e.g. ADV-20391
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    qty = Column(Integer, default=1)
    timezone = Column(String, default="UTC+0")
    pixel = Column(Boolean, default=False)
    pixel_name = Column(String, default="")
    bm = Column(String, default="new")
    fan_pages = Column(Boolean, default=False)
    fan_page_count = Column(Integer, default=0)
    fan_page_names = Column(Text, default="")  # JSON-encoded list
    ads_power = Column(String, default="")
    comment = Column(Text, default="")
    status = Column(String, default="created")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="orders")
    agent = relationship("Agent")


class Topup(Base):
    __tablename__ = "topups"

    id = Column(String, primary_key=True, index=True)  # e.g. TOP-9012
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)
    amount = Column(Float, default=0)
    hash = Column(String, default="")
    comment = Column(Text, default="")
    status = Column(String, default="waiting")  # waiting | confirmed | updated
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="topups")
    agent = relationship("Agent")


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)  # 1..5
    comment = Column(Text, default="")
    screenshot_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    owner_telegram_id = Column(String, nullable=False)  # denormalized for the bot
    subject = Column(String, default="Обращение в поддержку")
    status = Column(String, default="open")  # open | answered | closed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship("TicketMessage", back_populates="ticket", order_by="TicketMessage.id")


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    sender = Column(String, nullable=False)  # "user" | "admin"
    text = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    ticket = relationship("Ticket", back_populates="messages")


class TicketNotification(Base):
    """
    Каждое уведомление о тикете, отправленное в чей-то личный чат в Telegram
    (админу и/или закреплённому саппорту). message_id уникален только внутри
    ОДНОГО чата, поэтому храним пару (chat_id, message_id) — так бот может
    правильно сопоставить reply от любого из получателей с нужным тикетом,
    даже если у ticket несколько адресатов уведомлений.
    """
    __tablename__ = "ticket_notifications"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    chat_id = Column(String, nullable=False)
    message_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    actor_telegram_id = Column(String, nullable=False)
    actor_role = Column(String, default="")
    action = Column(String, nullable=False)  # e.g. "topup_confirm", "agent_update", "subscription_extend"
    target = Column(String, default="")  # e.g. "user:12", "agent:3", "topup:TOP-9012"
    amount = Column(Float, nullable=True)
    meta = Column(Text, default="")  # JSON-encoded extra details
    created_at = Column(DateTime, default=datetime.utcnow)


class AdAccount(Base):
    """
    Реальный рекламный кабинет, подключённый через Facebook Marketing API.
    Раньше вся страница "Аккаунты" была захардкоженным моком (ACCOUNTS в
    data.js) с фейковыми цифрами spend/balance, которые никогда не менялись —
    отсюда и "зависшие балансы". Теперь это настоящие данные из БД,
    синхронизируемые через /api/accounts/{id}/sync (см. facebook_api.py).
    Новый кабинет стартует с нулевыми значениями, пока его не синхронизируют.
    """
    __tablename__ = "ad_accounts"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=True)  # какой агент выдал этот кабинет
    order_id = Column(String, ForeignKey("orders.id"), nullable=True)  # из какого заказа он появился (если авто-создан)
    name = Column(String, default="")
    fb_account_id = Column(String, nullable=True)  # без "act_" префикса; пусто = токен ещё не привязан
    access_token = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending | active | error | disabled
    last_error = Column(Text, nullable=True)
    currency = Column(String, default="USD")

    spend_today = Column(Float, default=0)
    spend_week = Column(Float, default=0)
    spend_month = Column(Float, default=0)
    spend_lifetime = Column(Float, default=0)
    campaigns = Column(Integer, default=0)
    adsets = Column(Integer, default=0)
    ads = Column(Integer, default=0)

    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
