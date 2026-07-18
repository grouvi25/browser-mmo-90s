# Архитектура масштабируемости

## Целевая нагрузка

| Сценарий | Участники |
|----------|-----------|
| 20 клановых боёв × 80 игроков | 1 600 concurrent battle participants |
| + PvP 1v1, торговля, ферма | ~1 500 дополнительно |
| **Итого расчётный пик** | **~3 000–5 000 concurrent users** |

---

## Ключевые принципы

### 1. Backend — STATELESS. Всегда.

Никакого состояния в памяти процесса. Любой `Map`, `Set`, переменная модуля с игровым состоянием — это баг при горизонтальном масштабировании.

```
❌ const activeBattles = new Map<string, BattleState>()
✅ Redis: battle:{id}:state
```

### 2. Redis — обязателен с Этапа 1

Не "задел на потом". Redis используется для:

| Ключ | Назначение |
|------|-----------|
| `battle:{id}:state` | Текущее состояние боя |
| `battle:{id}:lock` | Distributed lock (предотвращает race conditions) |
| `battle:{id}:actions` | Очередь действий раунда (List) |
| `battle:{id}:timer` | Таймер раунда (expire) |
| `session:{token}` | JWT сессии |
| `char:{id}:status` | Онлайн-статус |
| `ratelimit:{ip}:{route}` | Rate limiting (работает во всех инстансах) |
| Socket.io pub/sub | @socket.io/redis-adapter |
| BullMQ queues | battle-actions, production-cycles, farm-timers |

### 3. Battle State Machine — Redis + BullMQ

Проблема: 80 участников клановго боя одновременно шлют действия раунда.

Решение:
```
HTTP POST /api/battles/{id}/action
  → Валидация участника
  → Redis RPUSH battle:{id}:actions {action}
  → 202 Accepted (немедленно, не блокируем)

BullMQ Worker: battle-round-resolver
  → Триггер: все участники отправили ИЛИ истёк таймер (30 сек)
  → Redis SET NX battle:{id}:lock (distributed lock)
  → Атомарно: читаем все actions, сортируем по initiative
  → Разрешаем все действия раунда
  → Батч INSERT battle_turns в PostgreSQL
  → Redis DEL battle:{id}:actions, battle:{id}:lock
  → Socket.io EMIT battle:{id}:round_result (через Redis pub/sub)
```

### 4. Socket.io + Redis Adapter

ОБЯЗАТЕЛЬНО при 2+ инстансах backend:

```typescript
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

const pubClient = createClient({ url: REDIS_URL })
const subClient = pubClient.duplicate()
io.adapter(createAdapter(pubClient, subClient))
```

Без этого: игрок на инстансе #1 не получит сообщение, отправленное с инстансе #2.

### 5. PgBouncer — обязателен

PostgreSQL без connection pooler:
- Max connections по умолчанию: **100**
- При 3000 users: ~900 concurrent queries

PgBouncer конфигурация:
```
POOL_MODE=transaction      # лучший режим для stateless backend
MAX_CLIENT_CONN=2000       # frontend клиентов
DEFAULT_POOL_SIZE=50       # реальных соединений к PG
```

### 6. Горизонтальное масштабирование

```bash
# Запустить 3 инстанса backend + 2 воркера
docker compose up --scale backend=3 --scale worker=2 -d
```

Nginx автоматически балансирует по `least_conn`.

---

## Антипаттерны — НЕЛЬЗЯ

```typescript
// ❌ In-memory battle state
const battles = new Map<string, Battle>()

// ❌ In-memory rate limiter
const requests = new Map<string, number>()

// ❌ Синхронное разрешение раунда 80 игроков
await resolveBattleRound(battle) // блокирует event loop на секунды

// ❌ 80 отдельных INSERT в транзакции для лога боя
for (const turn of turns) {
  await prisma.battleTurn.create({ data: turn })
}

// ✅ Батч INSERT
await prisma.battleTurn.createMany({ data: turns })

// ❌ Прямое соединение с PostgreSQL (без PgBouncer)
DATABASE_URL=postgresql://...@postgres:5432/...

// ✅ Через PgBouncer
DATABASE_URL=postgresql://...@pgbouncer:5432/...
```

---

## Схема деплоя

```
Browser
  ↓ HTTPS + WebSocket
Nginx (load balancer)
  upstream backend_pool (least_conn):
    ├─ backend:4000 (instance 1)
    ├─ backend:4000 (instance 2)
    └─ backend:4000 (instance N)
         ↓
     PgBouncer (transaction mode, 2000 clients → 50 PG connections)
         ↓
     PostgreSQL 16 (persistent storage)

     Redis 7 (shared state, pub/sub, BullMQ queues)
       ↑ used by all backend instances and workers

     BullMQ Workers (instance 1, 2):
       - battle-round-resolver
       - production-cycle
       - farm-timer
       - suspicious-battle-checker
```

---

## Мониторинг (добавить позже)

- **Bull Board** — UI для мониторинга BullMQ очередей
- **pg_stat_activity** — мониторинг соединений PostgreSQL
- **Redis INFO** — использование памяти, hit rate
- **Nginx access logs** — аномальные паттерны
