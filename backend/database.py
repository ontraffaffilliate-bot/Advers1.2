import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Берем DATABASE_URL из переменных окружения Render
DATABASE_URL = os.environ.get("DATABASE_URL")

# Если URL есть (наш случай с Supabase), используем его
if DATABASE_URL:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    # Если URL нет, fallback на локальный SQLite (для теста)
    engine = create_engine("sqlite:///./adverse.db", connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
