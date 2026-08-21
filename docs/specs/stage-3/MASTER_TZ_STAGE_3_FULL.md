# MASTER ТЗ — Этап 3: крафт, собственность и социальная экономика

| | |
|---|---|
| Кодовое имя | `MASTER_TZ_STAGE_3_CRAFT_CLANS_ECONOMY` |
| Версия | 3.2 (полная, самодостаточная) |
| Дата | 15.08.2026 |
| Статус | рабочее мастер-ТЗ на реализацию |
| Проект | браузерная MMO-RPG в сеттинге России 90-х («Кооператив») |
| Репозиторий | `grouvi25/browser-mmo-90s` |
| Прод | `https://kooperativ.space` |
| Базовый коммит | `d81aeed` |
| Предусловие | закрыт `MASTER_TZ_STAGE_2_COMPLETION_FULL.md` |

---

## 0. Как читать этот документ

Документ самодостаточен: чтобы начать реализацию, других файлов открывать не
нужно. Он построен так, чтобы разработчик мог идти сверху вниз и на каждом шаге
знал, **какой файл создать или изменить, что в нём написать и как проверить**.

| Часть | Что внутри | Кому |
|---|---|---|
| I | цели, решения заказчика, границы | всем |
| II | файловая структура: что добавляется, что меняется | всем |
| III | модель данных целиком, Prisma-код | бэкенд |
| IV | модули: сервисы, формулы, маршруты, код | бэкенд |
| V | воркеры | бэкенд |
| VI | фронтенд: клиенты API, страницы, компоненты | фронтенд |
| VII | баланс, формулы, числа | геймдизайн, бэкенд |
| VIII | миграции и сид | бэкенд, DevOps |
| IX | тесты и симуляторы | QA, бэкенд |
| X | приёмка, план, риски | заказчик, менеджер |

**Соглашение о точности.** Всё, что описано как «сейчас в коде», проверено
чтением файлов на коммите `d81aeed`. Всё, что описано как «добавляется», —
проектное решение этого ТЗ. Эти два вида утверждений нигде не смешиваются.

---

# Часть I. Обзор и границы

## 1. Что такое Этап 3

Этап 1 замкнул боевой цикл, Этап 2 — экономический:

> бой → износ → ремонт → нужны деньги и детали → работа → ресурсы → рынок → улучшения → снова бой

Этап 3 достраивает **вторую петлю и социальный слой**:

> сырьё → передел по рецепту → готовый предмет → рынок
> земля → урожай → бар → еда, напитки, баффы → бой
> игрок → клан → склад и общак → совместное производство → цены для своих

Смысловое отличие: в Этапе 2 игрок — наёмный работник у системы. В Этапе 3 он
становится **собственником**: покупает объект, нанимает других игроков, платит
им зарплату и живёт с разницы между ценой сырья и ценой продукта. Появляется
второй вопрос помимо «во что вложить деньги» — **«кем быть»**.

## 2. Решения заказчика от 15.08.2026

| # | Вопрос | Решение | Следствие для объёма |
|---|---|---|---|
| Р1 | Цепочки — в Этап 3 или отдельно | **всё в Этап 3** | +7 дней, всего 25 |
| Р2 | Кому принадлежат бары и колхоз | **игрок покупает сам** | нужен полный контур частной собственности |
| Р3 | Опьянение | штраф к точности **и** снижение получаемого урона; лёгкое опьянение — небольшой плюс | боевые формулы затрагиваются, нужна матрица экспериментов |
| Р4 | «Свои/чужие цены» | **скидка своим + наценка чужим** | нужна минимальная дипломатия кланов |

Отдельное решение по замечанию к первой редакции: числа опьянения были
завышены (−35% точности при том, что вся прогрессия улучшений даёт +5%).
Масштаб пересчитан от шага улучшений — раздел 26.

## 3. Что входит

**Производственный слой:** рецепты и цепочки переделов, склады объектов,
производственные циклы, вклад труда от смен, частная и клановая собственность,
зарплата из баланса объекта, покупка и износ оборудования, качество ресурсов,
восстановительные работы, смена производственного профиля.

**Социально-крафтовый слой:** личная ферма, колхоз, бары, опьянение и баффы,
крафт расходников, кланы, роли и права, клановый склад, общак, отношения
кланов и цены для своих.

## 4. Что не входит

| Не входит | Куда отнесено |
|---|---|
| территории, районы, захват недвижимости | Этап 4 |
| клановые и массовые бои, войны, базы кланов | Этап 4 |
| синдикатная валюта и клановый магазин | Этап 4 |
| premium, помощники, премиум-магазин | Этап 4 |
| рэкет на трассе | Этап 4 |
| вторая ступень профессии, импортный инструмент | Этап 4 |
| биржевой стакан заявок | Этап 4+ |
| перепродажа объектов между игроками | не планируется: второй рынок без антиабуза |
| форум | остаётся заглушкой |

Дипломатия входит **только** в объёме, нужном ценам: три состояния и их
установка. Союзные операции и войны — Этап 4.

## 5. Принципы, которым подчинён этап

1. **Игрок не самодостаточен.** Боец зависит от мастера и бара, владелец — от
   рабочих и рынка, клан — от снабжения. Механика, позволяющая закрыться в
   одиночку, противоречит замыслу.
2. **Одна механика на все производства.** Завод, колхоз и бар используют один
   цикл. Отличается только содержимое рецепта.
3. **Прогрессия снижает рутину, а не увеличивает награду.**
4. **Каждая новая петля приносит свой сток.**
5. **Ни одного числа в коде формул** — всё в `BalanceConfig`.
6. **Ни одного нового способа делать то, что уже делается.** Транзакции,
   идемпотентность, деньги и ресурсы — через существующие механизмы.

---

# Часть II. Файловая структура

## 6. Что уже есть и переиспользуется без изменений

Эти механизмы Этап 3 обязан использовать, а не дублировать:

| Файл | Что даёт | Как используется в Этапе 3 |
|---|---|---|
| `backend/src/shared/db/transaction.ts` | `withTransaction`: Serializable + 3 повтора на `P2034` | все операции цикла, склада, общака |
| `backend/src/shared/db/idempotency.ts` | `withIdempotency`: ключ 24 ч, повтор возвращает ответ, аудит повторов | все мутации с деньгами и предметами |
| `backend/src/modules/economy/economy.service.ts` | `credit` / `debit` с `CurrencyLog` и `balanceAfter` | покупка объекта, зарплата, бар, общак |
| `backend/src/modules/resources/resources.service.ts` | `add` / `consume` / `reserve` / `release` + инвариант | вход и выход цикла, урожай, ингредиенты |
| `backend/src/shared/errors/app-error.ts` + `error-codes.ts` | 89 кодов, единый обработчик в `app.ts` | новые коды `PROD_*`, `FARM_*`, `BAR_*`, `CLAN_*` |
| `backend/src/shared/security/auth-middleware.ts` | `authenticate`, `requireAdminRole` | все новые маршруты |
| `backend/src/modules/professions/professions.ts` | цепочки переделов, `previousProfession` | допуск на объекты и рецепты |
| `backend/src/modules/work/work.formulas.ts` | `admissionRequirement`, `fitsDailyBudget`, `calcFinalSalary` | смены на новых объектах |
| `backend/prisma/economy-data.ts` | таблицы сида, читаемые снаружи | новые ресурсы, объекты, рецепты |

## 7. Полная карта изменений бэкенда

Легенда: `+` создаётся, `~` изменяется, пусто — не трогается.

```
backend/
├── prisma/
│   ├── schema.prisma                              ~ +16 моделей, +9 enum, +4 расширения
│   ├── economy-data.ts                            ~ +ресурсы, +объекты, +рецепты, +растения, +меню
│   ├── seed.ts                                    ~ +сид рецептов, растений, меню, прав ролей
│   └── migrations/
│       ├── 20260816_stage3_enums/                 +
│       ├── 20260816_stage3_production_chains/     +
│       ├── 20260816_stage3_object_ownership/      +
│       ├── 20260817_stage3_resource_quality/      +  ← единственная с перестройкой индекса
│       ├── 20260817_stage3_farm/                  +
│       ├── 20260818_stage3_bars/                  +
│       ├── 20260818_stage3_intoxication/          +
│       └── 20260819_stage3_clans/                 +
├── src/
│   ├── app.ts                                     ~ +6 групп маршрутов
│   ├── worker.ts                                  ~ +4 воркера
│   ├── config/balance.config.ts                   ~ +production, +farm, +bar, +clan, +intoxication
│   ├── shared/errors/error-codes.ts               ~ +~40 кодов
│   ├── modules/
│   │   ├── production/                            ~ модуль-заглушка становится ядром этапа
│   │   │   ├── production.service.ts              ~ переписывается
│   │   │   ├── production.repository.ts           ~ переписывается
│   │   │   ├── production.routes.ts               ~ переписывается
│   │   │   ├── production.errors.ts               ~
│   │   │   ├── recipe.service.ts                  + рецепты: чтение, проверка допуска
│   │   │   ├── cycle.service.ts                   + жизненный цикл производственного цикла
│   │   │   ├── cycle.formulas.ts                  + труд, длительность, качество выхода
│   │   │   ├── inventory.service.ts               + склад объекта, резерв, вместимость
│   │   │   ├── ownership.service.ts               + покупка, продажа, баланс, ставка, профиль
│   │   │   └── equipment.service.ts               + износ и обслуживание оборудования
│   │   ├── farm/                                  + новый модуль
│   │   │   ├── farm.service.ts                    +
│   │   │   ├── farm.formulas.ts                   + рост, полив, засыхание, бонусы построек
│   │   │   ├── farm.repository.ts                 +
│   │   │   ├── farm.routes.ts                     +
│   │   │   └── farm.errors.ts                     +
│   │   ├── bars/                                  + новый модуль
│   │   │   ├── bars.service.ts                    +
│   │   │   ├── bars.formulas.ts                   + коридор цен, налог
│   │   │   ├── bars.routes.ts                     +
│   │   │   └── bars.errors.ts                     +
│   │   ├── intoxication/                          + новый модуль
│   │   │   ├── intoxication.formulas.ts           + ступени, отрезвление, похмелье
│   │   │   └── intoxication.service.ts            + применение напитка, пересчёт
│   │   ├── clans/                                 + новый модуль
│   │   │   ├── clans.service.ts                   + создание, состав, роли
│   │   │   ├── clan-storage.service.ts            + склад
│   │   │   ├── clan-treasury.service.ts           + общак
│   │   │   ├── clan-relations.service.ts          + отношения
│   │   │   ├── clans.permissions.ts               + матрица прав
│   │   │   ├── clans.repository.ts                +
│   │   │   ├── clans.routes.ts                    +
│   │   │   └── clans.errors.ts                    +
│   │   ├── work/work.service.ts                   ~ смена вкладывает труд в цикл, режим восстановления
│   │   ├── work/work.formulas.ts                  ~ +вклад труда
│   │   ├── market/market.service.ts               ~ +модификатор цены по отношению кланов
│   │   ├── market/market.formulas.ts              ~ +расчёт модификатора
│   │   ├── battles/battle.formulas.ts             ~ +эффекты опьянения в расчёт удара
│   │   └── characters/characters.service.ts       ~ +градус и клан в ответе профиля
│   ├── workers/
│   │   ├── production-cycle.worker.ts             +
│   │   ├── farm-growth.worker.ts                  +
│   │   ├── intoxication-decay.worker.ts           +
│   │   ├── clan-maintenance.worker.ts             +
│   │   └── economy-metrics-daily.worker.ts        ~ +метрики этапа
│   └── tests/
│       ├── unit/cycle.formulas.test.ts            +
│       ├── unit/farm.formulas.test.ts             +
│       ├── unit/intoxication.formulas.test.ts     +
│       ├── unit/clan-permissions.test.ts          +
│       ├── unit/market-relation-price.test.ts     +
│       ├── integration/production-cycle.test.ts   +
│       ├── integration/object-ownership.test.ts   +
│       ├── integration/farm.test.ts               +
│       ├── integration/bars.test.ts               +
│       ├── integration/clans.test.ts              +
│       └── e2e/stage3-cycle.e2e.test.ts           +
└── scripts/ (в корне репозитория)
    ├── check-economy-reachability.ts              ~ +рецепты, +проверка циклов в цепочке
    ├── simulate-economy.ts                        ~ +профили владельца и фермера
    └── simulate-apeha-matrix.ts                   ~ +ступени опьянения
```

## 8. Полная карта изменений фронтенда

```
frontend/src/
├── app/router.tsx                                 ~ +11 маршрутов вместо заглушек /soon/*
├── shared/api/
│   ├── production.api.ts                          + объекты, циклы, склад, оборудование
│   ├── farm.api.ts                                +
│   ├── bars.api.ts                                +
│   ├── clans.api.ts                               +
│   ├── market.api.ts                              ~ +поля отношения и итоговой цены
│   ├── characters.api.ts                          ~ +градус, клан
│   └── work.api.ts                                ~ +вклад в цикл, режим восстановления
├── shared/lib/layout-map.ts                       ~ +районы «Бары» и «Бригада»
├── pages/
│   ├── farm/                                      +
│   │   ├── farm-page.tsx                          + сетка участков, таймеры
│   │   ├── farm-plot.tsx                          + один участок
│   │   ├── plant-picker.tsx                       + выбор растения
│   │   └── farm.css                               +
│   ├── objects/                                   +
│   │   ├── my-objects-page.tsx                    + баланс, ставка, цикл, склад
│   │   ├── object-market-page.tsx                 + каталог на продажу
│   │   ├── object-cycle-panel.tsx                 + состояние цикла и причина отказа
│   │   └── objects.css                            +
│   ├── bars/                                      +
│   │   ├── bars-page.tsx                          + список баров и меню
│   │   ├── my-bar-page.tsx                        + управление своим баром
│   │   └── bars.css                               +
│   ├── clan/                                      +
│   │   ├── clan-page.tsx                          + профиль, состав, роли
│   │   ├── clan-storage-page.tsx                  +
│   │   ├── clan-treasury-page.tsx                 +
│   │   ├── clan-relations-page.tsx                +
│   │   ├── clan-create-dialog.tsx                 +
│   │   └── clan.css                               +
│   ├── plants/plants-page.tsx                     + справочник растений
│   ├── crafting/crafting-page.tsx                 + рецепты предметов
│   ├── market/market-page.tsx                     ~ +цена с учётом отношения
│   └── work/work-page.tsx                         ~ +вклад в цикл, режим восстановления
├── widgets/
│   ├── intoxication-badge/                        + градус в шапке персонажа
│   └── city-nav/city-nav.tsx                      ~ +новые районы
└── tests/visual/stage3.visual.spec.ts             +
```

## 9. Оценка объёма в файлах

| Категория | Создаётся | Изменяется |
|---|---|---|
| Модели Prisma | 16 | 4 |
| Enum | 9 | 4 |
| Миграции | 8 | — |
| Модули бэкенда | 4 новых, 22 файла | 7 файлов |
| Воркеры | 4 | 1 |
| Маршруты API | ~40 ручек | 3 существующих контракта |
| Клиенты API фронта | 4 | 3 |
| Страницы фронта | 11 | 2 |
| Тесты | 11 файлов | — |
| Скрипты и симуляторы | — | 3 |

---

# Часть III. Модель данных

## 10. Принципы изменения схемы

1. **Только аддитивно.** Новые таблицы и nullable-поля. Ни одно поле Этапа 2 не
   переименовывается и не удаляется. Проверка в CI —
   `scripts/check-migration-additivity.mjs`.
2. **Единственное исключение** — `ResourceStack.quality`: добавление качества
   меняет уникальный индекс. Порядок операций расписан в разделе 45, репетиция
   на копии прод-БД обязательна.
3. **Денежные и ресурсные операции — только через сервисы.** Прямых
   `character.update({ money })` в новом коде быть не должно.
4. **Инварианты в коде, проверка в SQL.** Каждый счётчик с резервом
   сопровождается тестом и SQL-проверкой в протоколе приёмки.

## 11. Новые enum

```prisma
enum ProductionCycleStatus {
  PENDING       // ждёт условий: сырьё, место на складе, труд
  RUNNING       // идёт, вход зарезервирован
  COMPLETED     // выход зачислен
  FAILED        // прерван, резерв возвращён
}

enum ProductionCycleFailure {
  INPUT_MISSING       // не хватает входного ресурса
  OUTPUT_FULL         // склад объекта заполнен
  EQUIPMENT_BROKEN    // прочность оборудования 0
  NEGATIVE_BALANCE    // баланс объекта в минусе
  OBJECT_DAMAGED      // объект повреждён
  PROFILE_SWITCHING   // идёт смена профиля
  LABOR_TIMEOUT       // труд не набран за отведённое время
}

enum ResourceQuality { POOR NORMAL FINE }

enum FarmPlotStatus {
  LOCKED        // участок не куплен
  EMPTY         // куплен, пуст
  GROWING       // растёт
  READY         // созрел
  WITHERED      // засох, нужна перекопка
  BUILDING      // занят постройкой
}

enum FarmBuildingType {
  WATER_BARREL  // бочка: заменяет один полив соседям
  CANOPY        // навес: минус 10% времени созревания соседям
  CELLAR        // погреб: хранит урожай, плюс 10% к цене продажи
  DOG           // собака: защита соседних грядок, задел Этапа 4
}

enum BarItemCategory { FOOD DRINK STIMULANT }

enum ClanRole { LEADER BRIGADIER FIGHTER ROOKIE }

enum ClanPermissionCode {
  INVITE KICK ROLE_SET
  STORAGE_PUT STORAGE_TAKE
  TREASURY_DEPOSIT TREASURY_SPEND
  RELATION_SET OBJECT_MANAGE CLAN_EDIT
}

enum ClanRelationState { NEUTRAL ALLY ENEMY }

enum ClanLogAction {
  MEMBER_JOINED MEMBER_LEFT MEMBER_KICKED ROLE_CHANGED
  STORAGE_PUT STORAGE_TAKE
  TREASURY_DEPOSIT TREASURY_SPEND
  RELATION_CHANGED OBJECT_LINKED CLAN_EDITED
}
```

## 12. Расширение существующих enum

```prisma
enum ProductionObjectType {
  FACTORY WORKSHOP MARKET WAREHOUSE SCRAPYARD SERVICE
  BAR       // NEW
  KOLHOZ    // NEW
}

enum ProductionLogEvent {
  SHIFT_STARTED SHIFT_READY SHIFT_CLAIMED SHIFT_CANCELLED SHIFT_FAILED
  OBJECT_STATUS_CHANGED
  CYCLE_STARTED CYCLE_COMPLETED CYCLE_FAILED          // NEW
  OBJECT_OWNERSHIP_CHANGED OBJECT_BALANCE_CHANGED     // NEW
  PROFILE_SWITCHED EQUIPMENT_WORN EQUIPMENT_REPAIRED  // NEW
  RESTORATION_SHIFT                                   // NEW
}

enum CurrencyLogReason {
  // существующие значения Этапа 2 остаются
  OBJECT_PURCHASE OBJECT_SALE
  OBJECT_BALANCE_TOP_UP OBJECT_WITHDRAW OBJECT_WITHDRAW_TAX
  SALARY_FROM_OBJECT
  BAR_SALE BAR_PURCHASE BAR_TAX
  FARM_WITHDRAW FARM_PLOT_PURCHASE FARM_BUILDING_PURCHASE
  CLAN_CREATION CLAN_DEPOSIT CLAN_SPEND CLAN_MAINTENANCE
  MARKET_RELATION_MARKUP
}

enum ResourceLogReason {
  // существующие значения Этапа 2 остаются
  CYCLE_INPUT CYCLE_OUTPUT
  OBJECT_STOCK_PUT OBJECT_STOCK_TAKE
  FARM_HARVEST BAR_INPUT CRAFT_INPUT
  CLAN_STORAGE_PUT CLAN_STORAGE_TAKE
  EQUIPMENT_REPAIR
}
```

## 13. Производственные цепочки

```prisma
model ProductionRecipe {
  id                      String   @id @default(uuid())
  code                    String   @unique
  name                    String
  productionObjectCode    String   @map("production_object_code")
  outputResourceCode      String?  @map("output_resource_code")
  outputItemTemplateCode  String?  @map("output_item_template_code")
  outputAmount            Int      @default(1) @map("output_amount")
  cycleMinutes            Int      @map("cycle_minutes")
  laborRequired           Int      @map("labor_required")
  requiredProfessionCode  String   @map("required_profession_code")
  requiredProfessionLevel Int      @default(0) @map("required_profession_level")
  requiredToolTier        Int      @default(1) @map("required_tool_tier")
  isActive                Boolean  @default(true) @map("is_active")
  createdAt               DateTime @default(now()) @map("created_at")
  inputs                  ProductionRecipeInput[]
  cycles                  ProductionCycle[]

  @@index([productionObjectCode])
  @@map("production_recipes")
}

model ProductionRecipeInput {
  id           String @id @default(uuid())
  recipeId     String @map("recipe_id")
  resourceCode String @map("resource_code")
  amount       Int
  minQuality   ResourceQuality @default(POOR) @map("min_quality")
  recipe       ProductionRecipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@unique([recipeId, resourceCode])
  @@map("production_recipe_inputs")
}
```

**Инвариант, который Prisma не выражает:** ровно одно из `outputResourceCode` и
`outputItemTemplateCode` должно быть заполнено. Проверяется в сервисе и тестом
сида:

```ts
// backend/src/tests/unit/recipe-integrity.test.ts
it('у каждого рецепта ровно один вид выхода', () => {
  for (const recipe of PRODUCTION_RECIPES) {
    const hasResource = Boolean(recipe.outputResourceCode)
    const hasItem = Boolean(recipe.outputItemTemplateCode)
    expect(hasResource !== hasItem, `рецепт ${recipe.code}`).toBe(true)
  }
})
```

Рецепт с пустым списком `inputs` — добыча первичного сырья, то есть текущее
поведение Этапа 2. Такие рецепты сид создаёт для всех существующих объектов,
поэтому включение цепочек **не меняет** поведение живого прода.

```prisma
model ProductionObjectInventory {
  id                 String   @id @default(uuid())
  productionObjectId String   @map("production_object_id")
  resourceCode       String   @map("resource_code")
  quality            ResourceQuality @default(NORMAL)
  amount             Int      @default(0)
  reservedAmount     Int      @default(0) @map("reserved_amount")
  updatedAt          DateTime @updatedAt @map("updated_at")
  productionObject   ProductionObject @relation(fields: [productionObjectId], references: [id], onDelete: Cascade)

  @@unique([productionObjectId, resourceCode, quality])
  @@index([productionObjectId])
  @@map("production_object_inventory")
}

model ProductionCycle {
  id                 String    @id @default(uuid())
  productionObjectId String    @map("production_object_id")
  recipeId           String    @map("recipe_id")
  status             ProductionCycleStatus @default(PENDING)
  laborRequired      Int       @map("labor_required")
  laborAccumulated   Int       @default(0) @map("labor_accumulated")
  startedAt          DateTime? @map("started_at")
  endsAt             DateTime? @map("ends_at")
  completedAt        DateTime? @map("completed_at")
  failureReason      ProductionCycleFailure? @map("failure_reason")
  outputQuality      ResourceQuality? @map("output_quality")
  createdAt          DateTime  @default(now()) @map("created_at")
  productionObject   ProductionObject @relation(fields: [productionObjectId], references: [id], onDelete: Cascade)
  recipe             ProductionRecipe @relation(fields: [recipeId], references: [id])
  contributions      CycleLaborContribution[]

  @@index([productionObjectId, status])
  @@index([status, endsAt])
  @@map("production_cycles")
}

model CycleLaborContribution {
  id              String   @id @default(uuid())
  cycleId         String   @map("cycle_id")
  characterId     String   @map("character_id")
  workShiftId     String   @unique @map("work_shift_id")
  laborMinutes    Int      @map("labor_minutes")
  professionLevel Int      @map("profession_level")
  toolTier        Int      @default(0) @map("tool_tier")
  createdAt       DateTime @default(now()) @map("created_at")
  cycle           ProductionCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)

  @@index([cycleId])
  @@index([characterId])
  @@map("cycle_labor_contributions")
}
```

`workShiftId` объявлен уникальным намеренно: одна смена вкладывается ровно в
один цикл. Это защита от двойного зачёта труда при повторе операции — база не
даст записать вклад дважды даже при гонке.

## 14. Расширение объекта и оборудования

```prisma
model ProductionObject {
  // все существующие поля Этапа 2 остаются без изменений
  purchasePrice          Int?      @map("purchase_price")
  isForSale              Boolean   @default(false) @map("is_for_sale")
  storageCapacity        Int       @default(0) @map("storage_capacity")
  activeRecipeId         String?   @map("active_recipe_id")
  profileSwitchingUntil  DateTime? @map("profile_switching_until")
  salaryOverride         Int?      @map("salary_override")
  maintenanceDebt        Int       @default(0) @map("maintenance_debt")
  lastCycleAt            DateTime? @map("last_cycle_at")
  inventory              ProductionObjectInventory[]
  cycles                 ProductionCycle[]
}

model ProductionEquipment {
  // существующие поля
  durabilityCurrent Int @default(100) @map("durability_current")
  durabilityMax     Int @default(100) @map("durability_max")
  // ownerType и ownerCharacterId существуют с Этапа 2, теперь используются
}
```

## 15. Качество ресурсов

```prisma
model ResourceStack {
  // существующие поля
  quality ResourceQuality @default(NORMAL)

  // было:  @@unique([characterId, resourceTemplateId])
  @@unique([characterId, resourceTemplateId, quality])
}
```

Единственное неаддитивное изменение этапа. Влияние на код: все обращения к
стеку по составному ключу получают третий компонент. Затрагиваются
`resources.service.ts` (`add`, `consume`, `reserve`, `release`),
`market.service.ts`, `repair.routes.ts`, `upgrades.service.ts`.

Совместимость обеспечивается значением по умолчанию: вызовы, не передающие
качество, работают с `NORMAL`.

```ts
// backend/src/modules/resources/resources.service.ts — сигнатура после правки
async add(tx: Prisma.TransactionClient, params: {
  characterId: string
  resourceTemplateId: string
  amount: number
  quality?: ResourceQuality        // новое, по умолчанию NORMAL
  reasonCode: ResourceLogReason
  refType?: string
  refId?: string
})
```

## 16. Ферма

```prisma
model Farm {
  id          String   @id @default(uuid())
  characterId String   @unique @map("character_id")
  balance     Int      @default(0)
  plotsOwned  Int      @default(1) @map("plots_owned")
  createdAt   DateTime @default(now()) @map("created_at")
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  plots       FarmPlot[]

  @@map("farms")
}

model FarmPlot {
  id            String    @id @default(uuid())
  farmId        String    @map("farm_id")
  index         Int
  status        FarmPlotStatus @default(LOCKED)
  plantCode     String?   @map("plant_code")
  plantedAt     DateTime? @map("planted_at")
  readyAt       DateTime? @map("ready_at")
  withersAt     DateTime? @map("withers_at")
  waterCount    Int       @default(0) @map("water_count")
  lastWateredAt DateTime? @map("last_watered_at")
  buildingType  FarmBuildingType? @map("building_type")
  farm          Farm      @relation(fields: [farmId], references: [id], onDelete: Cascade)

  @@unique([farmId, index])
  @@index([status, readyAt])
  @@map("farm_plots")
}

model PlantTemplate {
  id                      String  @id @default(uuid())
  code                    String  @unique
  name                    String
  growMinutes             Int     @map("grow_minutes")
  outputResourceCode      String  @map("output_resource_code")
  outputAmountMin         Int     @map("output_amount_min")
  outputAmountMax         Int     @map("output_amount_max")
  seedPrice               Int     @map("seed_price")
  requiredProfessionLevel Int     @default(0) @map("required_profession_level")
  expPlant                Int     @map("exp_plant")
  expWater                Int     @map("exp_water")
  expHarvest              Int     @map("exp_harvest")
  isActive                Boolean @default(true) @map("is_active")

  @@map("plant_templates")
}
```

Сетка участков — четыре в ряд, до двенадцати. Соседство считается по индексу:
у участка `i` соседи `i-1` и `i+1` в том же ряду, `i-4` и `i+4` в соседних.

## 17. Бары

```prisma
model BarRecipe {
  id                      String  @id @default(uuid())
  code                    String  @unique
  name                    String
  category                BarItemCategory
  hpRestore               Int     @default(0) @map("hp_restore")
  intoxication            Int     @default(0)
  buffCode                String? @map("buff_code")
  buffMinutes             Int     @default(0) @map("buff_minutes")
  costHint                Int     @map("cost_hint")
  requiredProfessionLevel Int     @default(0) @map("required_profession_level")
  inputs                  BarRecipeInput[]

  @@map("bar_recipes")
}

model BarRecipeInput {
  id           String @id @default(uuid())
  recipeId     String @map("recipe_id")
  resourceCode String @map("resource_code")
  amount       Int
  recipe       BarRecipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@unique([recipeId, resourceCode])
  @@map("bar_recipe_inputs")
}

model BarMenuItem {
  id                 String   @id @default(uuid())
  productionObjectId String   @map("production_object_id")
  recipeCode         String   @map("recipe_code")
  price              Int
  isActive           Boolean  @default(true) @map("is_active")
  soldTotal          Int      @default(0) @map("sold_total")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@unique([productionObjectId, recipeCode])
  @@map("bar_menu_items")
}
```

## 18. Опьянение

```prisma
model Character {
  // существующие поля
  intoxication          Int       @default(0)
  intoxicationUpdatedAt DateTime? @map("intoxication_updated_at")
  hangoverUntil         DateTime? @map("hangover_until")
  clanId                String?   @map("clan_id")   // поле существует с Этапа 2
}
```

**Решение о хранении.** Градус не хранится живым значением. Он пересчитывается
при каждом чтении от `intoxicationUpdatedAt`, а воркер раз в пять минут
материализует его для аналитики и админки. Это исключает расхождение между тем,
что показано игроку, и тем, что применилось в бою — иначе неизбежны жалобы
вида «я был трезвый, а получил штраф».

## 19. Кланы

```prisma
model Clan {
  id              String   @id @default(uuid())
  code            String   @unique
  name            String   @unique
  motto           String?
  avatarCode      String?  @map("avatar_code")
  leaderId        String   @map("leader_id")
  level           Int      @default(1)
  exp             Int      @default(0)
  treasury        Int      @default(0)
  storageCapacity Int      @default(30) @map("storage_capacity")
  memberLimit     Int      @default(10) @map("member_limit")
  maintenanceDebt Int      @default(0) @map("maintenance_debt")
  isFrozen        Boolean  @default(false) @map("is_frozen")
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")
  members         ClanMember[]
  storageItems    ClanStorageItem[]
  logs            ClanLog[]

  @@map("clans")
}

model ClanMember {
  id          String   @id @default(uuid())
  clanId      String   @map("clan_id")
  characterId String   @unique @map("character_id")
  role        ClanRole @default(ROOKIE)
  joinedAt    DateTime @default(now()) @map("joined_at")
  takenToday  Int      @default(0) @map("taken_today")
  spentToday  Int      @default(0) @map("spent_today")
  countersDay String?  @map("counters_day")
  contributed Int      @default(0)
  clan        Clan     @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId, role])
  @@map("clan_members")
}

model ClanRolePermission {
  id         String @id @default(uuid())
  clanId     String @map("clan_id")
  role       ClanRole
  permission ClanPermissionCode

  @@unique([clanId, role, permission])
  @@map("clan_role_permissions")
}

model ClanStorageItem {
  id               String   @id @default(uuid())
  clanId           String   @map("clan_id")
  itemInstanceId   String?  @unique @map("item_instance_id")
  resourceCode     String?  @map("resource_code")
  quality          ResourceQuality?
  amount           Int      @default(1)
  putByCharacterId String   @map("put_by_character_id")
  putAt            DateTime @default(now()) @map("put_at")
  clan             Clan     @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId])
  @@map("clan_storage_items")
}

model ClanLog {
  id          String   @id @default(uuid())
  clanId      String   @map("clan_id")
  actorId     String   @map("actor_id")
  action      ClanLogAction
  targetId    String?  @map("target_id")
  amount      Int?
  detailsJson Json?    @map("details_json")
  createdAt   DateTime @default(now()) @map("created_at")
  clan        Clan     @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId, createdAt])
  @@map("clan_logs")
}

model ClanRelation {
  id           String   @id @default(uuid())
  clanId       String   @map("clan_id")
  targetClanId String   @map("target_clan_id")
  state        ClanRelationState @default(NEUTRAL)
  confirmed    Boolean  @default(false)
  changedAt    DateTime @default(now()) @map("changed_at")
  changedBy    String   @map("changed_by")

  @@unique([clanId, targetClanId])
  @@index([targetClanId])
  @@map("clan_relations")
}

model ClanInvite {
  id          String   @id @default(uuid())
  clanId      String   @map("clan_id")
  characterId String   @map("character_id")
  invitedBy   String   @map("invited_by")
  expiresAt   DateTime @map("expires_at")
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([clanId, characterId])
  @@map("clan_invites")
}
```

**Решение о суточных счётчиках.** `takenToday` и `spentToday` хранятся в строке
участника вместе с `countersDay`. При операции текущая дата UTC сравнивается с
`countersDay`, и при несовпадении счётчики обнуляются в той же транзакции.
Redis здесь не используется намеренно: лимит выноса со склада должен переживать
сброс Redis, в отличие от суточного лимита смен, где потеря счётчика некритична.

Хранилище клана держит предметы и ресурсы в одной таблице: у предмета заполнен
`itemInstanceId`, у ресурса — `resourceCode` с количеством и качеством. Это
даёт единый журнал и единый лимит вместимости вместо двух почти одинаковых
подсистем.

---

# Часть IV. Модули бэкенда

Каждый раздел устроен одинаково: **что сейчас в коде → что делаем → код →
как проверяем**. Код приводится в том стиле, в каком написаны
`economy.service.ts` и `resources.service.ts` — обычное форматирование, без
сжатия в одну строку (см. раздел 14 ТЗ доработки Этапа 2).

## 20. Модуль `production`: рецепты

### 20.1. Что сейчас

`backend/src/modules/production/production.service.ts` — 6 строк:

```ts
export const ProductionService = {
  list: async () => ({ items: await ProductionRepository.listActive() }),
  get: async (id: string) => {
    const item = await ProductionRepository.findActiveById(id)
    if (!item) throw ProductionErrors.notFound()
    return item
  },
}
```

Модуль умеет только читать справочник объектов. Вся логика работы живёт в
`work.service.ts`. Этап 3 превращает его в ядро производства.

### 20.2. Новый файл `recipe.service.ts`

```ts
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { previousProfession, isProfessionCode } from '../professions/professions'

export const RecipeService = {
  /** Рецепты объекта с пометкой, доступен ли каждый персонажу. */
  async listForObject(objectCode: string, characterId: string) {
    const [recipes, professions] = await Promise.all([
      prisma.productionRecipe.findMany({
        where: { productionObjectCode: objectCode, isActive: true },
        include: { inputs: true },
      }),
      prisma.characterProfession.findMany({ where: { characterId } }),
    ])
    const levelOf = new Map(professions.map(p => [p.professionCode, p.level]))

    return recipes.map(recipe => {
      const own = levelOf.get(recipe.requiredProfessionCode) ?? 0
      return {
        ...recipe,
        available: own >= recipe.requiredProfessionLevel,
        missingLevel: Math.max(0, recipe.requiredProfessionLevel - own),
      }
    })
  },

  /**
   * Проверка целостности рецепта. Prisma не выражает правило
   * «ровно один вид выхода», поэтому оно проверяется здесь и в тесте сида.
   */
  assertOutputShape(recipe: { outputResourceCode: string | null; outputItemTemplateCode: string | null }) {
    const hasResource = Boolean(recipe.outputResourceCode)
    const hasItem = Boolean(recipe.outputItemTemplateCode)
    if (hasResource === hasItem) {
      throw new AppError(ErrorCode.PROD_RECIPE_INVALID, 'Recipe must produce exactly one kind of output', 500)
    }
  },
}
```

### 20.3. Проверка

Unit-тест `recipe-integrity.test.ts` проходит по таблице сида и падает, если
рецепт производит и ресурс, и предмет одновременно или ничего.

---

## 21. Модуль `production`: склад объекта

### 21.1. Что делаем

Склад объекта — точная копия механики `ResourceStack`, но привязанная к объекту,
а не к персонажу, и с ограничением по вместимости в единицах веса.

### 21.2. `inventory.service.ts`

```ts
import type { Prisma, ResourceQuality } from '@prisma/client'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export const ObjectInventoryService = {
  /** Занятый объём склада в единицах веса. */
  async usedCapacity(tx: Prisma.TransactionClient, objectId: string): Promise<number> {
    const rows = await tx.productionObjectInventory.findMany({
      where: { productionObjectId: objectId },
    })
    if (rows.length === 0) return 0
    const templates = await tx.resourceTemplate.findMany({
      where: { code: { in: rows.map(r => r.resourceCode) } },
      select: { code: true, weight: true },
    })
    const weightOf = new Map(templates.map(t => [t.code, t.weight]))
    return rows.reduce((sum, row) => sum + row.amount * (weightOf.get(row.resourceCode) ?? 0), 0)
  },

  async put(tx: Prisma.TransactionClient, params: {
    objectId: string; resourceCode: string; quality: ResourceQuality; amount: number; capacity: number
  }) {
    const template = await tx.resourceTemplate.findUniqueOrThrow({
      where: { code: params.resourceCode }, select: { weight: true },
    })
    const used = await this.usedCapacity(tx, params.objectId)
    if (used + params.amount * template.weight > params.capacity) {
      throw new AppError(ErrorCode.PROD_STORAGE_FULL, 'Object storage is full', 409)
    }
    return tx.productionObjectInventory.upsert({
      where: {
        productionObjectId_resourceCode_quality: {
          productionObjectId: params.objectId,
          resourceCode: params.resourceCode,
          quality: params.quality,
        },
      },
      update: { amount: { increment: params.amount } },
      create: {
        productionObjectId: params.objectId,
        resourceCode: params.resourceCode,
        quality: params.quality,
        amount: params.amount,
      },
    })
  },

  /** Резерв входа цикла: условный апдейт, чтобы два цикла не забрали одно сырьё. */
  async reserve(tx: Prisma.TransactionClient, objectId: string, resourceCode: string, amount: number) {
    const changed = await tx.productionObjectInventory.updateMany({
      where: {
        productionObjectId: objectId,
        resourceCode,
        // доступно = amount - reservedAmount, выражаем через сырой фильтр
        amount: { gte: amount },
      },
      data: { reservedAmount: { increment: amount } },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.PROD_INPUT_MISSING, 'Not enough input resource', 409)
    }
    const row = await tx.productionObjectInventory.findFirstOrThrow({
      where: { productionObjectId: objectId, resourceCode },
    })
    if (row.reservedAmount > row.amount) {
      throw new AppError(ErrorCode.PROD_INVARIANT, 'Object inventory invariant violated', 409)
    }
    return row
  },

  async consumeReserved(tx: Prisma.TransactionClient, objectId: string, resourceCode: string, amount: number) {
    const changed = await tx.productionObjectInventory.updateMany({
      where: {
        productionObjectId: objectId, resourceCode,
        amount: { gte: amount }, reservedAmount: { gte: amount },
      },
      data: { amount: { decrement: amount }, reservedAmount: { decrement: amount } },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.PROD_INVARIANT, 'Reserved consume failed', 409)
    }
  },

  async releaseReserved(tx: Prisma.TransactionClient, objectId: string, resourceCode: string, amount: number) {
    await tx.productionObjectInventory.updateMany({
      where: { productionObjectId: objectId, resourceCode, reservedAmount: { gte: amount } },
      data: { reservedAmount: { decrement: amount } },
    })
  },
}
```

**Замечание по проверке доступного остатка.** Prisma не позволяет сравнить две
колонки в `where`. Условие `amount >= reservedAmount + amount_нужный`
выражается либо сырым SQL, либо предварительным чтением с последующей проверкой
инварианта после апдейта — как сделано выше. Второй вариант выбран, потому что
он повторяет уже принятый в проекте подход (`ResourcesService.reserve` в
`resources.service.ts` делает так же), а транзакция `Serializable` защищает от
гонки.

---

## 22. Модуль `production`: формулы цикла

### 22.1. `cycle.formulas.ts` — чистые функции, без БД

```ts
import { BalanceConfig } from '../../config/balance.config'
import type { ResourceQuality } from '@prisma/client'

const P = BalanceConfig.economy.production

/** Человеко-минуты, которые смена вкладывает в цикл. */
export function laborFromShift(shiftDurationMinutes: number, workerEfficiency: number): number {
  return Math.round(shiftDurationMinutes * workerEfficiency)
}

/** Длительность цикла с учётом инструмента выше требуемого тира. */
export function cycleDurationMinutes(baseMinutes: number, toolTier: number, requiredToolTier: number): number {
  const bonus = Math.max(0, toolTier - requiredToolTier) * P.equipmentTierSpeedBonus
  return Math.max(1, Math.round(baseMinutes / (1 + bonus)))
}

/** Готов ли цикл к завершению: набран труд И прошло время. */
export function cycleReady(params: {
  laborAccumulated: number; laborRequired: number; endsAt: Date | null; now: Date
}): boolean {
  if (params.laborAccumulated < params.laborRequired) return false
  return params.endsAt !== null && params.endsAt <= params.now
}

const QUALITY_ORDER: ResourceQuality[] = ['POOR', 'NORMAL', 'FINE']

/**
 * Качество выхода. Из плохого сырья отличный продукт не выходит:
 * минимальное качество входа опускает результат на ступень.
 */
export function outputQuality(params: {
  professionLevel: number
  toolTier: number
  requiredToolTier: number
  minInputQuality: ResourceQuality | null
}): ResourceQuality {
  const inputBonus =
    params.minInputQuality === 'POOR' ? -1 :
    params.minInputQuality === 'FINE' ? +1 : 0
  const score = params.professionLevel * 0.5
    + (params.toolTier - params.requiredToolTier) * 1.0
    + inputBonus
  if (score < 0) return 'POOR'
  if (score >= 3) return 'FINE'
  return 'NORMAL'
}

export function isQualityAtLeast(actual: ResourceQuality, required: ResourceQuality): boolean {
  return QUALITY_ORDER.indexOf(actual) >= QUALITY_ORDER.indexOf(required)
}

/** Износ оборудования за один завершённый цикл. */
export function equipmentWear(): number {
  return P.equipmentWearPerCycle
}
```

### 22.2. Тесты формул

```ts
// backend/src/tests/unit/cycle.formulas.test.ts
describe('формулы производственного цикла', () => {
  it('инструмент выше тира ускоряет цикл', () => {
    expect(cycleDurationMinutes(60, 1, 1)).toBe(60)
    expect(cycleDurationMinutes(60, 2, 1)).toBe(52)   // 60 / 1.15
    expect(cycleDurationMinutes(60, 3, 1)).toBe(46)   // 60 / 1.30
  })

  it('цикл не готов, пока не набран труд', () => {
    const now = new Date('2026-08-16T12:00:00Z')
    const past = new Date('2026-08-16T11:00:00Z')
    expect(cycleReady({ laborAccumulated: 59, laborRequired: 60, endsAt: past, now })).toBe(false)
    expect(cycleReady({ laborAccumulated: 60, laborRequired: 60, endsAt: past, now })).toBe(true)
  })

  it('цикл не готов, пока не прошло время, даже при избытке труда', () => {
    const now = new Date('2026-08-16T12:00:00Z')
    const future = new Date('2026-08-16T13:00:00Z')
    expect(cycleReady({ laborAccumulated: 500, laborRequired: 60, endsAt: future, now })).toBe(false)
  })

  it('из плохого сырья мастер вытягивает только обычное', () => {
    expect(outputQuality({ professionLevel: 6, toolTier: 1, requiredToolTier: 1, minInputQuality: 'POOR' })).toBe('NORMAL')
  })

  it('новичок на плохом сырье делает плохое', () => {
    expect(outputQuality({ professionLevel: 0, toolTier: 1, requiredToolTier: 1, minInputQuality: 'POOR' })).toBe('POOR')
  })
})
```

---

## 23. Модуль `production`: жизненный цикл

### 23.1. Ключевое проектное решение

**Труд и время — две независимые оси.** Время идёт само (`cycleMinutes`), труд
набирается сменами. Цикл завершается, когда выполнены оба условия.

Отсюда главное свойство: **зарплата платится за смену, продукт считается за
цикл**. Рабочий получает деньги сразу и не зависит от простоя; владелец получает
продукт, когда цикл закрыт, и несёт риск. Это и есть разделение ролей, ради
которого вводится собственность.

### 23.2. `cycle.service.ts`

```ts
import type { Prisma } from '@prisma/client'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ObjectInventoryService } from './inventory.service'
import { cycleDurationMinutes, cycleReady, outputQuality, equipmentWear } from './cycle.formulas'
import { ResourcesService } from '../resources/resources.service'

export const CycleService = {
  /**
   * Попытка стартовать цикл. Вызывается воркером и вручную владельцем.
   * Возвращает либо созданный цикл, либо причину отказа — без исключения,
   * потому что воркер обходит десятки объектов и не должен падать на первом.
   */
  async tryStart(objectId: string) {
    return withTransaction(async tx => {
      const object = await tx.productionObject.findUniqueOrThrow({
        where: { id: objectId }, include: { equipment: true },
      })

      if (object.status === 'DAMAGED') return { failure: 'OBJECT_DAMAGED' as const }
      if (object.profileSwitchingUntil && object.profileSwitchingUntil > new Date()) {
        return { failure: 'PROFILE_SWITCHING' as const }
      }
      if (object.equipment && object.equipment.durabilityCurrent <= 0) {
        return { failure: 'EQUIPMENT_BROKEN' as const }
      }
      if (object.ownerType !== 'SYSTEM' && object.balance < 0) {
        return { failure: 'NEGATIVE_BALANCE' as const }
      }
      if (!object.activeRecipeId) return { failure: 'INPUT_MISSING' as const }

      // Не запускаем второй цикл на том же объекте.
      const running = await tx.productionCycle.count({
        where: { productionObjectId: objectId, status: { in: ['PENDING', 'RUNNING'] } },
      })
      if (running > 0) return { alreadyRunning: true as const }

      const recipe = await tx.productionRecipe.findUniqueOrThrow({
        where: { id: object.activeRecipeId }, include: { inputs: true },
      })

      // Резервируем весь вход. Любая неудача откатывает транзакцию целиком.
      try {
        for (const input of recipe.inputs) {
          await ObjectInventoryService.reserve(tx, objectId, input.resourceCode, input.amount)
        }
      } catch {
        return { failure: 'INPUT_MISSING' as const }
      }

      const cycle = await tx.productionCycle.create({
        data: {
          productionObjectId: objectId,
          recipeId: recipe.id,
          status: 'PENDING',
          laborRequired: recipe.laborRequired,
        },
      })

      await tx.productionLog.create({
        data: {
          characterId: object.ownerCharacterId,
          productionObjectId: objectId,
          eventType: 'CYCLE_STARTED',
          metadataJson: { cycleId: cycle.id, recipeCode: recipe.code, laborRequired: recipe.laborRequired },
        },
      })
      return { cycle }
    })
  },

  /**
   * Вклад труда от завершённой смены. Вызывается из WorkService.claim
   * внутри уже открытой транзакции — своей не открывает.
   */
  async contributeLabor(tx: Prisma.TransactionClient, params: {
    objectId: string; characterId: string; workShiftId: string
    laborMinutes: number; professionLevel: number; toolTier: number
  }) {
    const cycle = await tx.productionCycle.findFirst({
      where: { productionObjectId: params.objectId, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
      include: { recipe: true },
    })
    if (!cycle) return null

    // Уникальность workShiftId в схеме не даст записать вклад дважды.
    await tx.cycleLaborContribution.create({
      data: {
        cycleId: cycle.id,
        characterId: params.characterId,
        workShiftId: params.workShiftId,
        laborMinutes: params.laborMinutes,
        professionLevel: params.professionLevel,
        toolTier: params.toolTier,
      },
    })

    const updated = await tx.productionCycle.update({
      where: { id: cycle.id },
      data: { laborAccumulated: { increment: params.laborMinutes } },
    })

    // Труд набран впервые — запускаем отсчёт календарного времени.
    if (updated.status === 'PENDING' && updated.laborAccumulated >= updated.laborRequired) {
      const minutes = cycleDurationMinutes(cycle.recipe.cycleMinutes, params.toolTier, cycle.recipe.requiredToolTier)
      await tx.productionCycle.update({
        where: { id: cycle.id },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          endsAt: new Date(Date.now() + minutes * 60_000),
        },
      })
    }

    return { cycleId: cycle.id, laborAccumulated: updated.laborAccumulated, laborRequired: updated.laborRequired }
  },

  /** Завершение цикла: списание входа, зачисление выхода, износ оборудования. */
  async complete(cycleId: string) {
    return withTransaction(async tx => {
      // Условный апдейт — единственная защита от двойного завершения.
      const claimed = await tx.productionCycle.updateMany({
        where: { id: cycleId, status: 'RUNNING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
      if (claimed.count !== 1) return { alreadyCompleted: true as const }

      const cycle = await tx.productionCycle.findUniqueOrThrow({
        where: { id: cycleId },
        include: { recipe: { include: { inputs: true } }, contributions: true, productionObject: { include: { equipment: true } } },
      })

      for (const input of cycle.recipe.inputs) {
        await ObjectInventoryService.consumeReserved(tx, cycle.productionObjectId, input.resourceCode, input.amount)
      }

      const best = cycle.contributions.reduce(
        (acc, c) => ({ level: Math.max(acc.level, c.professionLevel), tier: Math.max(acc.tier, c.toolTier) }),
        { level: 0, tier: 0 },
      )
      const quality = outputQuality({
        professionLevel: best.level,
        toolTier: best.tier,
        requiredToolTier: cycle.recipe.requiredToolTier,
        minInputQuality: null,
      })

      if (cycle.recipe.outputResourceCode) {
        await ObjectInventoryService.put(tx, {
          objectId: cycle.productionObjectId,
          resourceCode: cycle.recipe.outputResourceCode,
          quality,
          amount: cycle.recipe.outputAmount,
          capacity: cycle.productionObject.storageCapacity,
        })
      } else if (cycle.recipe.outputItemTemplateCode && cycle.productionObject.ownerCharacterId) {
        const template = await tx.itemTemplate.findUniqueOrThrow({
          where: { code: cycle.recipe.outputItemTemplateCode },
        })
        await tx.itemInstance.create({
          data: {
            templateId: template.id,
            ownerId: cycle.productionObject.ownerCharacterId,
            durabilityCurrent: template.durabilityMax,
            sourceType: 'CRAFTED',
          },
        })
      }

      if (cycle.productionObject.equipment) {
        await tx.productionEquipment.update({
          where: { id: cycle.productionObject.equipment.id },
          data: { durabilityCurrent: { decrement: equipmentWear() } },
        })
      }

      await tx.productionCycle.update({ where: { id: cycleId }, data: { outputQuality: quality } })
      await tx.productionLog.create({
        data: {
          characterId: cycle.productionObject.ownerCharacterId,
          productionObjectId: cycle.productionObjectId,
          eventType: 'CYCLE_COMPLETED',
          metadataJson: { cycleId, quality, contributors: cycle.contributions.length },
        },
      })
      return { completed: true as const, quality }
    })
  },

  /** Отмена с возвратом резерва. Используется при таймауте труда. */
  async fail(cycleId: string, reason: 'LABOR_TIMEOUT' | 'OUTPUT_FULL' | 'EQUIPMENT_BROKEN') {
    return withTransaction(async tx => {
      const claimed = await tx.productionCycle.updateMany({
        where: { id: cycleId, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'FAILED', failureReason: reason },
      })
      if (claimed.count !== 1) return { alreadyClosed: true as const }

      const cycle = await tx.productionCycle.findUniqueOrThrow({
        where: { id: cycleId }, include: { recipe: { include: { inputs: true } } },
      })
      for (const input of cycle.recipe.inputs) {
        await ObjectInventoryService.releaseReserved(tx, cycle.productionObjectId, input.resourceCode, input.amount)
      }
      await tx.productionLog.create({
        data: {
          productionObjectId: cycle.productionObjectId,
          eventType: 'CYCLE_FAILED',
          metadataJson: { cycleId, reason },
        },
      })
      return { failed: true as const }
    })
  },
}
```

### 23.3. Что здесь защищает от гонок

| Место | Защита |
|---|---|
| Два цикла на одном объекте | подсчёт `PENDING/RUNNING` внутри `Serializable`-транзакции |
| Двойное завершение | `updateMany` с условием `status: 'RUNNING'`, проверка `count === 1` |
| Двойной зачёт труда | `workShiftId @unique` в схеме |
| Резерв входа | условный `updateMany` + проверка инварианта |
| Повтор HTTP-запроса | `withIdempotency` на уровне маршрута |

---

## 24. Модуль `production`: собственность

### 24.1. Покупка объекта

```ts
// backend/src/modules/production/ownership.service.ts
import { withIdempotency } from '../../shared/db/idempotency'
import { EconomyService } from '../economy/economy.service'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'

const P = BalanceConfig.economy.production

export const OwnershipService = {
  async buy(characterId: string, objectId: string, key: string) {
    return withIdempotency({ characterId, scope: 'objects.buy', key, execute: async tx => {
      const owned = await tx.productionObject.count({
        where: { ownerType: 'PRIVATE', ownerCharacterId: characterId },
      })
      if (owned >= P.maxObjectsPerCharacter) {
        throw new AppError(ErrorCode.PROD_OBJECT_LIMIT, 'Object limit reached', 409)
      }

      const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
      if (!object.isForSale || object.ownerType !== 'SYSTEM' || !object.purchasePrice) {
        throw new AppError(ErrorCode.PROD_NOT_FOR_SALE, 'Object is not for sale', 409)
      }

      const profession = await tx.characterProfession.findUnique({
        where: { characterId_professionCode: { characterId, professionCode: object.requiredProfessionCode } },
      })
      if ((profession?.level ?? 0) < object.requiredProfessionLevel) {
        throw new AppError(ErrorCode.PROD_PROFESSION_TOO_LOW, 'Profession level too low', 400)
      }

      // Условный апдейт: второй покупатель получит count = 0 и ошибку.
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerType: 'SYSTEM', isForSale: true },
        data: { ownerType: 'PRIVATE', ownerCharacterId: characterId, isForSale: false },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.PROD_ALREADY_SOLD, 'Object already sold', 409)
      }

      const newBalance = await EconomyService.debit(tx, {
        characterId, amount: object.purchasePrice,
        reasonCode: 'OBJECT_PURCHASE', refType: 'production_object', refId: objectId,
      })

      await tx.productionLog.create({
        data: {
          characterId, productionObjectId: objectId,
          eventType: 'OBJECT_OWNERSHIP_CHANGED',
          metadataJson: { from: 'SYSTEM', to: characterId, price: object.purchasePrice },
        },
      })
      return { objectId, newBalance }
    } })
  },

  /** Вывод прибыли владельцем: с налогом, который является стоком. */
  async withdraw(characterId: string, objectId: string, amount: number, key: string) {
    return withIdempotency({ characterId, scope: 'objects.withdraw', key, execute: async tx => {
      const claimed = await tx.productionObject.updateMany({
        where: { id: objectId, ownerCharacterId: characterId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.PROD_BALANCE_LOW, 'Object balance is too low', 409)
      }
      const tax = Math.floor(amount * P.objectWithdrawTaxRate)
      const payout = amount - tax
      const newBalance = await EconomyService.credit(tx, {
        characterId, amount: payout,
        reasonCode: 'OBJECT_WITHDRAW', refType: 'production_object', refId: objectId,
      })
      await tx.productionLog.create({
        data: {
          characterId, productionObjectId: objectId,
          eventType: 'OBJECT_BALANCE_CHANGED',
          metadataJson: { withdraw: amount, tax, payout },
        },
      })
      return { payout, tax, newBalance }
    } })
  },
}
```

### 24.2. Зарплата из баланса объекта

Правка `work.service.ts` в месте выплаты. Сейчас деньги эмитируются системой:

```ts
// backend/src/modules/work/work.service.ts — как сейчас
const newBalance = await EconomyService.credit(tx, {
  characterId, amount: salary, reasonCode: 'WORK_SALARY', ...
})
```

Становится:

```ts
const fromObject = shift.productionObject.ownerType !== 'SYSTEM'

if (fromObject) {
  // Пытаемся списать с баланса объекта.
  const paid = await tx.productionObject.updateMany({
    where: { id: shift.productionObjectId, balance: { gte: salary } },
    data: { balance: { decrement: salary } },
  })
  if (paid.count !== 1) {
    // Денег на объекте нет: платит система, долг записывается объекту.
    // Рабочий не должен терять деньги из-за чужой невнимательности.
    await tx.productionObject.update({
      where: { id: shift.productionObjectId },
      data: { maintenanceDebt: { increment: salary } },
    })
  }
}

const newBalance = await EconomyService.credit(tx, {
  characterId,
  amount: salary,
  reasonCode: fromObject ? 'SALARY_FROM_OBJECT' : 'WORK_SALARY',
  refType: 'work_shift',
  refId: shift.id,
})
```

**Обоснование защиты рабочего.** Альтернатива — не платить и откатить смену —
означала бы, что игрок потратил час реального времени и не получил ничего по
причине, на которую не влияет. Долг объекта гасится при первом пополнении
баланса владельцем.

---

## 25. Модуль `farm`

### 25.1. `farm.formulas.ts`

```ts
import { BalanceConfig } from '../../config/balance.config'
import type { FarmBuildingType } from '@prisma/client'

const F = BalanceConfig.economy.farm

/** Соседи участка в сетке по четыре в ряд. */
export function neighbourIndexes(index: number, total: number): number[] {
  const perRow = F.plotsPerRow
  const result: number[] = []
  if (index % perRow !== 0) result.push(index - 1)
  if (index % perRow !== perRow - 1) result.push(index + 1)
  result.push(index - perRow, index + perRow)
  return result.filter(i => i >= 0 && i < total)
}

/** Суммарный бонус соседних построек к скорости созревания. */
export function neighbourSpeedBonus(neighbourBuildings: (FarmBuildingType | null)[]): number {
  return neighbourBuildings.reduce((sum, building) => {
    if (building === 'CANOPY') return sum + F.buildingEffects.CANOPY
    return sum
  }, 0)
}

/** Момент созревания с учётом поливов и соседних построек. */
export function readyAt(params: {
  plantedAt: Date; growMinutes: number; waterCount: number; neighbourBonus: number
}): Date {
  const speedUp = Math.min(
    F.maxTotalSpeedUp,
    params.waterCount * F.waterSpeedBonus + params.neighbourBonus,
  )
  const minutes = params.growMinutes * (1 - speedUp)
  return new Date(params.plantedAt.getTime() + minutes * 60_000)
}

/**
 * Момент засыхания. Прогрессия снижает рутину: мастер собирает раз в день,
 * новичок бегает каждые шесть часов.
 */
export function withersAt(readyAt: Date, professionLevel: number): Date {
  const hours = F.witherBaseHours + professionLevel
  return new Date(readyAt.getTime() + hours * 3_600_000)
}

export function canWater(params: { lastWateredAt: Date | null; waterCount: number; now: Date }): boolean {
  if (params.waterCount >= F.waterMaxCount) return false
  if (!params.lastWateredAt) return true
  return params.now.getTime() - params.lastWateredAt.getTime() >= F.waterCooldownMinutes * 60_000
}

/** Цена следующего участка. Возвращает null, когда куплены все. */
export function nextPlotPrice(plotsOwned: number): number | null {
  return F.plotPrices[plotsOwned] ?? null
}
```

### 25.2. Полив: перерасчёт созревания

Полив сокращает **оставшееся** время, а не общее. Это важно: иначе полив за
минуту до созревания давал бы тот же эффект, что и сразу после посадки, и
оптимальной стратегией стало бы поливать в последний момент.

```ts
// backend/src/modules/farm/farm.service.ts
async water(characterId: string, index: number, key: string) {
  return withIdempotency({ characterId, scope: 'farm.water', key, execute: async tx => {
    const plot = await this.loadPlot(tx, characterId, index)
    if (plot.status !== 'GROWING') throw new AppError(ErrorCode.FARM_NOT_GROWING, 'Nothing to water', 409)

    const now = new Date()
    if (!canWater({ lastWateredAt: plot.lastWateredAt, waterCount: plot.waterCount, now })) {
      throw new AppError(ErrorCode.FARM_WATER_COOLDOWN, 'Watering is on cooldown', 409)
    }

    // Сокращаем именно остаток.
    const remainingMs = Math.max(0, plot.readyAt!.getTime() - now.getTime())
    const newReadyAt = new Date(now.getTime() + remainingMs * (1 - F.waterSpeedBonus))

    const plant = await tx.plantTemplate.findUniqueOrThrow({ where: { code: plot.plantCode! } })
    const profession = await tx.characterProfession.findUnique({
      where: { characterId_professionCode: { characterId, professionCode: 'procurer' } },
    })

    const updated = await tx.farmPlot.update({
      where: { id: plot.id },
      data: {
        waterCount: { increment: 1 },
        lastWateredAt: now,
        readyAt: newReadyAt,
        withersAt: withersAt(newReadyAt, profession?.level ?? 0),
      },
    })
    await this.grantProfessionExp(tx, characterId, plant.expWater)
    return { plot: updated }
  } })
}
```

### 25.3. Тесты формул фермы

```ts
// backend/src/tests/unit/farm.formulas.test.ts
describe('формулы фермы', () => {
  it('соседи в сетке по четыре считаются без выхода за край', () => {
    expect(neighbourIndexes(0, 12)).toEqual([1, 4])
    expect(neighbourIndexes(3, 12)).toEqual([2, 7])
    expect(neighbourIndexes(5, 12)).toEqual([4, 6, 1, 9])
  })

  it('засыхание отодвигается уровнем профессии', () => {
    const ready = new Date('2026-08-16T12:00:00Z')
    expect(withersAt(ready, 0).toISOString()).toBe('2026-08-16T18:00:00.000Z')
    expect(withersAt(ready, 6).toISOString()).toBe('2026-08-17T00:00:00.000Z')
  })

  it('ускорение ограничено потолком', () => {
    const planted = new Date('2026-08-16T12:00:00Z')
    const result = readyAt({ plantedAt: planted, growMinutes: 100, waterCount: 3, neighbourBonus: 0.30 })
    // 3 полива по 10% плюс 30% соседей = 60%, но потолок 50%
    expect(result.getTime() - planted.getTime()).toBe(50 * 60_000)
  })
})
```

---

## 26. Модуль `intoxication`

### 26.1. Как выбран масштаб

Числа привязаны к шагу существующей прогрессии, а не назначены на глаз. В
`upgrades.formulas.ts` одна ступень улучшения даёт `+0.01` к точности, `+4%` к
урону или `+6%` к броне; ступеней пять. Любой эффект бара, превышающий
пару-тройку ступеней, обесценивает улучшения, ради которых игрок работает и
тратит детали.

**Правило масштаба: весь размен опьянения по модулю не больше четырёх ступеней
улучшения.**

### 26.2. `intoxication.formulas.ts`

```ts
import { BalanceConfig } from '../../config/balance.config'

const I = BalanceConfig.character.intoxication

export interface IntoxicationEffect {
  tier: 'SOBER' | 'TIPSY' | 'DRUNK' | 'WASTED'
  name: string
  accuracyDelta: number      // абсолютные единицы, базовая точность 0.60–0.85
  damageTakenMultiplier: number
  damageDealtMultiplier: number
  canInitiateBattle: boolean
}

/** Текущий градус с учётом протрезвления от момента последнего изменения. */
export function currentIntoxication(stored: number, updatedAt: Date | null, now: Date): number {
  if (!updatedAt || stored <= 0) return 0
  const hours = (now.getTime() - updatedAt.getTime()) / 3_600_000
  return Math.max(0, Math.round(stored - I.soberPerHour * hours))
}

export function effectFor(value: number): IntoxicationEffect {
  if (value <= 0) {
    return { tier: 'SOBER', name: 'Трезв', accuracyDelta: 0,
             damageTakenMultiplier: 1, damageDealtMultiplier: 1, canInitiateBattle: true }
  }
  if (value < 30) {
    return { tier: 'TIPSY', name: 'Навеселе', accuracyDelta: -0.01,
             damageTakenMultiplier: 0.98, damageDealtMultiplier: 1.02, canInitiateBattle: true }
  }
  if (value < 70) {
    return { tier: 'DRUNK', name: 'Пьяный', accuracyDelta: -0.02,
             damageTakenMultiplier: 0.96, damageDealtMultiplier: 1, canInitiateBattle: true }
  }
  return { tier: 'WASTED', name: 'В хлам', accuracyDelta: -0.04,
           damageTakenMultiplier: 0.94, damageDealtMultiplier: 1, canInitiateBattle: false }
}

/** Похмелье наступает при выходе из верхней ступени. */
export function hangoverStarts(previous: number, next: number): boolean {
  return previous >= 70 && next < 70
}
```

### 26.3. Встраивание в бой

`battle.formulas.ts` получает модификаторы там, где уже считаются точность и
урон. Точка врезки — расчёт попадания и итогового урона по зоне.

```ts
// backend/src/modules/battles/battle.formulas.ts
export function calcHitChance(params: {
  weaponAccuracy: number
  targetDodge: number
  intoxicationAccuracyDelta?: number   // новое
  hangoverAccuracyDelta?: number       // новое
}): number {
  const accuracy = params.weaponAccuracy
    + (params.intoxicationAccuracyDelta ?? 0)
    + (params.hangoverAccuracyDelta ?? 0)
  // остальной расчёт без изменений
}

export function calcFinalDamage(params: {
  rawDamage: number
  armor: number
  intoxicationDamageTaken?: number     // новое, множитель цели
  intoxicationDamageDealt?: number     // новое, множитель атакующего
}): number {
  const afterArmor = params.rawDamage * (1 - params.armor / (params.armor + 50))
  return Math.round(afterArmor
    * (params.intoxicationDamageDealt ?? 1)
    * (params.intoxicationDamageTaken ?? 1))
}
```

**Правило, которое обязательно соблюсти:** в бою градус не растёт. Напиток,
использованный в бою, лечит, но не пьянит. Иначе боец переключает ступени
посреди раунда, и расчёт раунда перестаёт быть детерминированным относительно
момента начала.

### 26.4. Приёмка боевого эффекта

Прогон `scripts/simulate-apeha-matrix.ts` с каждой ступенью. Критерий: пьяный
боец не выигрывает у равного трезвого чаще, чем в **52%** случаев. Порог узкий
намеренно: при 55% и выше опьянение перестаёт быть выбором и становится
обязательным для всех.

---

## 27. Модуль `bars`

### 27.1. Коридор цен владельца

```ts
// backend/src/modules/bars/bars.formulas.ts
import { BalanceConfig } from '../../config/balance.config'

const B = BalanceConfig.economy.bar

export function priceRange(costHint: number): { min: number; max: number } {
  return { min: costHint, max: Math.round(costHint * B.priceMarkupMax) }
}

export function isPriceAllowed(price: number, costHint: number): boolean {
  const range = priceRange(costHint)
  return price >= range.min && price <= range.max
}

export function saleTax(price: number): number {
  return Math.floor(price * B.saleTaxRate)
}
```

### 27.2. Покупка позиции

```ts
// backend/src/modules/bars/bars.service.ts
async buy(characterId: string, objectId: string, recipeCode: string, key: string) {
  return withIdempotency({ characterId, scope: 'bar.buy', key, execute: async tx => {
    const character = await tx.character.findUniqueOrThrow({ where: { id: characterId } })
    if (character.status === 'IN_BATTLE') {
      throw new AppError(ErrorCode.BAR_IN_BATTLE, 'Cannot use a bar during a battle', 409)
    }
    if (character.hangoverUntil && character.hangoverUntil > new Date()) {
      throw new AppError(ErrorCode.BAR_HANGOVER, 'Hangover: drinking is blocked', 409)
    }

    const menuItem = await tx.barMenuItem.findUniqueOrThrow({
      where: { productionObjectId_recipeCode: { productionObjectId: objectId, recipeCode } },
    })
    if (!menuItem.isActive) throw new AppError(ErrorCode.BAR_ITEM_INACTIVE, 'Item is not available', 409)

    const recipe = await tx.barRecipe.findUniqueOrThrow({
      where: { code: recipeCode }, include: { inputs: true },
    })

    // Списываем ингредиенты со склада бара: нет снабжения — нет напитка.
    for (const input of recipe.inputs) {
      await ObjectInventoryService.consumeAny(tx, objectId, input.resourceCode, input.amount)
    }

    // Деньги: покупатель платит, владелец получает за вычетом налога.
    const object = await tx.productionObject.findUniqueOrThrow({ where: { id: objectId } })
    const buyerBalance = await EconomyService.debit(tx, {
      characterId, amount: menuItem.price,
      reasonCode: 'BAR_PURCHASE', refType: 'bar_menu_item', refId: menuItem.id,
    })
    const tax = saleTax(menuItem.price)
    await tx.productionObject.update({
      where: { id: objectId },
      data: { balance: { increment: menuItem.price - tax } },
    })

    // Эффекты на персонажа.
    const healed = Math.min(recipe.hpRestore, character.hpMax - character.hpCurrent)
    const nextIntoxication = Math.min(100,
      currentIntoxication(character.intoxication, character.intoxicationUpdatedAt, new Date()) + recipe.intoxication)

    await tx.character.update({
      where: { id: characterId },
      data: {
        hpCurrent: { increment: healed },
        intoxication: nextIntoxication,
        intoxicationUpdatedAt: new Date(),
      },
    })

    await tx.barMenuItem.update({ where: { id: menuItem.id }, data: { soldTotal: { increment: 1 } } })

    return {
      healed,
      intoxication: { value: nextIntoxication, ...effectFor(nextIntoxication) },
      buyerBalance,
    }
  } })
}
```

---

## 28. Модуль `clans`

### 28.1. Матрица прав вместо роли

Проверяется **право**, а не роль. Роль — именованный набор прав, который главарь
может перенастроить под свой уклад.

```ts
// backend/src/modules/clans/clans.permissions.ts
import type { ClanPermissionCode, ClanRole } from '@prisma/client'

export const DEFAULT_ROLE_PERMISSIONS: Record<ClanRole, ClanPermissionCode[]> = {
  LEADER: ['INVITE', 'KICK', 'ROLE_SET', 'STORAGE_PUT', 'STORAGE_TAKE',
           'TREASURY_DEPOSIT', 'TREASURY_SPEND', 'RELATION_SET', 'OBJECT_MANAGE', 'CLAN_EDIT'],
  BRIGADIER: ['INVITE', 'KICK', 'STORAGE_PUT', 'STORAGE_TAKE',
              'TREASURY_DEPOSIT', 'TREASURY_SPEND', 'OBJECT_MANAGE'],
  FIGHTER: ['STORAGE_PUT', 'STORAGE_TAKE', 'TREASURY_DEPOSIT'],
  ROOKIE: ['STORAGE_PUT', 'TREASURY_DEPOSIT'],
}

/**
 * Главарь не может отнять у себя право назначать роли: иначе клан
 * становится неуправляемым и требует вмешательства администратора.
 */
export function assertPermissionEditable(role: ClanRole, permission: ClanPermissionCode): void {
  if (role === 'LEADER' && permission === 'ROLE_SET') {
    throw new AppError(ErrorCode.CLAN_PERMISSION_LOCKED, 'Leader cannot drop ROLE_SET', 400)
  }
}
```

### 28.2. Проверка права и суточных лимитов

```ts
// backend/src/modules/clans/clans.service.ts
async function requirePermission(
  tx: Prisma.TransactionClient, characterId: string, permission: ClanPermissionCode,
) {
  const member = await tx.clanMember.findUnique({ where: { characterId } })
  if (!member) throw new AppError(ErrorCode.CLAN_NOT_MEMBER, 'Not a clan member', 403)

  const granted = await tx.clanRolePermission.findUnique({
    where: { clanId_role_permission: { clanId: member.clanId, role: member.role, permission } },
  })
  if (!granted) throw new AppError(ErrorCode.CLAN_NO_PERMISSION, 'Permission denied', 403)
  return member
}

/**
 * Суточные счётчики живут в строке участника, а не в Redis: лимит выноса
 * со склада обязан переживать сброс Redis.
 */
async function rollDailyCounters(tx: Prisma.TransactionClient, memberId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const member = await tx.clanMember.findUniqueOrThrow({ where: { id: memberId } })
  if (member.countersDay === today) return member
  return tx.clanMember.update({
    where: { id: memberId },
    data: { countersDay: today, takenToday: 0, spentToday: 0 },
  })
}
```

### 28.3. Вынос со склада под лимитом

```ts
// backend/src/modules/clans/clan-storage.service.ts
async take(characterId: string, storageItemId: string, key: string) {
  return withIdempotency({ characterId, scope: 'clan.storage.take', key, execute: async tx => {
    const member = await requirePermission(tx, characterId, 'STORAGE_TAKE')
    const fresh = await rollDailyCounters(tx, member.id)

    const limit = BalanceConfig.economy.clan.storageTakeDailyLimit[member.role]
    if (fresh.takenToday >= limit) {
      throw new AppError(ErrorCode.CLAN_TAKE_LIMIT, 'Daily storage limit reached', 409)
    }

    // Условный апдейт счётчика в той же транзакции: параллельный вынос
    // не сможет обойти лимит.
    const counted = await tx.clanMember.updateMany({
      where: { id: member.id, takenToday: { lt: limit } },
      data: { takenToday: { increment: 1 } },
    })
    if (counted.count !== 1) {
      throw new AppError(ErrorCode.CLAN_TAKE_LIMIT, 'Daily storage limit reached', 409)
    }

    const item = await tx.clanStorageItem.findUniqueOrThrow({ where: { id: storageItemId } })
    if (item.clanId !== member.clanId) {
      throw new AppError(ErrorCode.CLAN_NOT_MEMBER, 'Item belongs to another clan', 403)
    }

    if (item.itemInstanceId) {
      await tx.itemInstance.update({ where: { id: item.itemInstanceId }, data: { ownerId: characterId } })
    } else if (item.resourceCode) {
      const template = await tx.resourceTemplate.findUniqueOrThrow({ where: { code: item.resourceCode } })
      await ResourcesService.add(tx, {
        characterId, resourceTemplateId: template.id, amount: item.amount,
        quality: item.quality ?? 'NORMAL', reasonCode: 'CLAN_STORAGE_TAKE',
        refType: 'clan_storage', refId: item.id,
      })
    }

    await tx.clanStorageItem.delete({ where: { id: item.id } })
    await tx.clanLog.create({
      data: {
        clanId: member.clanId, actorId: characterId, action: 'STORAGE_TAKE',
        targetId: storageItemId, amount: item.amount,
        detailsJson: { resourceCode: item.resourceCode, itemInstanceId: item.itemInstanceId },
      },
    })
    return { taken: true, takenToday: fresh.takenToday + 1, limit }
  } })
}
```

### 28.4. Отношения кланов

```ts
// backend/src/modules/clans/clan-relations.service.ts
async set(characterId: string, targetClanCode: string, state: ClanRelationState) {
  return withTransaction(async tx => {
    const member = await requirePermission(tx, characterId, 'RELATION_SET')
    const target = await tx.clan.findUniqueOrThrow({ where: { code: targetClanCode } })
    if (target.id === member.clanId) {
      throw new AppError(ErrorCode.CLAN_SELF_RELATION, 'Cannot set relation to own clan', 400)
    }

    const existing = await tx.clanRelation.findUnique({
      where: { clanId_targetClanId: { clanId: member.clanId, targetClanId: target.id } },
    })
    const cooldownMs = BalanceConfig.economy.clan.relationChangeCooldownHours * 3_600_000
    if (existing && Date.now() - existing.changedAt.getTime() < cooldownMs) {
      throw new AppError(ErrorCode.CLAN_RELATION_COOLDOWN, 'Relation change is on cooldown', 409)
    }

    // ENEMY действует односторонне, ALLY требует подтверждения второй стороной.
    const mirror = await tx.clanRelation.findUnique({
      where: { clanId_targetClanId: { clanId: target.id, targetClanId: member.clanId } },
    })
    const confirmed = state === 'ALLY' ? mirror?.state === 'ALLY' : true

    const relation = await tx.clanRelation.upsert({
      where: { clanId_targetClanId: { clanId: member.clanId, targetClanId: target.id } },
      update: { state, confirmed, changedAt: new Date(), changedBy: characterId },
      create: { clanId: member.clanId, targetClanId: target.id, state, confirmed, changedBy: characterId },
    })

    // Если вторая сторона уже объявила союз — подтверждаем и её запись.
    if (state === 'ALLY' && mirror?.state === 'ALLY' && !mirror.confirmed) {
      await tx.clanRelation.update({ where: { id: mirror.id }, data: { confirmed: true } })
    }

    await tx.clanLog.create({
      data: { clanId: member.clanId, actorId: characterId, action: 'RELATION_CHANGED',
              targetId: target.id, detailsJson: { state, confirmed } },
    })
    return relation
  })
}
```

---

## 29. Цены на рынке по отношениям кланов

### 29.1. Формула

```ts
// backend/src/modules/market/market.formulas.ts
import { BalanceConfig } from '../../config/balance.config'

const C = BalanceConfig.economy.clan

export type MarketRelation = 'OWN' | 'ALLY' | 'NEUTRAL' | 'ENEMY'

export function relationModifier(relation: MarketRelation): number {
  if (relation === 'OWN') return -C.ownPriceDiscount        // -0.10
  if (relation === 'ALLY') return -C.allyPriceDiscount      // -0.05
  if (relation === 'ENEMY') return +C.enemyPriceMarkup      // +0.25
  return 0
}

export function finalPrice(price: number, relation: MarketRelation): number {
  return Math.max(1, Math.round(price * (1 + relationModifier(relation))))
}

/** Наценка врагу целиком уходит в налог, продавцу — обычная цена. */
export function relationMarkupTax(price: number, relation: MarketRelation): number {
  return relation === 'ENEMY' ? finalPrice(price, relation) - price : 0
}
```

### 29.2. Почему наценка идёт в налог, а не продавцу

Если бы продавец получал наценку, вражда стала бы источником дохода: два клана
объявляют друг друга врагами и торгуют между собой, снимая 25% сверху из
воздуха. Классический эксплойт социальных систем. Наценка уходит в сток, и
вражда остаётся тем, чем должна быть — неудобством.

Скидка, наоборот, уменьшает выручку продавца: он сознательно продаёт своим
дешевле. Это тоже сознательное решение — иначе скидка стала бы способом
переливать деньги между мультиаккаунтами в одном клане.

### 29.3. Врезка в покупку

```ts
// backend/src/modules/market/market.service.ts — в MarketService.buy
const relation = await resolveRelation(tx, buyerId, listing.sellerCharacterId)
const price = finalPrice(listing.price, relation)
const markupTax = relationMarkupTax(listing.price, relation)

const buyerBalance = await EconomyService.debit(tx, {
  characterId: buyerId, amount: price,
  reasonCode: 'MARKET_BUY', refType: 'market_listing', refId: listing.id,
})

// Продавцу — цена без наценки; наценка не начисляется никому.
await EconomyService.credit(tx, {
  characterId: listing.sellerCharacterId, amount: listing.price,
  reasonCode: 'MARKET_SELL', refType: 'market_listing', refId: listing.id,
})

if (markupTax > 0) {
  await tx.currencyLog.create({
    data: {
      characterId: buyerId, amount: -markupTax, balanceAfter: buyerBalance,
      reasonCode: 'MARKET_RELATION_MARKUP', refType: 'market_listing', refId: listing.id,
      note: `наценка за вражду ${relation}`,
    },
  })
}
```

### 29.4. Тест

```ts
// backend/src/tests/unit/market-relation-price.test.ts
it('вражда не приносит дохода продавцу', () => {
  const price = 1000
  expect(finalPrice(price, 'ENEMY')).toBe(1250)
  expect(relationMarkupTax(price, 'ENEMY')).toBe(250)
  // продавец получает ровно price, разница уходит в сток
})

it('скидка своим уменьшает выручку продавца', () => {
  expect(finalPrice(1000, 'OWN')).toBe(900)
  expect(relationMarkupTax(1000, 'OWN')).toBe(0)
})
```

---

# Часть V. Воркеры

## 30. Как устроены воркеры сейчас

`backend/src/worker.ts` — один процесс с шестью таймерами. Каждый воркер
экспортирует функцию `run*` и константу периода, а `worker.ts` заводит
`setInterval` и глушит ошибки логом, чтобы падение одного не убивало остальные:

```ts
const workShiftTimer = setInterval(async () => {
  try { await runWorkShiftFinalize() }
  catch (err) { logger.error({ err }, '[Worker] Work shift finalize error') }
}, WORK_SHIFT_FINALIZE_MS)
```

Все новые воркеры Этапа 3 пишутся по этому образцу. Требование: **состояние
только в БД**, чтобы перезапуск процесса ничего не терял.

## 31. `production-cycle.worker.ts`

```ts
import { prisma } from '../shared/db/prisma'
import { CycleService } from '../modules/production/cycle.service'
import { BalanceConfig } from '../config/balance.config'
import { logger } from '../shared/logger/logger'

export const PRODUCTION_CYCLE_MS = 60_000

export async function runProductionCycle(): Promise<{ started: number; completed: number; failed: number }> {
  const now = new Date()
  let started = 0, completed = 0, failed = 0

  // 1. Завершаем всё, что отработало время и набрало труд.
  const due = await prisma.productionCycle.findMany({
    where: { status: 'RUNNING', endsAt: { lte: now } },
    take: 200,
  })
  for (const cycle of due) {
    const result = await CycleService.complete(cycle.id)
    if ('completed' in result) completed++
  }

  // 2. Отменяем зависшие: труд не набран за отведённое время.
  const timeoutAt = new Date(now.getTime() - BalanceConfig.economy.production.laborTimeoutHours * 3_600_000)
  const stale = await prisma.productionCycle.findMany({
    where: { status: 'PENDING', createdAt: { lte: timeoutAt } },
    take: 100,
  })
  for (const cycle of stale) {
    await CycleService.fail(cycle.id, 'LABOR_TIMEOUT')
    failed++
  }

  // 3. Пробуем стартовать новый цикл на объектах, где его нет.
  const idle = await prisma.productionObject.findMany({
    where: {
      isActive: true, status: 'ACTIVE',
      activeRecipeId: { not: null },
      cycles: { none: { status: { in: ['PENDING', 'RUNNING'] } } },
    },
    take: 100,
  })
  for (const object of idle) {
    const result = await CycleService.tryStart(object.id)
    if ('cycle' in result) started++
    else if ('failure' in result) {
      // Пишем причину не чаще раза в час на объект, иначе журнал зарастёт.
      await recordFailureThrottled(object.id, result.failure)
    }
  }

  if (started || completed || failed) {
    logger.info({ started, completed, failed }, '[ProductionCycle] tick')
  }
  return { started, completed, failed }
}
```

**Решение о троттлинге причин отказа.** Объект без сырья попадает в выборку
каждую минуту. Без ограничения журнал за сутки получит 1440 одинаковых записей
на объект. Причина записывается не чаще раза в час на пару объект-причина;
владельцу в интерфейсе показывается последняя.

## 32. `farm-growth.worker.ts`

```ts
export const FARM_GROWTH_MS = 5 * 60_000

export async function runFarmGrowth(): Promise<{ ripened: number; withered: number }> {
  const now = new Date()

  const ripened = await prisma.farmPlot.updateMany({
    where: { status: 'GROWING', readyAt: { lte: now } },
    data: { status: 'READY' },
  })

  const withered = await prisma.farmPlot.updateMany({
    where: { status: 'READY', withersAt: { lte: now } },
    data: { status: 'WITHERED', plantCode: null, readyAt: null, withersAt: null, waterCount: 0 },
  })

  return { ripened: ripened.count, withered: withered.count }
}
```

Воркер идемпотентен по построению: условие `status` в `where` не даст обработать
участок дважды. Индекс `@@index([status, readyAt])` в `FarmPlot` существует
именно для этих двух запросов.

## 33. `intoxication-decay.worker.ts`

```ts
export const INTOXICATION_DECAY_MS = 5 * 60_000

export async function runIntoxicationDecay(): Promise<number> {
  const now = new Date()
  const drunk = await prisma.character.findMany({
    where: { intoxication: { gt: 0 } },
    select: { id: true, intoxication: true, intoxicationUpdatedAt: true, hangoverUntil: true },
    take: 500,
  })

  let updated = 0
  for (const character of drunk) {
    const next = currentIntoxication(character.intoxication, character.intoxicationUpdatedAt, now)
    if (next === character.intoxication) continue

    const startsHangover = hangoverStarts(character.intoxication, next)
    await prisma.character.update({
      where: { id: character.id },
      data: {
        intoxication: next,
        intoxicationUpdatedAt: now,
        ...(startsHangover
          ? { hangoverUntil: new Date(now.getTime() + BalanceConfig.character.intoxication.hangoverMinutes * 60_000) }
          : {}),
      },
    })
    updated++
  }
  return updated
}
```

Материализация нужна не для расчёта — он и так идёт от `intoxicationUpdatedAt`, —
а чтобы админка и метрики видели актуальный градус без пересчёта на лету.

## 34. `clan-maintenance.worker.ts`

```ts
export const CLAN_MAINTENANCE_MS = 60 * 60_000   // проверка ежечасно, списание раз в сутки

export async function runClanMaintenance(): Promise<{ charged: number; frozen: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const daily = BalanceConfig.economy.clan.clanMaintenanceDaily

  const clans = await prisma.clan.findMany({ where: { isActive: true } })
  let charged = 0, frozen = 0

  for (const clan of clans) {
    const alreadyCharged = await prisma.clanLog.count({
      where: {
        clanId: clan.id, action: 'TREASURY_SPEND',
        createdAt: { gte: new Date(`${today}T00:00:00Z`) },
        detailsJson: { path: ['kind'], equals: 'MAINTENANCE' },
      },
    })
    if (alreadyCharged > 0) continue

    await withTransaction(async tx => {
      const paid = await tx.clan.updateMany({
        where: { id: clan.id, treasury: { gte: daily } },
        data: { treasury: { decrement: daily } },
      })
      if (paid.count !== 1) {
        await tx.clan.update({ where: { id: clan.id }, data: { maintenanceDebt: { increment: daily } } })
      }
      await tx.clanLog.create({
        data: {
          clanId: clan.id, actorId: 'system', action: 'TREASURY_SPEND',
          amount: daily, detailsJson: { kind: 'MAINTENANCE', paid: paid.count === 1 },
        },
      })
      charged++

      const fresh = await tx.clan.findUniqueOrThrow({ where: { id: clan.id } })
      if (fresh.maintenanceDebt >= daily * 3 && !fresh.isFrozen) {
        await tx.clan.update({ where: { id: clan.id }, data: { isFrozen: true } })
        frozen++
      }
    })
  }
  return { charged, frozen }
}
```

**Замороженный клан**: склад работает только на выемку, приглашения запрещены,
общак пополняется. Разморозка происходит автоматически при погашении долга.
Смысл — мёртвые кланы не должны висеть вечно ради скидок на рынке.

## 35. Регистрация в `worker.ts`

```ts
// backend/src/worker.ts — добавляется к существующим таймерам
import { runProductionCycle, PRODUCTION_CYCLE_MS } from './workers/production-cycle.worker'
import { runFarmGrowth, FARM_GROWTH_MS } from './workers/farm-growth.worker'
import { runIntoxicationDecay, INTOXICATION_DECAY_MS } from './workers/intoxication-decay.worker'
import { runClanMaintenance, CLAN_MAINTENANCE_MS } from './workers/clan-maintenance.worker'

const productionCycleTimer = setInterval(async () => {
  try { await runProductionCycle() }
  catch (err) { logger.error({ err }, '[Worker] Production cycle error') }
}, PRODUCTION_CYCLE_MS)

// ... аналогично для трёх остальных

// и в shutdown:
clearInterval(productionCycleTimer)
clearInterval(farmGrowthTimer)
clearInterval(intoxicationTimer)
clearInterval(clanMaintenanceTimer)
```

---

# Часть VI. Фронтенд

## 36. Что есть сейчас

- 21 страница, роутер `app/router.tsx`, 13 клиентов API в `shared/api/`;
- клиент `shared/api/client.ts` даёт `api.get/post/put/delete`, сам подставляет
  JWT и на 401 уводит на `/login?reason=session-expired`;
- данные тянутся через TanStack Query;
- макет разложен по `shared/lib/layout-map.ts`: районы и комнаты города;
- маршруты Этапа 3 **уже нарисованы как заглушки**: `/soon/farms`,
  `/soon/kolhoz`, `/soon/plants`, `/soon/products`, `/soon/crop-storage`,
  `/soon/equipment-production`, `/soon/storage`.

## 37. Клиенты API

Пишутся по образцу `shared/api/work.api.ts`: типы представлений плюс объект с
методами. Пример для фермы:

```ts
// frontend/src/shared/api/farm.api.ts
import { request } from './client'

export interface FarmPlotView {
  index: number
  status: 'LOCKED' | 'EMPTY' | 'GROWING' | 'READY' | 'WITHERED' | 'BUILDING'
  plantCode: string | null
  plantName: string | null
  remainingSeconds: number      // считает сервер, клиент не пересчитывает
  withersInSeconds: number | null
  waterCount: number
  canWater: boolean
  buildingType: string | null
  neighbourBonus: number
}

export interface FarmView {
  balance: number
  plotsOwned: number
  nextPlotPrice: number | null
  plots: FarmPlotView[]
}

export const farmApi = {
  get: () => request<FarmView>('/api/farm'),

  buyPlot: () => request<{ plot: FarmPlotView; newBalance: number }>(
    '/api/farm/plots/buy',
    { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
  ),

  plant: (index: number, plantCode: string) => request<{ plot: FarmPlotView }>(
    `/api/farm/plots/${index}/plant`,
    { method: 'POST', body: { plantCode }, headers: { 'Idempotency-Key': crypto.randomUUID() } },
  ),

  water: (index: number) => request<{ plot: FarmPlotView }>(
    `/api/farm/plots/${index}/water`,
    { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
  ),

  harvest: (index: number) => request<{ resources: Array<{ code: string; name: string; amount: number }>; exp: number }>(
    `/api/farm/plots/${index}/harvest`,
    { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } },
  ),
}
```

**Правило, обязательное к соблюдению:** `remainingSeconds` и `canWater` считает
сервер. Клиент не повторяет формулу роста — иначе таймер на экране и таймер в
базе разъедутся, и игрок получит «созрело» на экране и `FARM_006` от сервера.

## 38. Страница фермы

```tsx
// frontend/src/pages/farm/farm-page.tsx
export function FarmPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['farm'],
    queryFn: farmApi.get,
    refetchInterval: 30_000,        // таймеры тикают локально, данные освежаем реже
  })

  const harvest = useMutation({
    mutationFn: (index: number) => farmApi.harvest(index),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['farm'] }),
  })

  if (isLoading) return <PanelState kind="loading" />
  if (isError)   return <PanelState kind="error" />
  if (!data)     return <PanelState kind="empty" text="Ферма ещё не заведена" />

  return (
    <div className="farm">
      <header className="farm__head">
        <b>Ферма</b>
        <span>Счёт: {data.balance} ₽</span>
        {data.nextPlotPrice !== null && (
          <button onClick={() => buyPlot.mutate()}>
            Купить участок — {data.nextPlotPrice} ₽
          </button>
        )}
      </header>

      <div className="farm__grid">
        {data.plots.map(plot => (
          <FarmPlotCell key={plot.index} plot={plot}
            onPlant={() => setPicker(plot.index)}
            onWater={() => water.mutate(plot.index)}
            onHarvest={() => harvest.mutate(plot.index)} />
        ))}
      </div>
    </div>
  )
}
```

Три состояния (`loading`, `error`, `empty`) обязательны на каждой новой
странице: это прямой долг Этапа 2, где они сделаны неравномерно, и повторять
его нельзя.

## 39. Локальный таймер участка

```tsx
// frontend/src/pages/farm/farm-plot.tsx
function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    setLeft(seconds)
    if (seconds <= 0) return
    const timer = setInterval(() => setLeft(value => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [seconds])
  return left
}
```

Отсчёт идёт от серверного значения и обнуляется при каждом обновлении данных.
Клиент никогда не решает сам, что урожай созрел: он лишь показывает ноль и ждёт
подтверждения от сервера.

## 40. Значок опьянения

```tsx
// frontend/src/widgets/intoxication-badge/intoxication-badge.tsx
export function IntoxicationBadge({ intoxication }: {
  intoxication: { value: number; tier: string; name: string; soberAt: string | null }
}) {
  if (intoxication.value <= 0) return null
  return (
    <span className={`intox intox--${intoxication.tier.toLowerCase()}`}
          title={`Трезвость через ${formatUntil(intoxication.soberAt)}`}>
      {intoxication.name}
    </span>
  )
}
```

Показывается в шапке персонажа рядом с ХП. Игрок обязан видеть, что на него
действует эффект, иначе штраф к точности воспринимается как баг.

## 41. Новые маршруты

```tsx
// frontend/src/app/router.tsx — заглушки заменяются на страницы
<Route path="/farms"    element={<Guarded><FarmPage /></Guarded>} />
<Route path="/plants"   element={<Guarded><PlantsPage /></Guarded>} />
<Route path="/kolhoz"   element={<Guarded><KolhozPage /></Guarded>} />
<Route path="/objects"  element={<Guarded><MyObjectsPage /></Guarded>} />
<Route path="/objects/market" element={<Guarded><ObjectMarketPage /></Guarded>} />
<Route path="/bars"     element={<Guarded><BarsPage /></Guarded>} />
<Route path="/bars/mine" element={<Guarded><MyBarPage /></Guarded>} />
<Route path="/clan"     element={<Guarded><ClanPage /></Guarded>} />
<Route path="/clan/storage"  element={<Guarded><ClanStoragePage /></Guarded>} />
<Route path="/clan/treasury" element={<Guarded><ClanTreasuryPage /></Guarded>} />
<Route path="/clan/relations" element={<Guarded><ClanRelationsPage /></Guarded>} />
```

Карта города пополняется двумя районами в `shared/lib/layout-map.ts`:

```ts
districts: [
  // существующие
  { key: 'bars',  label: 'Бары',    to: '/bars' },
  { key: 'clan',  label: 'Бригада', to: '/clan' },
],
rooms: {
  agriculture: [
    { key: 'farms',  label: 'Фермы',        to: '/farms' },      // было /soon/farms
    { key: 'kolhoz', label: 'Колхозы',      to: '/kolhoz' },
    { key: 'plants', label: 'Растения',     to: '/plants' },
    { key: 'products', label: 'Продукты',   to: '/products' },
    { key: 'storage', label: 'Склад урожая', to: '/crop-storage' },
  ],
  industrial: [
    { key: 'work',     label: 'Работа',      to: '/work' },
    { key: 'resources', label: 'Запчасти',   to: '/resources' },
    { key: 'make',     label: 'Делают шмот', to: '/crafting' },  // было /soon/equipment-production
    { key: 'objects',  label: 'Мои объекты', to: '/objects' },
  ],
  clan: [
    { key: 'profile',  label: 'Бригада',  to: '/clan' },
    { key: 'storage',  label: 'Склад',    to: '/clan/storage' },
    { key: 'treasury', label: 'Общак',    to: '/clan/treasury' },
  ],
},
```

## 42. Требования к интерфейсу этапа

1. **Состояние цикла видно всегда**: что делается, сколько осталось, чего не
   хватает. Стоящий объект без объяснения — дефект приёмки.
2. **Причина отказа выводится словами.** Соответствие кодов и текстов
   поддерживается на фронте одной таблицей, а не разбросано по компонентам.
3. **Ставка объекта показывается рядом с базовой**, чтобы новичок видел,
   дорого ему предлагают или дёшево.
4. **Градус в шапке** со ступенью и временем до трезвости.
5. **Три состояния таблиц**: загрузка, пусто, ошибка — три разных сообщения.
6. **Таймеры считает сервер**, клиент только отсчитывает.
7. **Мобильная вёрстка** обязательна для всех новых экранов; проверка axe без
   нарушений — критерий, унаследованный от Этапа 2.

---

# Часть VII. Баланс

## 43. Опорные величины Этапа 2

Всё, что ниже, считается от них, а не назначается:

| Величина | Значение | Где в коде |
|---|---|---|
| Оклад входной смены, 30 мин | 80 ₽ | `economy-data.ts`, `obj_scrapyard` |
| Оклад верхнего передела, 90 мин | 300 ₽ | `obj_parts_factory` |
| Суточный потолок | 12 смен или 360 минут | `BalanceConfig.economy.work` |
| Эффективность профессии | `1 + 0.03 × уровень`, максимум 1.18 | `work.formulas.ts` |
| Усталость зарплаты | шаг 0.20, пол 0.20 | `BalanceConfig.economy.work` |
| Госскупка ресурсов | 25% базовой цены | `resources.formulas.ts` |
| Комиссия рынка | 2%, минимум 5 ₽ | `BalanceConfig.economy.market` |
| Налог продажи | 5% | там же |
| Стартовые деньги | 1250 ₽ | `BalanceConfig.character` |

Ставка полного дня: 360 минут с усталостью дают примерно **700–900 ₽/день** на
среднем переделе. Это база для всех коридоров.

## 44. Новые блоки `BalanceConfig`

```ts
// backend/src/config/balance.config.ts
economy: {
  // ... существующие блоки work, resources, market, tools, upgrades, simulation, alerts, suspicious

  production: {
    cycleTickSeconds:        60,
    equipmentWearPerCycle:   2,        // из 100 — ресурс на 50 циклов, около недели
    equipmentTierSpeedBonus: 0.15,     // за тир выше требуемого
    laborTimeoutHours:       48,
    profileSwitchCost:       1500,
    profileSwitchMinutes:    180,
    objectWithdrawTaxRate:   0.05,
    salaryRangeMin:          0.5,
    salaryRangeMax:          2.0,
    maxObjectsPerCharacter:  2,
    restorationExpMultiplier: 3.0,
    objectResaleRate:        0.5,
  },

  farm: {
    plotsPerRow:          4,
    maxPlots:             12,
    plotPrices:           [0, 1500, 1500, 4000, 4000, 4000, 9000, 9000, 9000, 18000, 18000, 18000],
    waterSpeedBonus:      0.10,
    waterMaxCount:        3,
    waterCooldownMinutes: 20,
    maxTotalSpeedUp:      0.50,
    witherBaseHours:      6,
    farmBalanceCap:       50000,
    buildingPrices:       { WATER_BARREL: 2500, CANOPY: 5000, CELLAR: 8000, DOG: 15000 },
    buildingEffects:      { CANOPY: 0.10, CELLAR_PRICE_BONUS: 0.10, CELLAR_CAPACITY: 50 },
  },

  bar: {
    saleTaxRate:     0.20,
    priceMarkupMax:  3.0,
    buffCooldownHours: 12,
  },

  clan: {
    clanCreationCost:        25000,
    clanCreationMinLevel:    5,
    clanMemberBaseLimit:     10,
    memberLimitPerLevel:     5,
    clanRejoinCooldownHours: 48,
    storageCapacityBase:     30,
    storageCapacityPerLevel: 15,
    storageTakeDailyLimit:   { LEADER: 999, BRIGADIER: 10, FIGHTER: 3, ROOKIE: 0 },
    treasurySpendDailyLimit: { LEADER: 999999, BRIGADIER: 20000, FIGHTER: 0, ROOKIE: 0 },
    clanMaintenanceDaily:    500,
    clanLevelThresholds:     [0, 500, 1500, 4000, 10000, 25000],
    ownPriceDiscount:        0.10,
    allyPriceDiscount:       0.05,
    enemyPriceMarkup:        0.25,
    relationChangeCooldownHours: 24,
  },
},

character: {
  // ... существующие блоки
  intoxication: {
    soberPerHour:     34,      // полное отрезвление примерно за 3 часа
    hangoverMinutes:  60,
    hangoverAccuracy: -0.02,
    growsInBattle:    false,
  },
},
```

## 45. Цены объектов выведены из окупаемости

Не назначены, а посчитаны: прибыль владельца — разница между стоимостью выхода
и суммой зарплат и сырья; окупаемость должна попасть в 12–20 дней.

| Объект | Цена | Прибыль в день | Окупаемость |
|---|---|---|---|
| Пункт металлолома | 12 000 ₽ | ~800 ₽ | 15 дней |
| Гаражный цех | 20 000 ₽ | ~1300 ₽ | 15 дней |
| Малый завод | 32 000 ₽ | ~2000 ₽ | 16 дней |
| Фабрика деталей | 55 000 ₽ | ~3200 ₽ | 17 дней |
| Стройка кооператива | 55 000 ₽ | ~3200 ₽ | 17 дней |
| Бар | 40 000 ₽ | ~2000 ₽ | 20 дней |
| Колхоз | 45 000 ₽ | ~2400 ₽ | 19 дней |

Окупаемость бара выше намеренно: его доход зависит от чужого спроса, риск
больше, и это должно быть видно по цифрам.

## 46. Растения и куда девать урожай

| Код | Название | Рост | Выход | Семена | Уровень |
|---|---|---|---|---|---|
| `plant_dill` | Укроп | 15 мин | 2–3 `res_greens` | 20 ₽ | 0 |
| `plant_potato` | Картошка | 45 мин | 3–5 `res_vegetables` | 45 ₽ | 0 |
| `plant_hops` | Хмель | 90 мин | 2–4 `res_hops` | 110 ₽ | 1 |
| `plant_sunflower` | Подсолнух | 150 мин | 2–3 `res_oil_seed` | 200 ₽ | 2 |
| `plant_tobacco` | Табак | 240 мин | 1–2 `res_tobacco` | 380 ₽ | 3 |

**Ключевое балансовое решение.** Госскупка сельхозсырья — пол цены, а не
способ заработка. Проверка на картошке: цикл 45 минут, выход 4 единицы по 12 ₽
базовой цены, госскупка 25% даёт 12 ₽ при семенах за 45 ₽ — убыточно. Урожай
продаётся барам и на рынок по 30–40 ₽ за единицу, тогда цикл даёт 120–160 ₽
минус семена.

Отсюда правило: если рыночная цена падает ниже 2.5 госскупок, ферма перестаёт
окупаться и игроки возвращаются на производство. Это здоровая обратная связь,
а не поломка. И это же делает пару «ферма — бар» неразрывной: фермер не может
жить без баров, бар не может работать без фермеров.

## 47. Целевые коридоры

| Показатель | Коридор | Зачем |
|---|---|---|
| Доход фермы за час внимания | 60–80% от смены | ферма не вытесняет работу |
| Доход владельца за час | 120–160% от смены наёмного | иначе объект незачем покупать |
| Окупаемость объекта | 12–20 дней | быстрее — все владельцы, медленнее — никто |
| Окупаемость бара | 18–25 дней | риск выше |
| Доля стоков в обороте | не ниже 40% | критерий Этапа 2 сохраняется |
| Вертикальная интеграция | 75–90% от ставки специалиста | критерий ТЗ 2.2 сохраняется |
| Победа пьяного над трезвым | не выше 52% | опьянение — выбор, а не обязанность |
| Доля дохода клана в доходе игрока | не выше 25% | клан помогает, но не кормит |

Последний коридор защищает новичков: если клан кормит, игра вне клана
бессмысленна, и вход в игру закрывается.

## 48. Новые стоки денег

| Сток | Величина |
|---|---|
| Покупка объектов | 12 000 – 55 000 ₽ разово |
| Налог с вывода прибыли | 5% |
| Смена профиля объекта | 1 500 ₽ |
| Обслуживание оборудования | детали и деньги |
| Налог бара | 20% с продажи |
| Участки и постройки фермы | до 96 000 ₽ разово |
| Создание клана | 25 000 ₽ |
| Содержание клана | 500 ₽/сутки |
| Наценка за вражду | 25% сделки |

Вторая экономическая петля без новых стоков — это инфляция. Показатель «доля
стоков не ниже 40%» уже считает `economy-metrics-daily`, порог не меняется.

---

# Часть VIII. Миграции и сид

## 49. Порядок миграций

Восемь миграций, семь полностью аддитивны. Порядок важен: ссылки на новые enum
должны существовать раньше таблиц, которые их используют.

| № | Имя | Содержание | Риск |
|---|---|---|---|
| 1 | `stage3_enums` | новые enum и новые значения существующих | нет |
| 2 | `stage3_production_chains` | рецепты, входы, склад объекта, циклы, вклад труда | нет |
| 3 | `stage3_object_ownership` | поля `ProductionObject` и `ProductionEquipment` | нет, все nullable или с дефолтом |
| 4 | `stage3_resource_quality` | `ResourceStack.quality` + перестройка уникального индекса | **средний** |
| 5 | `stage3_farm` | фермы, участки, растения | нет |
| 6 | `stage3_bars` | рецепты бара, входы, меню | нет |
| 7 | `stage3_intoxication` | поля персонажа | нет |
| 8 | `stage3_clans` | кланы, участники, права, склад, журнал, отношения, приглашения | нет |

## 50. Миграция 4: единственная рискованная

```sql
-- 1. Добавляем колонку с дефолтом. Быстро: PostgreSQL 11+ не переписывает таблицу.
ALTER TABLE resource_stacks
  ADD COLUMN quality "ResourceQuality" NOT NULL DEFAULT 'NORMAL';

-- 2. Создаём новый уникальный индекс ДО удаления старого,
--    чтобы в промежутке не осталось таблицы без защиты от дублей.
CREATE UNIQUE INDEX CONCURRENTLY resource_stacks_character_template_quality_key
  ON resource_stacks (character_id, resource_template_id, quality);

-- 3. Удаляем старый.
DROP INDEX CONCURRENTLY resource_stacks_character_id_resource_template_id_key;
```

`CONCURRENTLY` не работает внутри транзакции. Prisma оборачивает миграции в
транзакцию, поэтому эту миграцию помечаем как неатомарную либо выполняем шаги
2–3 отдельным скриптом в окне обслуживания. **Решение:** на текущем объёме
(сотни строк) обычное создание индекса занимает миллисекунды, поэтому
`CONCURRENTLY` не нужен — но репетиция на копии прод-БД обязательна, и в её
отчёте фиксируется фактическое время.

Затрагиваемый код: `resources.service.ts` (`add`, `consume`, `reserve`,
`release`), `market.service.ts`, `repair.routes.ts`, `upgrades.service.ts`.
Все обращения по составному ключу получают третий компонент; параметр
`quality` необязательный со значением `NORMAL`, поэтому существующие вызовы
компилируются без изменений.

## 51. Проверка аддитивности в CI

`scripts/check-migration-additivity.mjs` уже запускается в джобе
«Stage 2 Simulations & Migration Safety». Миграция 4 содержит `DROP INDEX` и
будет отмечена как неаддитивная. Решение: скрипт получает список исключений с
обоснованием, а не отключается:

```js
// scripts/check-migration-additivity.mjs
const ALLOWED_NON_ADDITIVE = {
  '20260817_stage3_resource_quality':
    'перестройка уникального индекса под качество ресурсов, отчёт репетиции в docs/qa/',
}
```

## 52. Сид: где живут таблицы

Таблицы кладутся в `backend/prisma/economy-data.ts` рядом с таблицами Этапа 2.

**Критически важно: не в `src/`.** Рантайм-образ бэкенда
(`infra/docker/backend.Dockerfile`) копирует только `dist`, `node_modules`,
`package*.json` и `prisma`. Сид на выкате запускается как
`npx tsx prisma/seed.ts` (шаг «Run idempotent Stage 2 seed» в `cd.yml`).
Импорт из `src/` уронит деплой на этом шаге.

## 53. Новые ресурсы

| Код | Название | Категория | Тир | Цена | Вес |
|---|---|---|---|---|---|
| `res_greens` | Зелень | PRIMARY | 1 | 9 | 0.2 |
| `res_vegetables` | Овощи | PRIMARY | 1 | 12 | 0.5 |
| `res_hops` | Хмель | PRIMARY | 1 | 20 | 0.3 |
| `res_oil_seed` | Семечки | PRIMARY | 1 | 26 | 0.3 |
| `res_tobacco` | Табак | PRIMARY | 1 | 44 | 0.2 |
| `comp_alcohol` | Спирт | COMPONENT | 2 | 55 | 0.4 |
| `comp_extract` | Экстракт | COMPONENT | 2 | 70 | 0.2 |
| `comp_bandage_cloth` | Перевязочная ткань | COMPONENT | 2 | 22 | 0.1 |

## 54. Новые объекты

| Код | Название | Тип | Профессия | Смена | Оклад | Цена |
|---|---|---|---|---|---|---|
| `obj_sawmill` | Пилорама | WORKSHOP | Снабженец | 45 | 130 | 16 000 |
| `obj_textile` | Швейный цех | WORKSHOP | Столяр | 60 | 210 | 30 000 |
| `obj_herb_point` | Приёмка трав | SCRAPYARD | Заготовитель | 30 | 85 | 12 000 |
| `obj_pharmacy` | Аптека | WORKSHOP | Фармацевт | 60 | 200 | 28 000 |
| `obj_chem_lab` | Химлаборатория | FACTORY | Химик | 90 | 310 | 52 000 |
| `obj_bar_pivnaya` | Пивная «У вокзала» | BAR | Фармацевт | — | — | 40 000 |
| `obj_kolhoz_zarya` | Колхоз «Заря» | KOLHOZ | Заготовитель | 60 | 190 | 45 000 |

Химическая ветка наконец получает содержание: Фармацевт и Химик до Этапа 3
существовали только в списке профессий и не имели ни одного объекта.

## 55. Рецепты

**Добыча** (пустой вход, повторяет поведение Этапа 2):

| Рецепт | Объект | Выход | Цикл | Труд |
|---|---|---|---|---|
| `rcp_scrap` | Пункт металлолома | 3 `res_scrap_metal` | 30 | 30 |
| `rcp_wood` | Пилорама | 4 `res_wood` | 45 | 45 |
| `rcp_herbs` | Приёмка трав | 3 `res_greens` | 30 | 30 |

**Металлическая ветка:**

| Рецепт | Объект | Вход | Выход | Цикл | Труд |
|---|---|---|---|---|---|
| `rcp_fastener` | Гаражный цех | 4 `res_scrap_metal` | 2 `comp_fastener` | 60 | 60 |
| `rcp_steel_plate` | Малый завод | 6 `res_scrap_metal` + 2 `comp_fastener` | 2 `comp_metal_plate` | 60 | 90 |
| `rcp_spring` | Малый завод | 3 `comp_metal_plate` | 4 `comp_spring` | 45 | 60 |
| `rcp_weapon_part` | Фабрика деталей | 3 `comp_metal_plate` + 2 `comp_spring` | 1 `comp_weapon_part` | 90 | 120 |
| `rcp_tt_pistol` | Фабрика деталей | 4 `comp_weapon_part` + 2 `comp_spring` | предмет `weapon_tt_private` | 120 | 180 |

**Строительная ветка:**

| Рецепт | Объект | Вход | Выход | Цикл | Труд |
|---|---|---|---|---|---|
| `rcp_fabric` | Швейный цех | 4 `res_wood` | 3 `res_fabric` | 60 | 60 |
| `rcp_leather` | Швейный цех | 3 `res_fabric` + 1 `comp_alcohol` | 2 `res_leather` | 60 | 75 |
| `rcp_armor_plate` | Стройка кооператива | 3 `comp_metal_plate` + 2 `res_leather` | 1 `comp_armor_plate` | 90 | 120 |
| `rcp_jacket` | Стройка кооператива | 3 `comp_armor_plate` + 4 `res_leather` | предмет `armor_leather_jacket_private` | 120 | 180 |

**Химическая ветка:**

| Рецепт | Объект | Вход | Выход | Цикл | Труд |
|---|---|---|---|---|---|
| `rcp_alcohol` | Аптека | 5 `res_greens` + 3 `res_vegetables` | 2 `comp_alcohol` | 60 | 60 |
| `rcp_extract` | Химлаборатория | 4 `res_hops` + 2 `comp_alcohol` | 2 `comp_extract` | 90 | 90 |
| `rcp_chemicals` | Химлаборатория | 3 `comp_extract` | 4 `res_chemicals` | 60 | 75 |
| `rcp_cloth` | Швейный цех | 2 `res_fabric` | 4 `comp_bandage_cloth` | 45 | 45 |
| `rcp_bandage` | Аптека | 2 `comp_bandage_cloth` | 4 предмета `consumable_bandage` | 45 | 45 |
| `rcp_first_aid` | Аптека | 3 `comp_bandage_cloth` + 1 `comp_extract` | 2 предмета `consumable_first_aid_kit` | 60 | 75 |
| `rcp_plastic` | Химлаборатория | 3 `res_chemicals` | 4 `res_plastic` | 60 | 60 |
| `rcp_spare_parts` | Гаражный цех | 2 `comp_fastener` + 2 `res_plastic` | 2 `res_spare_parts` | 60 | 60 |

**Колхоз:**

| Рецепт | Объект | Вход | Выход | Цикл | Труд |
|---|---|---|---|---|---|
| `rcp_kolhoz_vegetables` | Колхоз | 2 `res_chemicals` | 12 `res_vegetables` | 90 | 120 |
| `rcp_kolhoz_hops` | Колхоз | 2 `res_chemicals` | 8 `res_hops` | 90 | 120 |

После этого набора **каждый ресурс сида имеет производителя**, и проверка
проходимости перестаёт показывать «заведены, но недоступны» — сейчас таких
семь: пружина, химия, ткань, кожа, пластик, запчасти, древесина.

## 56. Меню бара

| Код | Название | Категория | Вход | HP | Градус | Эффект | Себестоимость |
|---|---|---|---|---|---|---|---|
| `bar_soup` | Щи | FOOD | 3 `res_vegetables` + 1 `res_greens` | 25 | 0 | — | 30 |
| `bar_pelmeni` | Пельмени | FOOD | 4 `res_vegetables` + 1 `res_fabric` | 45 | 0 | — | 55 |
| `bar_kvass` | Квас | DRINK | 2 `res_hops` | 15 | 8 | — | 25 |
| `bar_beer` | Пиво «Жигулёвское» | DRINK | 3 `res_hops` + 1 `comp_alcohol` | 20 | 18 | — | 40 |
| `bar_samogon` | Самогон | DRINK | 2 `comp_alcohol` + 1 `res_greens` | 35 | 40 | — | 70 |
| `bar_chifir` | Чифирь | STIMULANT | 2 `res_greens` + 1 `comp_extract` | 0 | 0 | +0.02 точности, 30 мин | 60 |
| `bar_nastoyka` | Настойка | STIMULANT | 2 `comp_extract` | 0 | 0 | +3% урона, 30 мин | 90 |

Ткань в пельменях — временная замена муке, чтобы не плодить сущности до
подтверждения номенклатуры заказчиком. Помечено как открытый вопрос В-4.

## 57. Расширение проверки проходимости

`scripts/check-economy-reachability.ts` дополняется пятью проверками:

```ts
// 1. У каждого рецепта каждый вход производится достижимым рецептом
//    либо продаётся в лавке.
// 2. Каждый ресурс сида либо производится, либо покупается.
// 3. Каждый рецепт выполним: объект достижим, профессия достижима,
//    инструмент нужного тира продаётся в госмагазине.
// 4. В цепочке рецептов нет циклов.
// 5. У каждого объекта на продажу цена попадает в коридор окупаемости.
```

Проверка 4 — новая и обязательная. Без неё легко завести `A → B → A` и получить
вечный двигатель, размножающий ресурсы:

```ts
/** Поиск цикла в графе «ресурс → рецепт → ресурс» обходом в глубину. */
function findCycle(recipes: Recipe[]): string[] | null {
  const producedBy = new Map<string, Recipe[]>()
  for (const recipe of recipes) {
    if (!recipe.outputResourceCode) continue
    const list = producedBy.get(recipe.outputResourceCode) ?? []
    list.push(recipe)
    producedBy.set(recipe.outputResourceCode, list)
  }

  const state = new Map<string, 'visiting' | 'done'>()
  const path: string[] = []

  function visit(resource: string): string[] | null {
    if (state.get(resource) === 'done') return null
    if (state.get(resource) === 'visiting') return [...path, resource]
    state.set(resource, 'visiting')
    path.push(resource)
    for (const recipe of producedBy.get(resource) ?? []) {
      for (const input of recipe.inputs) {
        const cycle = visit(input.resourceCode)
        if (cycle) return cycle
      }
    }
    path.pop()
    state.set(resource, 'done')
    return null
  }

  for (const resource of producedBy.keys()) {
    const cycle = visit(resource)
    if (cycle) return cycle
  }
  return null
}
```

---

# Часть IX. Тесты и симуляторы

## 58. Что покрывается на каждом уровне

| Уровень | Файлы | Что проверяется |
|---|---|---|
| unit | `cycle.formulas.test.ts` | труд, длительность, готовность, качество выхода |
| | `farm.formulas.test.ts` | соседи, полив, засыхание, потолок ускорения |
| | `intoxication.formulas.test.ts` | ступени, протрезвление, похмелье |
| | `clan-permissions.test.ts` | матрица по умолчанию, запрет снятия `ROLE_SET` |
| | `market-relation-price.test.ts` | модификаторы, наценка в сток |
| | `recipe-integrity.test.ts` | ровно один вид выхода у рецепта |
| integration | `production-cycle.test.ts` | резерв, атомарный выпуск, отказ, возврат резерва |
| | `object-ownership.test.ts` | покупка, лимит, зарплата из баланса, долг объекта |
| | `farm.test.ts` | посадка, полив, сбор, засыхание |
| | `bars.test.ts` | покупка позиции, списание ингредиентов, налог |
| | `clans.test.ts` | приглашение, склад под лимитом, общак до нуля, отношения |
| e2e API | `stage3-cycle.e2e.test.ts` | покупка объекта → найм → цикл → выпуск → продажа |
| Playwright | `stage3.visual.spec.ts` | ферма, бар, клан на десктопе и мобильном, axe |
| симуляции | три скрипта | коридоры, проходимость, матрица опьянения |

## 59. Два обязательных теста, вытекающих из опыта Этапа 2

### 59.1. Тест проходимости

15 августа выяснилось, что три производственных объекта из шести не открывались
никогда: объект требовал уровень профессии, опыт которой начисляется только на
нём самом. Симуляторы прогрессии этого не ловили — они считают дни до уровня,
а не «можно ли вообще встать на объект».

```ts
// backend/src/tests/unit/reachability.test.ts
it('каждый рецепт достижим с нуля', () => {
  const report = analyzeReachability(PRODUCTION_OBJECTS, PRODUCTION_RECIPES, PRIVATE_SHOP_RESOURCES)
  expect(report.unreachableRecipes, `недостижимые рецепты: ${report.unreachableRecipes.join(', ')}`).toEqual([])
})

it('в цепочке рецептов нет циклов', () => {
  expect(findCycle(PRODUCTION_RECIPES)).toBeNull()
})
```

### 59.2. Тест на дубли выпуска

```ts
// backend/src/tests/integration/production-cycle.test.ts
it('параллельное завершение цикла даёт ровно один выпуск', async () => {
  const { object, cycle } = await fixtureRunningCycle()

  const results = await Promise.allSettled([
    CycleService.complete(cycle.id),
    CycleService.complete(cycle.id),
    CycleService.complete(cycle.id),
  ])

  const completed = results.filter(r => r.status === 'fulfilled' && 'completed' in r.value)
  expect(completed).toHaveLength(1)

  const inventory = await testPrisma.productionObjectInventory.findFirst({
    where: { productionObjectId: object.id, resourceCode: 'comp_fastener' },
  })
  expect(inventory?.amount).toBe(2)      // выход рецепта, а не 6
})

it('вход списывается ровно один раз', async () => {
  const { object, cycle } = await fixtureRunningCycle()
  await CycleService.complete(cycle.id)
  await CycleService.complete(cycle.id)

  const input = await testPrisma.productionObjectInventory.findFirst({
    where: { productionObjectId: object.id, resourceCode: 'res_scrap_metal' },
  })
  expect(input?.amount).toBe(6)          // было 10, рецепт съел 4
  expect(input?.reservedAmount).toBe(0)  // резерв снят
})
```

## 60. Интеграционный тест зарплаты из баланса объекта

```ts
// backend/src/tests/integration/object-ownership.test.ts
it('рабочий получает зарплату даже при пустом балансе объекта', async () => {
  const { owner, worker, object } = await fixturePrivateObject({ balance: 0 })
  const shift = await WorkService.start(worker.id, object.id)
  await testPrisma.workShift.update({ where: { id: shift.shift.id }, data: { endsAt: new Date(Date.now() - 1000) } })
  await runWorkShiftFinalize()

  const claimed = await WorkService.claim(worker.id, shift.shift.id, 'key-empty-balance')

  expect(claimed.salary).toBeGreaterThan(0)
  const workerAfter = await testPrisma.character.findUniqueOrThrow({ where: { id: worker.id } })
  expect(workerAfter.money).toBeGreaterThan(0)

  // долг записан объекту, а не потерян
  const objectAfter = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
  expect(objectAfter.maintenanceDebt).toBe(claimed.salary)
})
```

## 61. Расширение симуляторов

| Симулятор | Что добавляется |
|---|---|
| `simulate-economy.ts` | профили «владелец объекта» и «фермер», проверка коридоров раздела 47 |
| `check-economy-reachability.ts` | рецепты, отсутствие циклов, покрытие ресурсов |
| `simulate-apeha-matrix.ts` | прогон боёв с каждой ступенью опьянения, порог 52% |

```ts
// scripts/simulate-apeha-matrix.ts — новый сценарий
const INTOXICATION_CASES = [
  { name: 'трезвый против трезвого', a: 0,  b: 0  },
  { name: 'навеселе против трезвого', a: 15, b: 0 },
  { name: 'пьяный против трезвого',   a: 50, b: 0 },
  { name: 'в хлам против трезвого',   a: 85, b: 0 },
]

for (const testCase of INTOXICATION_CASES) {
  const winRate = simulateDuels({ intoxicationA: testCase.a, intoxicationB: testCase.b, runs: 1000 })
  report.intoxication.push({ ...testCase, winRate })
}

acceptance.drunkNotDominant = report.intoxication.every(r => r.winRate <= 0.52)
```

---

# Часть X. Приёмка, план, риски

## 62. Критерии приёмки этапа

1. Долг Этапа 2 закрыт по `MASTER_TZ_STAGE_2_COMPLETION_FULL.md`, Этап 2 принят.
2. Первый вертикальный срез собран и лежит в коридорах:
   `res_scrap_metal → comp_metal_plate → comp_weapon_part → weapon_tt_private →
   износ в бою → ремонт деталью`.
3. Каждый рецепт достижим, каждый ресурс производится, циклов в цепочке нет —
   проверка в CI зелёная.
4. Игрок может купить объект, нанять рабочих, выпустить продукт и продать его.
5. Игрок может завести ферму, вырастить урожай и снабдить им бар.
6. Игрок может купить бар, составить меню, снабдить его и получать выручку.
7. Игрок может создать клан, принять людей, пользоваться складом и общаком.
8. Цены для своих и чужих работают, наценка уходит в сток, а не продавцу.
9. Опьянение прошло матрицу боевых экспериментов, порог 52% соблюдён.
10. Ни одной миграции, ломающей данные Этапов 1–2; репетиция миграции 4
    выполнена и задокументирована.
11. Протоколы ручной и граничной QA этапа заполнены, ноль FAIL.
12. Симуляторы в коридорах, метрики и алерты этапа работают.
13. Все новые экраны имеют три состояния и мобильную вёрстку, axe без нарушений.

## 63. План работ по подэтапам

| Подэтап | Состав | Дней | Зависит от |
|---|---|---|---|
| E0 | долг Этапа 2 (отдельный документ) | 5 | — |
| E1 | рецепты, склад объекта, циклы, вклад труда, вертикальный срез | 4 | E0 |
| E2 | собственность: покупка, баланс, зарплата, оборудование, профиль, восстановление | 3 | E1 |
| E3 | качество ресурсов | 1 | E1 |
| E4 | ферма и колхоз | 3 | E1 |
| E5 | бары, опьянение, крафт расходников | 3 | E4 |
| E6 | кланы: состав, права, склад, общак, отношения, цены | 4 | — |
| E7 | баланс, симуляторы, антиабуз, метрики, приёмка | 3 | всё |
| **Итого** | | **26 дней** | |

Календарный коридор: 28–32 рабочих дня. Для сравнения: Этап 2 оценивался в
9 дней и занял около трёх недель календарно.

E6 не зависит от производственного слоя и может идти параллельно при работе
больше одного человека. При одном исполнителе порядок строго последовательный.

**Если срок неприемлем**, единственный честный способ сократить — вынести E1,
E2 и E3 в отдельный этап. Останется 15 дней: ферма, бары, опьянение, кланы.

## 64. Порядок внутри подэтапа E1 (образец детализации)

| Шаг | Работа | Проверка |
|---|---|---|
| 1 | Миграции 1–2, модели рецептов, склада, циклов | `prisma migrate dev` на чистой БД |
| 2 | `cycle.formulas.ts` + unit-тесты | тесты зелёные |
| 3 | `inventory.service.ts` + тест инварианта | резерв не уходит в минус |
| 4 | `cycle.service.ts`: `tryStart`, `complete`, `fail` | интеграционный тест дублей |
| 5 | Врезка вклада труда в `work.service.ts` | смена вкладывается ровно один раз |
| 6 | Воркер `production-cycle` | цикл сам стартует и завершается |
| 7 | Маршруты `/api/production/objects/:id/cycles` | e2e-сценарий |
| 8 | Сид рецептов добычи для объектов Этапа 2 | поведение прода не изменилось |
| 9 | Сид цепочки первого среза | проверка проходимости зелёная |
| 10 | Фронт: панель цикла на странице объекта | три состояния, причина отказа словами |

## 65. Риски

| # | Риск | Вероятность | Что делаем |
|---|---|---|---|
| Р-1 | Объём не влезает в срок | высокая | подэтапы принимаются по отдельности; E1 самодостаточен и может быть выкачен один |
| Р-2 | Кланам не хватает игроков | высокая | клан полезен с двух человек: склад и скидка работают сразу; массовых требований нет |
| Р-3 | Вторая петля обесценивает первую | средняя | коридоры заданы до реализации, проверяются симулятором |
| Р-4 | Опьянение ломает боевой баланс | средняя | масштаб от шага улучшений, матрица экспериментов, порог 52% |
| Р-5 | Дублирование выпуска цикла | средняя | резерв, условный апдейт, идемпотентность, отдельный тест |
| Р-6 | Вечный двигатель в цепочке | низкая | поиск циклов в CI |
| Р-7 | Владельцы не находят рабочих | средняя | ставка видна рядом с базовой; при нуле рабочих объект убыточен, но не сломан |
| Р-8 | Миграция качества на живых данных | низкая | репетиция на копии прода, порядок операций расписан |
| Р-9 | Сид импортирует из `src/` и роняет выкат | средняя | таблицы только в `prisma/`, проверка в код-ревью |
| Р-10 | Журнал зарастает причинами отказа | средняя | троттлинг записи причины: раз в час на пару объект-причина |

## 66. Открытые вопросы

| # | Вопрос | Решение по умолчанию |
|---|---|---|
| В-1 | Колхоз — только частный или и клановый? | частный; клановый доступ по правам — Этап 4 |
| В-2 | Форум (помечен в коде этапом 3) | не входит, остаётся заглушкой |
| В-3 | Будут ли макеты баров, кланов и «моих объектов»? | верстаем по аналогии с существующими экранами |
| В-4 | Номенклатура сельхозсырья: мука отдельным ресурсом? | пока ткань как временная замена, требует подтверждения |
| В-5 | Лимит объектов на игрока | 2 |
| В-6 | Перепродажа объектов между игроками | нет, только государству за 50% |
| В-7 | «Малый завод» выпускает металл, но закреплён за Столяром | переназначить на металлическую ветку в рамках E1 |
| В-8 | Повышение потолка уровня профессии (сейчас 6) | не в этом этапе; опыт копится, при повышении пересчитается сам |

## 67. Реестр отклонений

Заполняется по ходу этапа. Ни одно отклонение от этого ТЗ не реализуется до
записи в реестр с обоснованием.

| № | Отклонение | Решение | Обоснование | Дата |
|---|---|---|---|---|
| — | — | — | — | — |

## 68. Что этот документ сознательно не описывает

- **Точный текст интерфейсных строк.** Формулировки утверждаются при вёрстке,
  их фиксация в ТЗ приводит к расхождению кода и документа на второй неделе.
- **Внутреннее устройство существующих модулей**, которые этап не трогает.
- **Инфраструктуру**: деплой, бэкапы и мониторинг работают с Этапа 2 и
  меняются только добавлением новых метрик.
- **Дизайн экранов**: макетов баров и кланов нет, вопрос В-3 открыт.

---

# Приложение А. Полный перечень маршрутов API

Общие правила, унаследованные с Этапа 2 и обязательные здесь:

- аутентификация JWT через `authenticate`; чужие идентификаторы → 403 или 404,
  никогда 200 с пустым телом;
- любая мутация с деньгами, предметами или ресурсами требует заголовок
  `Idempotency-Key` (UUID на операцию); повтор возвращает сохранённый ответ
  с `replayed: true`;
- валидация zod, невалидное значение → 422 с указанием поля;
- деньги только через `EconomyService`, ресурсы только через `ResourcesService`.

## А.1. Объекты и производство — `/api/objects`, `/api/production`

| Метод | Путь | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| GET | `/api/objects/market` | — | каталог объектов на продажу с `canBuy` и `blockedReason` | — |
| POST | `/api/objects/:id/buy` | — | `{ objectId, newBalance }` | `PROD_001` продан, `PROD_002` лимит, `PROD_003` профессия, `SHOP_001` денег нет |
| POST | `/api/objects/:id/sell` | — | `{ payout, newBalance }` | `PROD_004` идёт цикл, `PROD_005` склад не пуст |
| GET | `/api/objects/mine` | — | список своих объектов с балансом, циклом, складом, оборудованием | — |
| PATCH | `/api/objects/:id/salary` | `{ salary }` | `{ salary }` | `PROD_006` вне коридора |
| POST | `/api/objects/:id/balance` | `{ amount }` | `{ balance, newCharacterBalance }` | `SHOP_001` |
| POST | `/api/objects/:id/withdraw` | `{ amount }` | `{ payout, tax, newBalance }` | `PROD_007` баланс мал |
| POST | `/api/objects/:id/profile` | `{ recipeCode }` | `{ activeRecipeId, switchingUntil, cost }` | `PROD_008` повреждён, `PROD_009` уже меняется |
| POST | `/api/objects/:id/stock/put` | `{ resourceCode, quality, amount }` | `{ inventory, storageUsed }` | `PROD_010` склад полон, `PROD_011` нет ресурса |
| POST | `/api/objects/:id/stock/take` | `{ resourceCode, quality, amount }` | `{ inventory, storageUsed }` | `PROD_012` зарезервировано |
| GET | `/api/objects/:id/cycles` | `?limit` | история циклов с вкладчиками | — |
| POST | `/api/objects/:id/cycles/start` | — | `{ cycle }` | `PROD_013` с полем `reason` |
| POST | `/api/objects/:id/equipment/repair` | — | `{ durabilityCurrent, spent }` | `PROD_014` не изношено, `PROD_015` нет деталей |
| GET | `/api/production/recipes` | `?objectCode` | рецепты с пометкой доступности | — |

## А.2. Ферма — `/api/farm`

| Метод | Путь | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| GET | `/api/farm` | — | ферма, участки, цена следующего участка | — |
| POST | `/api/farm/plots/buy` | — | `{ plot, newBalance }` | `FARM_001` максимум участков |
| POST | `/api/farm/plots/:index/plant` | `{ plantCode }` | `{ plot }` | `FARM_002` уровень, `FARM_003` занят, `SHOP_001` |
| POST | `/api/farm/plots/:index/water` | — | `{ plot, newReadyAt }` | `FARM_004` перезарядка, `FARM_005` предел поливов |
| POST | `/api/farm/plots/:index/harvest` | — | `{ resources, exp, plot }` | `FARM_006` не готов, `FARM_007` засох |
| POST | `/api/farm/plots/:index/clear` | — | `{ plot }` | — |
| POST | `/api/farm/buildings` | `{ index, type }` | `{ plot, newBalance }` | `FARM_008` участок занят |
| POST | `/api/farm/withdraw` | `{ amount }` | `{ farmBalance, newCharacterBalance }` | — |
| GET | `/api/plants` | — | справочник растений | — |

## А.3. Бары — `/api/bars`

| Метод | Путь | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| GET | `/api/bars` | — | бары с меню и признаком доступности позиции | — |
| POST | `/api/bars/:id/buy` | `{ recipeCode }` | `{ healed, intoxication, buff, newBalance }` | `BAR_001` нет ингредиентов, `BAR_002` в бою, `BAR_003` похмелье, `BAR_004` бонус на перезарядке |
| GET | `/api/bars/mine/:id/menu` | — | меню своего бара с себестоимостью и коридором цен | — |
| PATCH | `/api/bars/mine/:id/menu` | `{ items: [{ recipeCode, price, isActive }] }` | `{ menu }` | `BAR_005` цена вне коридора |

## А.4. Кланы — `/api/clans`

| Метод | Путь | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| POST | `/api/clans` | `{ code, name, motto? }` | `{ clan }` | `CLAN_001` уровень, `CLAN_002` занято, `CLAN_003` уже в клане |
| GET | `/api/clans` | `?q&page&limit` | список кланов | — |
| GET | `/api/clans/:code` | — | клан, состав, отношения, свои права | — |
| POST | `/api/clans/:code/invite` | `{ nickname }` | `{ invite }` | `CLAN_004` нет права, `CLAN_005` лимит, `CLAN_006` уже приглашён |
| POST | `/api/clans/:code/invite/accept` | — | `{ clan, role }` | `CLAN_007` задержка, `CLAN_008` истекло |
| DELETE | `/api/clans/:code/members/:nickname` | — | `{ removed }` | `CLAN_004`, `CLAN_009` нельзя исключить главаря |
| PATCH | `/api/clans/:code/members/:nickname` | `{ role }` | `{ member }` | `CLAN_004`, `CLAN_010` второй главарь |
| POST | `/api/clans/:code/leave` | — | `{ left }` | `CLAN_011` главарь не может выйти |
| POST | `/api/clans/:code/transfer` | `{ nickname }` | `{ newLeader }` | `CLAN_004` |
| GET | `/api/clans/:code/storage` | — | склад, вместимость, свой лимит выноса | — |
| POST | `/api/clans/:code/storage/put` | предмет или ресурс | `{ item, used }` | `CLAN_004`, `CLAN_012` склад полон |
| POST | `/api/clans/:code/storage/take` | `{ storageItemId }` | `{ taken, takenToday, limit }` | `CLAN_004`, `CLAN_013` лимит |
| GET | `/api/clans/:code/treasury` | — | баланс, долг, лимиты, операции | — |
| POST | `/api/clans/:code/treasury/deposit` | `{ amount }` | `{ balance, newCharacterBalance }` | `SHOP_001` |
| POST | `/api/clans/:code/treasury/spend` | `{ amount, purpose }` | `{ balance, newCharacterBalance }` | `CLAN_004`, `CLAN_014` лимит |
| GET | `/api/clans/:code/relations` | — | отношения | — |
| POST | `/api/clans/:code/relations` | `{ targetClanCode, state }` | `{ relation }` | `CLAN_004`, `CLAN_015` перезарядка |
| GET | `/api/clans/:code/log` | `?page&limit&action` | журнал клана | — |

`purpose` в трате общака обязателен и попадает в `ClanLog`: трата без указания
причины — готовый конфликт внутри клана.

## А.5. Изменения существующих контрактов

```
GET /api/market/listings
→ каждый лот дополняется:
    price            цена продавца
    finalPrice       с учётом отношения к продавцу
    relation         OWN | ALLY | NEUTRAL | ENEMY
    relationModifier -0.10 | -0.05 | 0 | +0.25

POST /api/work/shifts/:id/claim
→ ответ дополняется:
    cycleContribution: { cycleId, laborMinutes, cycleProgress } | null

POST /api/work/shifts/start
→ тело дополняется:
    mode: "PRODUCTION" | "RESTORATION"   (по умолчанию PRODUCTION)

GET /api/characters/me
→ ответ дополняется:
    intoxication: { value, tier, name, soberAt }
    hangoverUntil
    clan: { code, name, role } | null
```

## А.6. Новые коды ошибок

Добавляются в `backend/src/shared/errors/error-codes.ts` к существующим 89:

```ts
// Производство
PROD_ALREADY_SOLD      = 'PROD_001',
PROD_OBJECT_LIMIT      = 'PROD_002',
PROD_PROFESSION_TOO_LOW = 'PROD_003',
PROD_CYCLE_ACTIVE      = 'PROD_004',
PROD_STORAGE_NOT_EMPTY = 'PROD_005',
PROD_SALARY_RANGE      = 'PROD_006',
PROD_BALANCE_LOW       = 'PROD_007',
PROD_OBJECT_DAMAGED    = 'PROD_008',
PROD_PROFILE_SWITCHING = 'PROD_009',
PROD_STORAGE_FULL      = 'PROD_010',
PROD_INPUT_MISSING     = 'PROD_011',
PROD_RESERVED          = 'PROD_012',
PROD_CYCLE_BLOCKED     = 'PROD_013',
PROD_EQUIPMENT_INTACT  = 'PROD_014',
PROD_PARTS_MISSING     = 'PROD_015',
PROD_NOT_FOR_SALE      = 'PROD_016',
PROD_RECIPE_INVALID    = 'PROD_017',
PROD_INVARIANT         = 'PROD_018',

// Ферма
FARM_MAX_PLOTS         = 'FARM_001',
FARM_LEVEL_REQUIRED    = 'FARM_002',
FARM_PLOT_BUSY         = 'FARM_003',
FARM_WATER_COOLDOWN    = 'FARM_004',
FARM_WATER_LIMIT       = 'FARM_005',
FARM_NOT_READY         = 'FARM_006',
FARM_WITHERED          = 'FARM_007',
FARM_PLOT_OCCUPIED     = 'FARM_008',
FARM_NOT_GROWING       = 'FARM_009',

// Бары
BAR_NO_INGREDIENTS     = 'BAR_001',
BAR_IN_BATTLE          = 'BAR_002',
BAR_HANGOVER           = 'BAR_003',
BAR_BONUS_COOLDOWN     = 'BAR_004',
BAR_PRICE_RANGE        = 'BAR_005',
BAR_ITEM_INACTIVE      = 'BAR_006',

// Кланы
CLAN_LEVEL_REQUIRED    = 'CLAN_001',
CLAN_NAME_TAKEN        = 'CLAN_002',
CLAN_ALREADY_MEMBER    = 'CLAN_003',
CLAN_NO_PERMISSION     = 'CLAN_004',
CLAN_MEMBER_LIMIT      = 'CLAN_005',
CLAN_INVITE_EXISTS     = 'CLAN_006',
CLAN_REJOIN_COOLDOWN   = 'CLAN_007',
CLAN_INVITE_EXPIRED    = 'CLAN_008',
CLAN_CANNOT_KICK_LEADER = 'CLAN_009',
CLAN_SECOND_LEADER     = 'CLAN_010',
CLAN_LEADER_CANNOT_LEAVE = 'CLAN_011',
CLAN_STORAGE_FULL      = 'CLAN_012',
CLAN_TAKE_LIMIT        = 'CLAN_013',
CLAN_SPEND_LIMIT       = 'CLAN_014',
CLAN_RELATION_COOLDOWN = 'CLAN_015',
CLAN_NOT_MEMBER        = 'CLAN_016',
CLAN_SELF_RELATION     = 'CLAN_017',
CLAN_PERMISSION_LOCKED = 'CLAN_018',
CLAN_FROZEN            = 'CLAN_019',
```

## А.7. Матрица прав по умолчанию

| Действие | Главарь | Бригадир | Боец | Пехота |
|---|---|---|---|---|
| Приглашать | да | да | | |
| Исключать | да | да | | |
| Менять роли | да | | | |
| Класть на склад | да | да | да | да |
| Брать со склада | да | да (10/сутки) | да (3/сутки) | |
| Вносить в общак | да | да | да | да |
| Тратить общак | да | да (20 000/сутки) | | |
| Менять отношения | да | | | |
| Управлять объектами клана | да | да | | |
| Править профиль клана | да | | | |

Матрица хранится в `ClanRolePermission` и создаётся при создании клана по этому
образцу. Главарь может её менять, но не может отнять у себя `ROLE_SET`.

---

# Приложение Б. Чек-лист разработчика перед merge

Проверяется на каждом pull request этапа:

- [ ] Ни одного числа в коде формул — всё через `BalanceConfig`.
- [ ] Ни одного прямого `character.update({ money })` — только `EconomyService`.
- [ ] Ни одного прямого `resourceStack.update` — только `ResourcesService`.
- [ ] Каждая денежная мутация под `withIdempotency`.
- [ ] Каждая многошаговая операция под `withTransaction`.
- [ ] Каждый условный апдейт проверяет `count === 1`.
- [ ] Каждая новая ошибка — код из закрытого списка плюс русское сообщение.
- [ ] Каждое новое действие пишет в журнал.
- [ ] Новые таблицы сида лежат в `prisma/economy-data.ts`, а не в `src/`.
- [ ] Миграция аддитивна либо внесена в список исключений с обоснованием.
- [ ] Новый экран имеет состояния загрузки, пустоты и ошибки.
- [ ] Таймеры считает сервер, клиент только отсчитывает.
- [ ] Тесты: unit на формулы, integration на транзакции, e2e на сценарий.
- [ ] `npx vitest run`, `npx eslint .`, `npx tsc --noEmit` зелёные.
- [ ] Проверка проходимости экономики зелёная.
