-- AdVerse CRM — миграция существующей Supabase-базы под текущую схему.
--
-- ПОЧЕМУ ЭТО НУЖНО:
-- SQLAlchemy's Base.metadata.create_all() создаёт только ОТСУТСТВУЮЩИЕ
-- таблицы. Если таблица уже существует (как у тебя — ты подключил
-- DATABASE_URL раньше и данные уже писались), новые колонки, добавленные
-- в models.py позже, в реальной таблице Postgres НЕ появляются сами.
-- Из-за этого ЛЮБОЙ запрос, трогающий User/Order/AdAccount (а это
-- буквально каждый вход в приложение — get_current_user дергается на
-- каждый запрос), падает с ошибкой "column does not exist" на уровне
-- базы. Фронтенд эту ошибку показывает как "Нет соединения с сервером" —
-- хотя сервер работает, просто каждый запрос к нему падает на первом же
-- обращении к базе.
--
-- КАК ПРИМЕНИТЬ:
-- Supabase → твой проект → SQL Editor → New query → вставь весь файл
-- целиком → Run. Скрипт полностью безопасен: ADD COLUMN IF NOT EXISTS
-- ничего не сломает и не удалит, если колонка уже есть — просто пропустит.
-- Можно гонять этот скрипт повторно сколько угодно раз.

-- ── users ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_paid boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS managed_agent_id integer REFERENCES agents(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan varchar;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_support_id integer REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end_date timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS expiry_notified boolean DEFAULT false;

-- ── agents ──
ALTER TABLE agents ADD COLUMN IF NOT EXISTS description text DEFAULT '';

-- ── orders ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pixel_names text DEFAULT '';
-- старая колонка pixel_name (если создавалась раньше) больше не используется
-- кодом, но оставляем её в базе как есть — трогать/удалять не обязательно.

-- ── ad_accounts (может не существовать вовсе, если ты подключился уже
--    после того, как эта таблица появилась в коде — тогда все ALTER ниже
--    просто ничего не найдут и завершатся без ошибок благодаря IF EXISTS
--    на уровне самой таблицы) ──
ALTER TABLE IF EXISTS ad_accounts ADD COLUMN IF NOT EXISTS agent_id integer REFERENCES agents(id);
ALTER TABLE IF EXISTS ad_accounts ADD COLUMN IF NOT EXISTS order_id varchar REFERENCES orders(id);
ALTER TABLE IF EXISTS ad_accounts ALTER COLUMN fb_account_id DROP NOT NULL;
ALTER TABLE IF EXISTS ad_accounts ALTER COLUMN access_token DROP NOT NULL;

-- ── ticket_messages / ticket_notifications ──
-- ticket_notifications — новая таблица, create_all() создаст её сама при
-- следующем старте бэкенда (это как раз тот случай, когда create_all
-- справляется без миграции — таблицы целиком, а не колонки). Ничего
-- руками создавать не нужно.

-- Готово. После применения — просто зайди в приложение ещё раз, ничего
-- больше перезапускать не нужно (Render уже поднят на новом коде).
