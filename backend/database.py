import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Supabase (Postgres) в проде: задай DATABASE_URL в .env, например
#   DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxxxxxx.supabase.co:5432/postgres
# Локально без DATABASE_URL — падает обратно на файловый SQLite для разработки.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

if DATABASE_URL:
    # Supabase просит sslmode=require; добавляем, если не указано явно.
    if "sslmode" not in DATABASE_URL:
        sep = "&" if "?" in DATABASE_URL else "?"
        DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=10)
else:
    DB_PATH = os.environ.get("DB_PATH", "adverse.db")
    DATABASE_URL = f"sqlite:///{DB_PATH}"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
