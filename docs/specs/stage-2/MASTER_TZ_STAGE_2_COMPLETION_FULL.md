# MASTER ТЗ — Этап 2: полная доработка до формальной приёмки

| | |
|---|---|
| Кодовое имя | `MASTER_TZ_STAGE_2_COMPLETION` |
| Версия | 2.4 (полная, отменяет 2.3) |
| Дата | 15.08.2026 |
| Статус | рабочее ТЗ на закрытие Этапа 2 |
| Канон механик | `MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx` — не отменяется |
| Проверенный коммит | `d81aeed` (main), прод `kooperativ.space` |

---

## 0. Как читать этот документ и чем он отличается от предыдущего

Версия 2.3 была написана по внешнему аудиту от 13.08. При подготовке этой версии
**каждое утверждение аудита перепроверено по коду**, и результат оказался иным:
из пятнадцати претензий аудита девять уже закрыты, а две задачи, которые 2.3
ставила, делать не нужно — они сделаны. Зато нашлись два дефекта, которых в
аудите нет вовсе.

Поэтому здесь всё построено на одном правиле: **ни одного утверждения без
ссылки на файл и строку**. Где написано «сделано» — там указано, чем это
доказывается. Где написано «не сделано» — там показан текущий код.

Разделы 1–3 — карта проекта и методика проверки. Раздел 4 — что закрыто (нужно
для протокола приёмки, чтобы не требовать сделанное). Разделы 5–14 — работы,
каждая с текущим кодом, решением, диффом и критерием. Разделы 15–18 — реестр
отклонений, протоколы, приёмка, план.

---

## 1. Методика верификации

Каждый пункт проверялся одним из четырёх способов:

| Способ | Как выглядит доказательство |
|---|---|
| Чтение кода | путь к файлу и номер строки |
| Запуск | команда и её вывод |
| Запрос к БД | SQL и результат |
| Проверка прода | HTTP-ответ или вывод команды на VPS |

Утверждения вида «вероятно», «скорее всего», «по-видимому» в этом документе
не допускаются. Если проверить не удалось, это написано прямо.

---

## 2. Карта проекта

### 2.1. Общая структура

```
browser-mmo-90s/
├── backend/                    Fastify + TypeScript + Prisma
│   ├── prisma/
│   │   ├── schema.prisma       28 моделей, 30 enum
│   │   ├── seed.ts             идемпотентный сид (305 строк)
│   │   ├── economy-data.ts     таблицы экономики — общий источник
│   │   └── migrations/         история миграций
│   ├── src/
│   │   ├── app.ts              сборка Fastify, регистрация 15 групп маршрутов
│   │   ├── main.ts             точка входа HTTP
│   │   ├── worker.ts           точка входа фоновых задач
│   │   ├── config/             app, auth, env, balance
│   │   ├── modules/            26 модулей (см. 2.2)
│   │   ├── shared/             db, errors, security, logger, health, utils
│   │   ├── workers/            6 воркеров + формулы метрик
│   │   ├── scripts/            production-auth-smoke
│   │   └── tests/              unit 18, integration 17, e2e 3
│   └── package.json
├── frontend/                   React 18 + Vite + TanStack Query
│   ├── src/
│   │   ├── app/                router, layouts, providers, error-boundary
│   │   ├── pages/              21 страница
│   │   ├── widgets/            character-card, city-nav, city-feed, location-view
│   │   ├── shared/             api (13 клиентов), lib, ui, types, assets
│   │   └── dev/                стенд боевого экрана
│   └── tests/visual/           Playwright: 2 файла
├── scripts/                    симуляторы и проверки для CI
├── docs/                       спецификации, исследования, отчёты
└── infra/docker/               Dockerfile бэкенда и фронта
```

### 2.2. Модули бэкенда и их состояние

| Модуль | Файлов | Роль | Состояние |
|---|---|---|---|
| `auth` | 4 | регистрация, вход, сессии | Этап 1, стабилен |
| `characters` | 4 | персонаж, характеристики | Этап 1 |
| `items`, `inventory` | 4 | предметы, экипировка | Этап 1 |
| `government-shop` | 2 | госмагазин | Этап 1 |
| `battles` | 7 | бой, зоны, сетка, таймаут | Этап 1 + переработка |
| `weapon-skills` | 1 | навыки оружия | Этап 1 |
| `experience`, `stats` | 2 | прогрессия, формулы | Этап 1 |
| `repair` | 2 | ремонт деталями | Этап 2 |
| `resources` | 5 | ресурсы, стеки, госскупка | Этап 2 |
| `work` | 5 | смены, зарплата, профессии | Этап 2 |
| `professions` | 1 | девять профессий, цепочки | Этап 2 |
| `private-shops` | 5 | частные лавки | Этап 2 |
| `market` | 7 | рынок, антиабуз | Этап 2 |
| `upgrades` | 5 | улучшения предметов | Этап 2 |
| `economy` | 3 | централизованные деньги | Этап 2 |
| `production` | 4 | **заглушка**: только list и get | задел Этапа 3 |
| `durability` | — | папка пуста | — |
| `logs` | 1 | репозиторий журналов | Этап 2 |
| `admin-auth`, `admin-basic` | 2 | админка, RBAC | Этап 2 |
| `balance-sandbox` | 2 | песочница баланса | Этап 2 |

Модуль `production` — 25 строк на четыре файла, только чтение справочника.
Вся логика производства живёт в `work`. Это точка роста Этапа 3.

### 2.3. Ключевые общие механизмы

Их обязана использовать любая новая работа — своих аналогов не изобретать.

| Механизм | Файл | Что даёт |
|---|---|---|
| Транзакция с повтором | `shared/db/transaction.ts` | `Serializable` + 3 повтора на `P2034` |
| Идемпотентность | `shared/db/idempotency.ts` | ключ на 24 ч, повтор возвращает сохранённый ответ, аудит повторов |
| Деньги | `modules/economy/economy.service.ts` | `credit` / `debit` с `CurrencyLog` и `balanceAfter` |
| Ресурсы | `modules/resources/resources.service.ts` | `add` / `consume` / `reserve` / `release` с инвариантом |
| Ошибки | `shared/errors/app-error.ts`, `error-codes.ts` | 89 кодов, единый обработчик в `app.ts` |
| Аутентификация | `shared/security/auth-middleware.ts` | `authenticate`, `requireAdminRole` |

---

## 3. Состояние прода на момент написания

Проверено 15.08.2026:

| Показатель | Значение | Чем проверено |
|---|---|---|
| Коммит прода | совпадает с `main` | CD `Deploy verified commit to VPS` → success |
| Готовность | `{"status":"ready","checks":{"postgres":"ok","redis":"ok"}}` | `curl https://kooperativ.space/ready` |
| Диск VPS | 69% занято, свободно 8.9 ГБ | `df -h /` |
| Кэш сборки Docker | 0 Б | `docker system df` |
| Память | 3.9 ГБ всего, 2.3 ГБ доступно | `free -m` |
| Сервисы | 6, у всех healthcheck | `docker-compose.prod.yml` |
| CI | 7 джобов, все зелёные | GitHub Actions |
| Тесты | 193 unit, 17 integration, 3 e2e, 2 Playwright-файла | `npx vitest run` |

---

## 4. Что уже закрыто: доказательства для протокола приёмки

Этот раздел существует, чтобы приёмка не требовала повторно сделанного.
Каждая строка проверена по коду 15.08.

| Претензия аудита 13.08 | Вердикт | Доказательство |
|---|---|---|
| A-01 нет воркера метрик экономики | **закрыто** | `backend/src/workers/economy-metrics-daily.worker.ts`; регистрация `src/worker.ts:14` и запуск `startEconomyMetricsDaily(4)`; чтение снимков `modules/admin-basic/admin-basic.routes.ts:7`. Считает M2, чистую эмиссию, стоки и краны, Gini, улучшения, рынок; шлёт алерты |
| A-02 симулятор не связан с рантаймом | **частично** | `scripts/simulate-economy.ts:2` импортирует `BalanceConfig`. Сид не импортирует — работа Р-8 |
| A-04 диск 75% при критерии <70% | **закрыто** | 69%, кэш сборки 0 Б |
| A-05 нет детекторов абуза рынка | **закрыто** | `modules/market/market-abuse.ts`: `auditSuspiciousPrice`, `recordPairTrade`, `recordMarketCancel`; пороги `BalanceConfig.economy.suspicious`; повторы идемпотентности — `shared/db/idempotency.ts:11` |
| A-06 нет RBAC админки | **закрыто** | `requireAdminRole` из `shared/security/auth-middleware.ts`; уровни доступа `admin-basic.routes.ts:10–12`: READ для трёх ролей, MODERATE для двух, SUPER для одной |
| A-11 фильтры рынка урезаны | **закрыто** | `market.routes.ts:9` — схема `Query` принимает `page`, `limit`, `type`, `mine`, `combat`, `level`, `search`, `priceMin`, `priceMax`, `sort`; `market.service.ts:12` реализует все, возвращает `total`; UI `pages/market/market-page.tsx` использует `search`, `priceMin`, `priceMax`, `sort` |
| A-12 admin DTO `username` | **закрыто** | схема принимает и `username`, и `login` |
| A-13 нет healthcheck у frontend и worker | **закрыто** | healthcheck у всех шести сервисов; воркер пишет heartbeat `src/worker.ts` |
| A-15 mojibake в исходниках | **закрыто** | `grep` по типичным последовательностям в `backend/src` и `frontend/src` — ноль совпадений |
| — блокер проходимости экономики | **закрыто 15.08** | `docs/ECONOMY_BLOCKERS_2026-08-15.md`; страж `scripts/check-economy-reachability.ts` в CI |

**Вывод раздела.** Версия 2.3 ставила задачу «доделать фильтры рынка» на один
день. Задача снимается: фильтры есть. Задача «чистка mojibake» тоже снимается.

---

## 5. Р-1 · Прогон протокола ручных QA-сценариев

### 5.1. Текущее состояние

Файла с протоколом в репозитории не было. Сценарии описаны в §39.1 ТЗ 2.2
(39 штук), но ни одного свидетельства прогона нет.
`docs/STAGE2_ACCEPTANCE_REPORT.md` содержит декларацию на несколько абзацев без
трассировки.

### 5.2. Что уже сделано этим ТЗ

Создан заполняемый протокол `docs/qa/STAGE2_MANUAL_QA.md` — 45 сценариев,
разбитых по подэтапам, с колонками «факт», «вердикт», «доказательство».

### 5.3. Что нужно сделать

Прогнать и заполнить. Правила:

1. Отдельный аккаунт для прогона, чтобы не портить статистику живых игроков.
2. Для сценариев с деньгами и предметами — выписка из журнала или скриншот.
3. FAIL не останавливает прогон: заводится задача, её номер в колонке
   доказательства.
4. Дата и исполнитель обязательны.

### 5.4. Три сценария изменились и прогоняются в новой редакции

Правки 15.08 изменили правила, зафиксированные в §39.1:

| № | Было в §39.1 | Стало | Причина |
|---|---|---|---|
| 9 | 8 смен в сутки, 9-я → `WORK_006` | 12 смен **или** 360 минут | реестр изменений ревизии 2.2 требовал двойного потолка; код отставал |
| 10 | `obj_parts_factory` требует `PL3` | требует **Литейщика** ур. 3 | допуск по предыдущему переделу |
| 8 | «Статус ACTIVE» | `CANCELLED` | опечатка в исходном ТЗ |

Плюс три новых сценария: 40 (лестница переделов), 41 (стройка кооператива),
42 (убывающая отдача зарплаты).

### 5.5. Критерий готовности

`docs/qa/STAGE2_MANUAL_QA.md` заполнен, 45 строк, ноль FAIL, подпись и дата.

---

## 6. Р-2 · Прогон граничных сценариев и технических проверок

### 6.1. Что уже сделано этим ТЗ

Создан `docs/qa/STAGE2_BOUNDARY_QA.md`: 30 граничных сценариев (25 из §39.2
плюс 5 новых под изменившиеся правила и фильтры) и 16 технических проверок
из §39.3 с готовыми SQL.

### 6.2. Обязательные SQL-проверки

```sql
-- 1. Отрицательных денег нет. Ожидание: 0
SELECT count(*) FROM characters WHERE money < 0;

-- 2. Инварианты ресурсных стеков. Ожидание: 0
SELECT count(*) FROM resource_stacks
 WHERE amount < 0 OR reserved_amount < 0 OR reserved_amount > amount;

-- 3. Предмет не задвоен в активных лотах. Ожидание: пусто
SELECT item_instance_id, count(*) FROM market_listings
 WHERE status = 'ACTIVE' AND item_instance_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;

-- 4. Цепочка balanceAfter непрерывна по каждому персонажу
SELECT character_id, amount, balance_after, reason_code, created_at
  FROM currency_logs ORDER BY character_id, created_at DESC LIMIT 100;
```

Инвариант ресурсов реализован в коде — `resources.formulas.ts`,
`assertResourceStackInvariant`. SQL проверяет, что он не был обойдён.

### 6.3. Критерий готовности

Протокол заполнен, выводы SQL вставлены дословно, ноль FAIL.

---

## 7. Р-3 · Репетиция миграций на копии прод-БД

### 7.1. Зачем именно на копии

Чистая база не ловит то, что ломается на живых данных: нарушенные ограничения,
длинные блокировки, неожиданные NULL в старых строках. ТЗ 2.2 требует
репетицию разделом 41.3; отчёта в репозитории нет.

### 7.2. Процедура

Полностью в `docs/qa/STAGE2_MIGRATION_REHEARSAL.md`. Кратко:

```bash
# дамп прода → отдельный контейнер → миграции с замером → сид дважды
ssh vps-game "cd /opt/mmo90s && docker compose ... exec -T postgres \
  pg_dump -U mmo90s mmo90s" > /tmp/prod-copy.sql
docker run -d --name mmo90s-rehearsal -e POSTGRES_PASSWORD=x \
  -e POSTGRES_DB=mmo90s -p 55432:5432 postgres:16
psql "postgres://postgres:x@127.0.0.1:55432/mmo90s" < /tmp/prod-copy.sql
time DATABASE_URL="postgres://postgres:x@127.0.0.1:55432/mmo90s" npx prisma migrate deploy
DATABASE_URL="..." npx tsx prisma/seed.ts && DATABASE_URL="..." npx tsx prisma/seed.ts
```

Дамп содержит персональные данные: удалить сразу после репетиции, в репозиторий
не класть.

### 7.3. Критерии успеха

| Критерий | Порог |
|---|---|
| Миграции применились | без ошибок |
| Общее время | < 60 с |
| Самая долгая блокировка | < 5 с |
| Повторный сид | без дублей |
| Данные Этапов 1–2 целы | контрольные суммы совпали |
| Откат приложения без отката БД | предыдущий образ поднимается |

---

## 8. Р-4 · Канонизация `SHIFT_READY`

### 8.1. Расхождение

Воркер пишет событие, которого нет в закрытом списке ТЗ 2.2.

`backend/src/workers/work-shift-finalize.worker.ts`:

```ts
await tx.productionLog.create({
  data: {
    characterId: shift.characterId,
    productionObjectId: shift.productionObjectId,
    eventType: 'SHIFT_READY',            // ← нет в каноне §-реестра событий
    metadataJson: { shiftId: shift.id },
  },
})
```

В `prisma/schema.prisma` значение объявлено в `enum ProductionLogEvent`, то есть
БД его знает — расходится именно текст ТЗ.

### 8.2. Решение: значение остаётся, канон расширяется

`SHIFT_READY` фиксирует реальный переход состояния — момент, когда воркер
перевёл смену в `READY_TO_CLAIM`. Это **единственная** запись, по которой видно,
что воркер жив и отработал вовремя: между `SHIFT_STARTED` и `SHIFT_CLAIMED`
может пройти неделя (смена в `READY_TO_CLAIM` бессрочна — §39.2 сценарий 18),
и без промежуточной записи нельзя отличить «игрок не забрал» от «воркер умер».

Удалять запись ради соответствия тексту — значит ослепить наблюдаемость самого
хрупкого места экономики.

### 8.3. Работы

1. Внести `SHIFT_READY` в реестр отклонений (раздел 15, О-1).
2. Добавить метрику задержки воркера в `economy-metrics-daily`:

```ts
// backend/src/workers/economy-metrics-daily.worker.ts
const readyLag = await prisma.$queryRaw<{ median_seconds: number }[]>`
  SELECT percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (pl.created_at - ws.ends_at))
         ) AS median_seconds
    FROM production_logs pl
    JOIN work_shifts ws ON ws.id = (pl.metadata_json ->> 'shiftId')::uuid
   WHERE pl.event_type = 'SHIFT_READY'
     AND pl.created_at >= now() - interval '1 day'`
```

3. Алерт при медиане выше 120 секунд: воркер отстаёт.

### 8.4. Критерий готовности

Реестр отклонений подписан; метрика задержки в снимке метрик; алерт настроен.

---

## 9. Р-5 · Канонизация усталости зарплаты

### 9.1. Расхождение

`backend/src/modules/work/work.formulas.ts` содержит множитель, которого нет в
формуле ТЗ 2.2:

```ts
export function dailyShiftSalaryCoeff(shiftsToday: number): number {
  // шаг 0.20, пол 0.20 — BalanceConfig.economy.work
}
```

Конфиг: `salaryFatigueStep: 0.20`, `salaryFatigueFloor: 0.20`
(`backend/src/config/balance.config.ts:8`).

### 9.2. Решение: множитель остаётся, канон расширяется

Без него суточный доход линеен по числу смен, и ограничителем остаётся только
потолок. Игрок, готовый кликать весь день, получает ровно вдвое больше
играющего полдня — побеждает выносливость, а не решение.

Аргумент усилился 15.08: потолок стал двойным (12 смен **или** 360 минут). На
девяностоминутных сменах потолок достигается за четыре захода, и без усталости
каждая из четырёх шла бы по полной ставке.

### 9.3. Каноническая формула после правки

```
finalSalary = baseSalary
            × workerEfficiency          // 1 + 0.03 × уровень профессии
            × objectLevelCoeff          // 1 + 0.25 × (уровень объекта − 1)
            × random(0.9 … 1.1)
            × fatigue                   // max(0.20, 1 − 0.20 × (смен сегодня − 1))
```

### 9.4. Работы

1. Внести формулу в реестр отклонений (О-2).
2. Показать усталость в интерфейсе. Сейчас `pages/work/work-page.tsx` выводит
   только `shiftsUsedToday / shiftsLimit`. Добавить множитель следующей смены:

```tsx
// ожидаемая ставка следующей смены, чтобы игрок понимал, почему платят меньше
const fatigue = Math.max(0.20, 1 - 0.20 * daily.shiftsUsedToday)
<small>Следующая смена: {Math.round(fatigue * 100)}% ставки</small>
```

3. Учесть усталость в симуляторе: профиль `worker` в
   `BalanceConfig.economy.simulation.profiles` считает 8 смен по полной ставке,
   что завышает расчётный доход. Исправляется вместе с Р-8.

### 9.5. Критерий готовности

Формула в реестре; интерфейс показывает множитель; симулятор его учитывает.

---

## 10. Р-6 · Рынок: выборка целиком в память

### 10.1. Это не «фильтры отсутствуют», это другое

Аудит писал, что фильтров нет. Фильтры есть — `market.routes.ts:9` и
`market.service.ts:12`. Настоящая проблема в том, **как** они выполняются.

### 10.2. Текущий код

```ts
// backend/src/modules/market/market.service.ts:12
async list(params: { page; limit; type?; sellerCharacterId?; combat?; level?;
                     search?; priceMin?; priceMax?; sort? }) {
  const where = { status: 'ACTIVE', ...type, ...seller, ...priceRange }
  let listings = await prisma.marketListing.findMany({
    where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  })                                    // ← без take/skip: грузится всё
  // ... подгрузка предметов и ресурсов
  if (params.combat || params.level !== undefined || search)
    listings = listings.filter(/* фильтрация в JS */)
  if (params.sort === 'PRICE_ASC') listings.sort(/* сортировка в JS */)
  const total = listings.length
  listings = listings.slice((page - 1) * limit, page * limit)
```

Три следствия:

1. **Память.** Все активные лоты грузятся в процесс на каждый запрос списка.
   При 137 лотах это незаметно, при 10 000 — десятки мегабайт на запрос.
2. **База.** `search`, `combat` и `level` не доходят до SQL: фильтрация идёт в
   JS после загрузки. Индексы по ним бесполезны.
3. **Стоимость страницы.** Открытие двадцатой страницы стоит столько же,
   сколько первой.

Смягчающее обстоятельство: `total` считается корректно именно потому, что
выборка полная. При переносе фильтров в SQL нужен отдельный `count`.

### 10.3. Решение

Перенести всё в SQL. Поиск по названию требует join с шаблонами, поэтому:

1. Добавить в `MarketListing` денормализованное поле `searchText`, заполняемое
   при создании лота (название и код предмета либо ресурса, в нижнем регистре).
2. Индексы:

```prisma
model MarketListing {
  // ...
  searchText String? @map("search_text")

  @@index([status, createdAt])
  @@index([status, price])
  @@index([status, type, price])
}
```

3. Переписать выборку:

```ts
const where: Prisma.MarketListingWhereInput = {
  status: 'ACTIVE',
  ...(params.type ? { type: params.type } : {}),
  ...(params.sellerCharacterId ? { sellerCharacterId: params.sellerCharacterId } : {}),
  ...(params.priceMin !== undefined || params.priceMax !== undefined
    ? { price: { gte: params.priceMin, lte: params.priceMax } } : {}),
  ...(search ? { searchText: { contains: search } } : {}),
}
const orderBy =
  params.sort === 'PRICE_ASC'  ? [{ price: 'asc'  as const }, { id: 'asc' as const }] :
  params.sort === 'PRICE_DESC' ? [{ price: 'desc' as const }, { id: 'asc' as const }] :
                                 [{ createdAt: 'desc' as const }, { id: 'asc' as const }]

const [listings, total] = await Promise.all([
  prisma.marketListing.findMany({
    where, orderBy,
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  }),
  prisma.marketListing.count({ where }),
])
```

`combat` и `level` относятся к шаблону предмета, а не к лоту. Их два пути:
либо тоже денормализовать в лот (`weaponClass`, `levelReq`), либо оставить
фильтрацию в JS, но **после** пагинации по остальным условиям, честно пометив
в ответе, что счётчик приблизителен. Рекомендуется денормализация — она
дешевле и не врёт.

### 10.4. Миграция

```sql
ALTER TABLE market_listings ADD COLUMN search_text text;
ALTER TABLE market_listings ADD COLUMN weapon_class text;
ALTER TABLE market_listings ADD COLUMN level_req int;

-- заполнение существующих строк
UPDATE market_listings ml SET
  search_text = lower(coalesce(it.name,'') || ' ' || coalesce(it.code,'') || ' ' ||
                      coalesce(rt.name,'') || ' ' || coalesce(rt.code,'')),
  weapon_class = it.weapon_type,
  level_req = it.level_req
FROM item_instances ii
LEFT JOIN item_templates it ON it.id = ii.template_id
LEFT JOIN resource_templates rt ON rt.id = ml.resource_template_id
WHERE ii.id = ml.item_instance_id OR ml.resource_template_id IS NOT NULL;

CREATE INDEX market_listings_status_created_idx ON market_listings (status, created_at DESC);
CREATE INDEX market_listings_status_price_idx   ON market_listings (status, price);
CREATE INDEX market_listings_search_idx         ON market_listings USING gin (search_text gin_trgm_ops);
```

Индекс `gin_trgm_ops` требует расширения `pg_trgm`; если ставить его не хотим,
достаточно обычного индекса и поиска по префиксу вместо `contains`.

### 10.5. Тесты

| Тест | Файл | Проверяет |
|---|---|---|
| фильтр по цене доходит до SQL | `tests/integration/market.test.ts` | план запроса не читает лишних строк, `total` верен |
| поиск по названию | там же | лот с совпадением находится, без совпадения — нет |
| пагинация | там же | вторая страница не пересекается с первой |
| сортировка стабильна | `tests/unit/market.formulas.test.ts` | при равных ценах порядок по `id` |

### 10.6. Критерий готовности

`findMany` в `MarketService.list` вызывается с `take` и `skip`; `count`
отдельный; фильтры в `where`; тесты зелёные.

---

## 11. Р-7 · Архивация ТЗ v2.0

### 11.1. Текущее состояние

```
docs/specs/stage-2/
├── MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.0.docx    ← отменён
├── MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.0.md      ← отменён, но самый большой
└── MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx    ← действующий
```

Markdown-версия v2.0 крупнее остальных, поэтому автоматический поиск по
репозиторию находит именно её. Это уже приводило к работе по отменённой модели.

### 11.2. Работы

```bash
mkdir -p docs/specs/archive/stage-2
git mv docs/specs/stage-2/MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.0.docx docs/specs/archive/stage-2/
git mv docs/specs/stage-2/MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.0.md   docs/specs/archive/stage-2/
```

В начало markdown-копии — баннер:

```markdown
> **НЕДЕЙСТВИТЕЛЬНО.** Версия 2.0 отменена ревизиями 2.1 и 2.2.
> Действующий документ — `MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx`.
> Ревизия 2.2 отменила единый производственный уровень: качается каждая
> профессия отдельно (раздел 47.3).
```

`docs/specs/README.md` уже создан и указывает только на действующие документы.

---

## 12. Р-8 · Симулятор читает сид

### 12.1. Расхождение

`scripts/simulate-economy.ts` импортирует `BalanceConfig`, но зарплаты, выпуск
и стоимость ремонта задаёт своими числами:

```ts
// BalanceConfig.economy.simulation
worker: { battles: 1, shifts: 8, marketEveryDays: 3 },
battleRewardMin: 35, battleRewardMax: 75,
repairCost: 200, governmentMaintenanceCost: 150,
```

Правка сида в эту модель не попадает. PASS симулятора перестаёт что-либо
гарантировать: он проверяет сам себя.

### 12.2. Решение

Таблицы уже вынесены — `backend/prisma/economy-data.ts`. Симулятор должен
брать их оттуда:

```ts
import { PRODUCTION_OBJECTS, RESOURCES, PRIVATE_SHOP_RESOURCES }
  from '../backend/prisma/economy-data'
import { dailyShiftSalaryCoeff, calcFinalSalary } from '../backend/src/modules/work/work.formulas'

// профиль «рабочий» строится по реальному объекту, а не по константе
const object = PRODUCTION_OBJECTS.find(o => o.code === 'obj_scrapyard')!
for (let shift = 1; shift <= shiftsPerDay; shift++) {
  const salary = calcFinalSalary({
    baseSalary: object.baseSalary,
    professionLevel,
    objectLevel: 1,
    shiftsToday: shift,          // ← усталость учитывается
    random: rng(),
  })
  income += salary
}
```

### 12.3. Regression-тест против расхождения

```ts
// backend/src/tests/unit/simulation-inputs.test.ts
it('в симуляторе учтён каждый объект сида', () => {
  const simulated = new Set(SIMULATION_OBJECT_CODES)
  for (const object of PRODUCTION_OBJECTS) {
    expect(simulated.has(object.code), `объект ${object.code} не учтён в симуляторе`).toBe(true)
  }
})
```

Тест падает, когда в сид добавили объект, а модель не обновили. Именно так
экономика расходится незаметно.

### 12.4. Критерий готовности

Симулятор не содержит собственных копий зарплат и выпуска; regression-тест
зелёный; прогон в CI по-прежнему PASS.

---

## 13. Р-9 · Актуализация канонических правил

Правки 15.08 изменили два правила ТЗ 2.2 и добавили один объект. Это надо
внести в канон, иначе следующий аудит снова найдёт «расхождение».

| Правило | Было (v2.2) | Стало | Основание |
|---|---|---|---|
| Суточный лимит | 8 смен | 12 смен **и** 360 минут | реестр изменений ревизии 2.2 прямо требовал двойного потолка, код отставал |
| Допуск на объект | уровень профессии самого объекта | уровень предыдущего передела | иначе объект заперт сам собой: три из шести не открывались никогда |
| Профессия брони | «Строитель кооператива» без объектов | добавлен `obj_cooperative_site` | иначе улучшения брони навсегда на нулевом мастерстве |

Код правил:

```ts
// backend/src/modules/work/work.formulas.ts
export function admissionRequirement(object: {
  requiredProfessionCode: string; requiredProfessionLevel: number
}) {
  if (object.requiredProfessionLevel <= 0) return null
  const previous = isProfessionCode(object.requiredProfessionCode)
    ? previousProfession(object.requiredProfessionCode) : null
  return { professionCode: previous ?? object.requiredProfessionCode,
           level: object.requiredProfessionLevel }
}

export function fitsDailyBudget(shiftsToday: number, minutesToday: number,
                                nextShiftMinutes: number, limits) {
  return shiftsToday < limits.shifts && minutesToday + nextShiftMinutes <= limits.minutes
}
```

---

## 14. Р-10 · Читаемость сжатого кода

### 14.1. Факт

Часть сервисов Этапа 2 записана в одну строку на метод. Замер:

| Файл | Строк | Средняя длина строки |
|---|---|---|
| `modules/market/market.service.ts` | 44 | **239 символов** |
| `modules/work/work.routes.ts` | 16 | ~300 символов на маршрут |
| `modules/production/*.ts` | 25 всего | — |

Для сравнения, `economy.service.ts` и `resources.service.ts` написаны обычно и
читаются нормально.

### 14.2. Почему это не косметика

1. **Диффы бесполезны.** Правка одного условия в `market.service.ts:42`
   показывает изменение всей строки в 2000 символов — ревью невозможно.
2. **Стек-трейс указывает на строку**, в которой двадцать операций.
3. **Конфликты слияния** в такой строке не разрешаются вручную.
4. Этап 3 добавит к рынку цены по отношениям кланов — править придётся именно
   эти строки.

### 14.3. Решение

Не переписывать всё. Разбить **только те методы, которые будет трогать Этап 3**:

| Метод | Файл | Почему |
|---|---|---|
| `MarketService.list` | `market.service.ts:12` | Р-6 переписывает выборку |
| `MarketService.buy` | `market.service.ts:42` | Этап 3 добавляет модификатор цены по клану |
| маршруты `/listings` | `market.routes.ts` | добавляется поле отношения в ответ |

Остальное — по мере касания. Правило на будущее: **новый код Этапа 3 пишется
в обычном форматировании**, prettier-конфигурация проекта не меняется.

---

## 15. Реестр отклонений от ТЗ 2.2

После подписания перечисленное становится частью канона и не считается дефектом.

| № | Отклонение | Решение | Обоснование | Раздел |
|---|---|---|---|---|
| О-1 | `ProductionLog.SHIFT_READY` вне закрытого списка событий | принято, канонизировано | единственный признак живого воркера между стартом и клеймом | 8 |
| О-2 | Множитель усталости зарплаты вне канонической формулы | принято, формула расширена | без него суточный доход линеен, побеждает выносливость | 9 |
| О-3 | Допуск на объект по предыдущему переделу вместо собственной профессии | принято | иначе половина производства недостижима | 13 |
| О-4 | Суточный лимит 12 смен и 360 минут вместо 8 смен | принято | требование ревизии 2.2, код отставал | 13 |
| О-5 | Добавлен объект `obj_cooperative_site` | принято | без него ремесленная профессия брони недостижима | 13 |

---

## 16. Протоколы приёмки

| Документ | Состояние |
|---|---|
| `docs/qa/STAGE2_MANUAL_QA.md` | шаблон готов, 45 сценариев, ждёт прогона |
| `docs/qa/STAGE2_BOUNDARY_QA.md` | шаблон готов, 30 + 16 проверок, ждёт прогона |
| `docs/qa/STAGE2_MIGRATION_REHEARSAL.md` | шаблон готов, ждёт репетиции |

---

## 17. Критерии приёмки Этапа 2

Этап считается принятым, когда выполнено всё:

1. `STAGE2_MANUAL_QA.md` заполнен, ноль FAIL, подпись и дата.
2. `STAGE2_BOUNDARY_QA.md` заполнен, SQL-выводы вставлены дословно, ноль FAIL.
3. `STAGE2_MIGRATION_REHEARSAL.md` содержит отчёт с таймингами и вердиктом.
4. Реестр отклонений (раздел 15) подписан заказчиком: пять пунктов.
5. `MarketService.list` работает через SQL с пагинацией; тесты зелёные.
6. Симулятор читает сид; regression-тест на расхождение зелёный.
7. ТЗ v2.0 в `docs/specs/archive/`, README указывает только на действующие.
8. Метрика задержки `SHIFT_READY` в снимке метрик, алерт настроен.
9. Интерфейс работы показывает множитель усталости.
10. CI зелёный целиком, включая проверку проходимости экономики.
11. Диск прода ниже 70%, шесть сервисов healthy, бэкапы свежие.
12. `STAGE2_ACCEPTANCE_REPORT.md` переписан: вместо декларации — ссылки на
    протоколы из пунктов 1–3 и на реестр отклонений.

---

## 18. План работ

| Шаг | Состав | Дней | Зависимости |
|---|---|---|---|
| 1 | Р-7 архивация v2.0 | 0.1 | — |
| 2 | Р-4 `SHIFT_READY` + метрика, Р-5 усталость + интерфейс, Р-9 канон правил | 0.7 | — |
| 3 | Р-8 симулятор читает сид, regression-тест | 0.5 | после Р-5 |
| 4 | Р-6 рынок: SQL-выборка, денормализация, индексы, миграция, тесты | 1.5 | — |
| 5 | Р-10 разбор сжатых методов рынка | 0.3 | вместе с Р-6 |
| 6 | Р-3 репетиция миграций | 0.5 | после шага 4 (мигрирует индексы) |
| 7 | Р-1 и Р-2 прогон протоколов | 1.0 | последними |
| 8 | Переписать `STAGE2_ACCEPTANCE_REPORT.md` | 0.2 | после протоколов |
| | **Итого** | **4.8 дня** | |

Прогон протоколов идёт последним намеренно: протокол подтверждает финальную
сборку, а не промежуточную. Если прогнать раньше шага 4, придётся прогонять
рыночные сценарии дважды.

---

## 19. Что этот документ сознательно не делает

Чтобы не расширять объём приёмки бесконечно:

- **не переписывает фронтенд** на pages/features/widgets: претензия A-10
  справедлива, но это рефакторинг на несколько дней без функционального
  результата. Разбираются только методы, которые трогает Этап 3 (Р-10);
- **не вводит наблюдаемость сверх метрик экономики**: трассировки и APM — вопрос
  эксплуатации, а не приёмки Этапа 2;
- **не меняет игровые механики**: любое изменение баланса относится к Этапу 3;
- **не трогает боевую часть**: она принята в Этапе 1 и переработана отдельно.
