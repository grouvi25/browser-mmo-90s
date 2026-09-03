# Инструкция запуска

Документ Этапа 5 (G7). Для разработчика, который поднимает проект с нуля —
локально и на сервере. Проверяется буквально: новый человек на чистой машине
по этому тексту доходит до боя. Если где-то пришлось спросить автора — документ
неполон, и это дефект документа, а не человека.

Версия проекта: **1.0.0** (backend и frontend).

---

## 1. Что нужно на машине

| Что | Зачем | Версия |
|---|---|---|
| Node.js | backend и frontend | 20+ (CI гоняет на 24) |
| PostgreSQL | основная база | 14+ |
| Redis | блокировки боёв, очереди, идемпотентность | 6+ |
| npm | зависимости и скрипты | идёт с Node |

Docker не обязателен. Рабочий путь, которым проект поднимается сейчас, —
локальный стенд с портативными PostgreSQL и Redis (в текущей среде это
`D:\work2\devstack`: распакованные сервер БД и Redis плюс скрипты запуска).
Docker — альтернатива для сервера, раздел 4.

---

## 2. Переменные окружения

Три файла, по образцу рядом (`*.env.example`):

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env
```

**backend/.env** — что обязательно поменять:

| Переменная | Значение |
|---|---|
| `DATABASE_URL` | `postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@localhost:5432/mmo90s` |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SECRET` | случайная строка 64 символа (не оставлять из примера) |
| `PORT` | `4000` |
| `CORS_ORIGIN` | адрес фронта, локально `http://localhost:3000` |

**frontend/.env**:

| Переменная | Значение |
|---|---|
| `VITE_API_BASE_URL` | адрес backend, локально `http://localhost:4000` |

На проде `DATABASE_URL` идёт **через PgBouncer**, не напрямую в Postgres —
так настроен пул соединений.

---

## 3. Локальный запуск без Docker

Порядок строгий: база и Redis должны быть подняты до backend.

### 0. PostgreSQL и Redis

Если под рукой нет готового стенда (как devstack на машине, где это писалось —
он личный для той машины и не часть репозитория), самый быстрый путь без
установки чего-либо в систему — те же образы, что использует прод, разово
через `docker run` (Docker для этого не обязательно ставить весь стек, только
движок):

```bash
docker run -d --name mmo90s-postgres -p 5432:5432 -e POSTGRES_USER=mmo90s_user -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=mmo90s postgres:16-alpine
docker run -d --name mmo90s-redis -p 6379:6379 redis:7-alpine
```

Тогда `DATABASE_URL=postgresql://mmo90s_user:devpass@localhost:5432/mmo90s`.

### 1–4. Backend, воркер, фронт

**Важно, и это не очевидно из кода: проект сам `.env` не читает.** `env.ts`
валидирует переменные напрямую из `process.env` — никакого `dotenv` в
зависимостях нет. На проде их подставляет `docker-compose env_file`, в CI они
заданы явно в workflow. Локально без обёртки `npm run dev` упадёт с `❌ Invalid
environment variables: JWT_SECRET Required, DATABASE_URL Required` —
проверено: именно так и происходит при запуске «в лоб». Экспортируйте файл в
шелл перед каждой командой, которая стартует сервер:

```bash
# 0. Поднять PostgreSQL и Redis (см. выше)

# 1. Backend: зависимости, клиент Prisma, схема, индексы, данные
cd backend
npm ci
npm run db:generate                 # prisma generate
npx prisma db push                  # накатить схему на пустую базу
npm run db:raw-indexes              # ОБЯЗАТЕЛЬНО: частичные уникальные индексы,
                                    # которых Prisma не умеет в схеме (см. ниже)
npm run db:seed                     # 13 ресурсов, объекты, рецепты, магазин и пр.

# 2. Backend в dev-режиме — .env нужно явно подставить в шелл
set -a; source .env; set +a         # bash/zsh; в PowerShell — свой цикл по строкам файла
npm run dev                         # API на :4000

# 3. Воркер очередей (в отдельном терминале, тоже с .env в шелле) —
#    циклы производства, фоновые задачи
set -a; source .env; set +a
npm run dev:worker

# 4. Frontend (в отдельном терминале; свой .env читает Vite сам, экспортировать не нужно)
cd ../frontend
npm ci
npm run dev                         # Vite на :3000
```

Открыть `http://localhost:3000`, зарегистрироваться, создать персонажа, зайти в
бой с ботом (раздел «Стрелки», не «бой с тенью» — так эта проверка называлась
здесь раньше, но в самой игре термина «тень» нет) — это и есть проверка
«дошёл до боя». Проверено полностью вживую 04.09.2026, с нуля, на чистом
клоне: путь рабочий, если сделать шаг про `.env` выше.

### Про частичные индексы

Уникальность «одна открытая заявка на район» и подобные ограничения живут в
`backend/prisma/raw-indexes.sql`: Prisma не умеет объявлять частичный уникальный
индекс в схеме. `prisma db push` их **не создаёт**. Поэтому после каждого
`db push` обязателен `npm run db:raw-indexes` — иначе уникальность пропадёт
молча, без ошибки.

---

## 4. Запуск на сервере (Docker)

На проде проект собирается в контейнерах.

```bash
cp .env.example .env
cp backend/.env.example  backend/.env      # заполнить боевыми значениями
cp frontend/.env.example frontend/.env

docker compose up -d          # postgres, redis, pgbouncer, backend, worker, frontend, nginx
make db-migrate               # prisma migrate deploy
make db-seed                  # идемпотентный сид (только upsert по code)
```

Команды `Makefile`: `make dev`, `make build`, `make db-migrate`, `make db-seed`,
`make db-reset` (осторожно — сброс), `make logs`, `make deploy`.

Сид идемпотентен (upsert по `code`), поэтому автозапуск на каждом деплое
безопасен и включён в CD-контур.

---

## 5. Тестовая база — отдельно

Интеграционные тесты и исполняемая приёмка **чистят базу целиком** между
прогонами. Путать их с рабочей базой нельзя: тестовый прогон сотрёт данные.

- Отдельная переменная `TEST_DATABASE_URL` — своя база, не рабочая.
- Разовая подготовка тестовой базы:

```bash
cd backend
npm run test:db:setup     # prisma db push + raw-indexes + seed на тестовой базе
```

- Прогоны:

```bash
npm run test              # unit + integration (нужны Postgres и Redis)
npm run accept:stage4     # исполняемая приёмка Этапа 4 (22 проверки)
npm run accept:stage5     # исполняемая приёмка Этапа 5
```

Приёмка **исполняемая, а не бумажная**: если она красная — чинится код или
вопрос выносится заказчику, но проверка не ослабляется под факт.

---

## 6. Проверки перед коммитом

```bash
# backend
cd backend && npm run typecheck && npm run lint
# frontend
cd frontend && npm run typecheck && npm run lint
```

Внимание: судить об успехе по **коду возврата**, а не по последней строке
вывода — хвост линта бывает пустым, и ошибка выше теряется.

---

## 7. Куда смотреть дальше

- `README.md` — стек и структура каталогов.
- `docs/RELEASE_SYSTEMS.md` — как устроена игра.
- `docs/RELEASE_ADMIN.md` — админка и чего в ней делать нельзя.
- `docs/RELEASE_LIMITATIONS.md` — что сознательно не сделано в первой версии.
- `docs/specs/` — мастер-ТЗ этапов с приложениями.
