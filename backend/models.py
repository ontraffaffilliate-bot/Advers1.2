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

    # ── SaaS access control ──
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
    # message_id Telegram присвоил уведомлению, отправленному админу для этого
    # сообщения — по нему бот находит, на какой тикет админ отвечает.
    admin_msg_id = Column(Integer, nullable=True)

    ticket = relationship("Ticket", back_populates="messages")


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
