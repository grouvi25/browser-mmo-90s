# 🏙️ Browser MMO 90s

Браузерная MMO-RPG / экономическая стратегия в тематике России 90-х.

## Стек

| Слой | Технология |
|------|-----------|
| Backend | Node.js + TypeScript + Fastify |
| Frontend | React + TypeScript + Vite |
| Database | PostgreSQL + Prisma |
| Realtime | Redis + BullMQ + Socket.io |
| Deploy | Docker Compose + Nginx + VPS |

## Структура проекта

```
project-root/
├─ backend/        # Fastify API + бизнес-логика
├─ frontend/       # React приложение
├─ infra/          # Nginx, Docker, deploy скрипты
├─ docs/           # ТЗ, схемы, API-контракты
├─ scripts/        # Сиды, утилиты, backup/restore
├─ .env.example
├─ docker-compose.yml
└─ Makefile
```

## Этапы разработки

| # | Название | Результат |
|---|---------|-----------|
| 1 | **Боевое ядро** | Персонаж, бой, магазин, опыт, ремонт |
| 2 | Базовая экономика | Работа, производство, рынок |
| 3 | Крафт и кланы | Ферма, бары, кланы, склад |
| 4 | Стратегический слой | Premium, помощники, территории |
| 5 | Финальная сборка | Админка, антиабуз, деплой |

## Быстрый старт

```bash
# Скопировать env
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Поднять сервисы
docker compose up -d

# Накатить миграции и сиды
make db-migrate
make db-seed

# Открыть http://localhost:3000
```

## Команды (Makefile)

```bash
make dev          # Запустить в dev-режиме
make build        # Собрать production образы
make db-migrate   # Prisma migrate deploy
make db-seed      # Заполнить тестовыми данными
make db-reset     # Сбросить БД (осторожно!)
make logs         # Логи контейнеров
make deploy       # Деплой на VPS
```
