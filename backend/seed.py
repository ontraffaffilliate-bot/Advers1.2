"""
Разовый скрипт, чтобы перенести 5 демо-агентов из старого js/data.js в базу,
как стартовый набор для админки (дальше редактируется только через /api/admin/agents/*).

Запуск:
  python3 seed.py
"""

from database import Base, engine, SessionLocal
import models

Base.metadata.create_all(bind=engine)

AGENTS_SEED = [
    dict(name="Agent #1", percent=5, verticals="Gambling,Crypto", rating=5, avg_time="2 часа",
         accounts=123, active=95, spend=142000, balance=5340,
         wallet="TXyz9kL2mNpQ8rStUvWxYz1234567890Ab", min_topup=100,
         instruction="Переведите USDT (TRC20) на указанный кошелёк. Укажите ваш Telegram @username в memo. После оплаты создайте заявку с Hash транзакции."),
    dict(name="Agent #2", percent=7, verticals="Nutra,Dating", rating=4, avg_time="4 часа",
         accounts=87, active=72, spend=98000, balance=2100,
         wallet="TAbc1dEf2gHi3jKl4mNo5pQr6sTu7vWx8yZ", min_topup=50,
         instruction="Оплата только USDT TRC20. Минимум $50. После перевода создайте заявку."),
    dict(name="Agent #3", percent=4, verticals="Gambling,Finance", rating=5, avg_time="1.5 часа",
         accounts=201, active=178, spend=256000, balance=8900,
         wallet="TDef4gHi5jKl6mNo7pQr8sTu9vWx0yZa1bC", min_topup=200,
         instruction="USDT TRC20 only. Укажите Order ID или Telegram в комментарии."),
    dict(name="Agent #4", percent=6, verticals="Crypto,iGaming", rating=4, avg_time="3 часа",
         accounts=56, active=48, spend=67000, balance=1250,
         wallet="TGhi7jKl8mNo9pQr0sTu1vWx2yZa3bCd4eF", min_topup=100,
         instruction="Отправьте USDT TRC20. Создайте заявку с Tx Hash из Tronscan."),
    dict(name="Agent #5", percent=5, verticals="Nutra,E-com", rating=5, avg_time="2.5 часа",
         accounts=34, active=30, spend=41000, balance=780,
         wallet="TJkl0mNo1pQr2sTu3vWx4yZa5bCd6eFg7hI", min_topup=75,
         instruction="TRC20 USDT. После оплаты — заявка с hash и суммой."),
]


def run():
    db = SessionLocal()
    try:
        if db.query(models.Agent).count() > 0:
            print("Агенты уже есть в базе, пропускаю сид.")
            return
        for data in AGENTS_SEED:
            db.add(models.Agent(**data, visible=True))
        db.commit()
        print(f"Добавлено {len(AGENTS_SEED)} агентов.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
