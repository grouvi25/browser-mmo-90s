# Этап 3 — модель данных

Приложение к `MASTER_TZ_STAGE_3_CRAFT_CLANS_ECONOMY`. Канонический источник имён
таблиц, полей и enum. Реализация обязана использовать их дословно.

Политика миграций: **только аддитивно**. Новые таблицы, новые nullable-поля,
новые значения enum. Ни одно поле Этапа 2 не переименовывается и не удаляется.
Проверка в CI: `scripts/check-migration-additivity.mjs`.

---

# 1. Новые enum

```prisma
enum ProductionCycleStatus {
  PENDING       // ждёт условий: сырьё, место, труд
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

enum ResourceQuality {
  POOR
  NORMAL
  FINE
}

enum FarmPlotStatus {
  LOCKED        // участок не куплен
  EMPTY         // куплен, пуст
  GROWING       // растёт
  READY         // созрел, ждёт сбора
  WITHERED      // засох, требует перекопки
  BUILDING      // занят постройкой
}

enum FarmBuildingType {
  WATER_BARREL  // бочка: заменяет один полив соседям
  CANOPY        // навес: −10% времени созревания соседям
  CELLAR        // погреб: хранит урожай, +10% к цене продажи
  DOG           // собака: защита соседних грядок (задел Этапа 4)
}

enum BarItemCategory {
  FOOD          // лечит, без градуса
  DRINK         // лечит и добавляет градус
  STIMULANT     // боевой эффект без лечения
}

enum ClanRole {
  LEADER        // Главарь
  BRIGADIER     // Бригадир
  FIGHTER       // Боец
  ROOKIE        // Пехота
}

enum ClanPermissionCode {
  INVITE
  KICK
  ROLE_SET
  STORAGE_PUT
  STORAGE_TAKE
  TREASURY_DEPOSIT
  TREASURY_SPEND
  RELATION_SET
  OBJECT_MANAGE
  CLAN_EDIT
}

enum ClanRelationState {
  NEUTRAL
  ALLY
  ENEMY
}

enum ClanLogAction {
  MEMBER_JOINED
  MEMBER_LEFT
  MEMBER_KICKED
  ROLE_CHANGED
  STORAGE_PUT
  STORAGE_TAKE
  TREASURY_DEPOSIT
  TREASURY_SPEND
  RELATION_CHANGED
  OBJECT_LINKED
  CLAN_EDITED
}
```

# 2. Расширяемые enum Этапа 2

```prisma
enum ProductionObjectType {
  FACTORY
  WORKSHOP
  MARKET
  WAREHOUSE
  SCRAPYARD
  SERVICE
  BAR       // NEW
  KOLHOZ    // NEW
}

enum ProductionLogEvent {
  // существующие
  SHIFT_STARTED
  SHIFT_READY
  SHIFT_CLAIMED
  SHIFT_CANCELLED
  SHIFT_FAILED
  OBJECT_STATUS_CHANGED
  // новые
  CYCLE_STARTED
  CYCLE_COMPLETED
  CYCLE_FAILED
  OBJECT_OWNERSHIP_CHANGED
  OBJECT_BALANCE_CHANGED
  PROFILE_SWITCHED
  EQUIPMENT_WORN
  EQUIPMENT_REPAIRED
  RESTORATION_SHIFT
}

enum CurrencyLogReason {
  // существующие: WORK_SALARY, MARKET_*, REPAIR, UPGRADE, GOVERNMENT_*, ...
  OBJECT_PURCHASE          // покупка производственного объекта
  OBJECT_SALE              // продажа объекта государству
  OBJECT_BALANCE_TOP_UP    // пополнение баланса объекта владельцем
  OBJECT_WITHDRAW          // вывод прибыли владельцем
  OBJECT_WITHDRAW_TAX      // налог с вывода
  SALARY_FROM_OBJECT       // зарплата, выплаченная из баланса объекта
  BAR_SALE                 // выручка бара
  BAR_PURCHASE             // покупка позиции в баре
  BAR_TAX                  // налог с продажи бара
  FARM_WITHDRAW            // вывод со счёта фермы
  FARM_PLOT_PURCHASE       // покупка участка
  FARM_BUILDING_PURCHASE   // покупка постройки
  CLAN_CREATION            // создание клана
  CLAN_DEPOSIT             // взнос в общак
  CLAN_SPEND               // трата из общака
  CLAN_MAINTENANCE         // содержание клана
  MARKET_RELATION_MARKUP   // наценка за вражду (целиком в сток)
}

enum ResourceLogReason {
  // существующие
  CYCLE_INPUT              // списание входа цикла
  CYCLE_OUTPUT             // зачисление выхода цикла
  OBJECT_STOCK_PUT         // владелец пополнил склад объекта
  OBJECT_STOCK_TAKE        // владелец забрал со склада объекта
  FARM_HARVEST             // сбор урожая
  BAR_INPUT                // расход ингредиента баром
  CRAFT_INPUT              // расход на крафт расходника
  CLAN_STORAGE_PUT
  CLAN_STORAGE_TAKE
  EQUIPMENT_REPAIR         // детали на обслуживание оборудования
}
```

# 3. Производственные цепочки

```prisma
model ProductionRecipe {
  id                      String   @id @default(uuid())
  code                    String   @unique
  name                    String
  productionObjectCode    String   @map("production_object_code")
  // выход: либо ресурс, либо предмет, ровно одно из двух
  outputResourceCode      String?  @map("output_resource_code")
  outputItemTemplateCode  String?  @map("output_item_template_code")
  outputAmount            Int      @default(1) @map("output_amount")
  outputQuality           ResourceQuality @default(NORMAL) @map("output_quality")
  cycleMinutes            Int      @map("cycle_minutes")
  laborRequired           Int      @map("labor_required")   // человеко-минуты
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
  id           String  @id @default(uuid())
  recipeId     String  @map("recipe_id")
  resourceCode String  @map("resource_code")
  amount       Int
  minQuality   ResourceQuality @default(POOR) @map("min_quality")
  recipe       ProductionRecipe @relation(fields: [recipeId], references: [id], onDelete: Cascade)

  @@unique([recipeId, resourceCode])
  @@map("production_recipe_inputs")
}
```

Правило «ровно одно из двух»: `outputResourceCode` и `outputItemTemplateCode` не
могут быть заполнены одновременно и не могут оба быть пустыми. Проверка на
уровне сервиса и в тесте сида — Prisma такое ограничение не выражает.

Рецепт с пустым списком `inputs` — добыча первичного сырья. Такие рецепты сид
создаёт для всех объектов Этапа 2, чтобы включение цепочек не поменяло поведение.

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
```

Инвариант: `0 <= reservedAmount <= amount`. Проверяется той же функцией, что и
для `ResourceStack` (`assertResourceStackInvariant`).

```prisma
model ProductionCycle {
  id                 String   @id @default(uuid())
  productionObjectId String   @map("production_object_id")
  recipeId           String   @map("recipe_id")
  status             ProductionCycleStatus @default(PENDING)
  laborRequired      Int      @map("labor_required")
  laborAccumulated   Int      @default(0) @map("labor_accumulated")
  startedAt          DateTime? @map("started_at")
  endsAt             DateTime? @map("ends_at")
  completedAt        DateTime? @map("completed_at")
  failureReason      ProductionCycleFailure? @map("failure_reason")
  outputQuality      ResourceQuality? @map("output_quality")
  createdAt          DateTime @default(now()) @map("created_at")
  productionObject   ProductionObject @relation(fields: [productionObjectId], references: [id], onDelete: Cascade)
  recipe             ProductionRecipe @relation(fields: [recipeId], references: [id])
  contributions      CycleLaborContribution[]

  @@index([productionObjectId, status])
  @@index([status, endsAt])
  @@map("production_cycles")
}

model CycleLaborContribution {
  id          String   @id @default(uuid())
  cycleId     String   @map("cycle_id")
  characterId String   @map("character_id")
  workShiftId String   @unique @map("work_shift_id")
  laborMinutes Int     @map("labor_minutes")
  professionLevel Int  @map("profession_level")
  toolTier    Int      @default(0) @map("tool_tier")
  createdAt   DateTime @default(now()) @map("created_at")
  cycle       ProductionCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)

  @@index([cycleId])
  @@index([characterId])
  @@map("cycle_labor_contributions")
}
```

`workShiftId` уникален: одна смена вкладывается ровно в один цикл. Это защита от
двойного зачёта труда при повторе операции.

# 4. Расширение `ProductionObject`

```prisma
model ProductionObject {
  // ... существующие поля Этапа 2 без изменений
  purchasePrice          Int?     @map("purchase_price")
  isForSale              Boolean  @default(false) @map("is_for_sale")
  storageCapacity        Int      @default(0) @map("storage_capacity")   // единицы веса
  activeRecipeId         String?  @map("active_recipe_id")
  profileSwitchingUntil  DateTime? @map("profile_switching_until")
  salaryOverride         Int?     @map("salary_override")                // ставка владельца
  buyPriceOverride       Int?     @map("buy_price_override")             // цена закупки сырья
  sellPriceOverride      Int?     @map("sell_price_override")            // цена продажи продукта
  lastCycleAt            DateTime? @map("last_cycle_at")
  inventory              ProductionObjectInventory[]
  cycles                 ProductionCycle[]
}
```

# 5. Оборудование

```prisma
model ProductionEquipment {
  // ... существующие поля
  durabilityCurrent Int @default(100) @map("durability_current")
  durabilityMax     Int @default(100) @map("durability_max")
  // ownerType и ownerCharacterId уже есть с Этапа 2, теперь используются
}
```

# 6. Качество ресурсов

```prisma
model ResourceStack {
  // ... существующие поля
  quality ResourceQuality @default(NORMAL)
  // уникальность меняется: было [characterId, resourceTemplateId]
  @@unique([characterId, resourceTemplateId, quality])
}
```

Миграция: существующие стеки получают `NORMAL`. Старый уникальный индекс
удаляется, новый создаётся — единственное неаддитивное изменение во всём этапе,
поэтому выполняется отдельной миграцией с репетицией на копии прод-БД.

# 7. Ферма

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
  id            String   @id @default(uuid())
  farmId        String   @map("farm_id")
  index         Int                                    // 0..N-1, позиция в сетке
  status        FarmPlotStatus @default(LOCKED)
  plantCode     String?  @map("plant_code")
  plantedAt     DateTime? @map("planted_at")
  readyAt       DateTime? @map("ready_at")
  withersAt     DateTime? @map("withers_at")
  waterCount    Int      @default(0) @map("water_count")
  lastWateredAt DateTime? @map("last_watered_at")
  buildingType  FarmBuildingType? @map("building_type")
  farm          Farm     @relation(fields: [farmId], references: [id], onDelete: Cascade)

  @@unique([farmId, index])
  @@index([status, readyAt])
  @@map("farm_plots")
}

model PlantTemplate {
  id                      String @id @default(uuid())
  code                    String @unique
  name                    String
  growMinutes             Int    @map("grow_minutes")
  outputResourceCode      String @map("output_resource_code")
  outputAmountMin         Int    @map("output_amount_min")
  outputAmountMax         Int    @map("output_amount_max")
  seedPrice               Int    @map("seed_price")
  requiredProfessionLevel Int    @default(0) @map("required_profession_level")
  expPlant                Int    @map("exp_plant")
  expWater                Int    @map("exp_water")
  expHarvest              Int    @map("exp_harvest")
  isActive                Boolean @default(true) @map("is_active")

  @@map("plant_templates")
}
```

Постройка занимает участок: `status = BUILDING`, `buildingType` заполнен.
Эффект постройки действует на участки, соседние по индексу в сетке (левый,
правый, верхний, нижний — сетка 4 в ряд).

# 8. Бары

```prisma
model BarMenuItem {
  id                 String  @id @default(uuid())
  productionObjectId String  @map("production_object_id")
  recipeCode         String  @map("recipe_code")
  category           BarItemCategory
  price              Int
  isActive           Boolean @default(true) @map("is_active")
  soldToday          Int     @default(0) @map("sold_today")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@unique([productionObjectId, recipeCode])
  @@map("bar_menu_items")
}

model BarRecipe {
  id                String  @id @default(uuid())
  code              String  @unique
  name              String
  category          BarItemCategory
  hpRestore         Int     @default(0) @map("hp_restore")
  intoxication      Int     @default(0)                  // сколько градуса добавляет
  buffCode          String? @map("buff_code")
  buffMinutes       Int     @default(0) @map("buff_minutes")
  costHint          Int     @map("cost_hint")            // себестоимость для коридора цен
  requiredProfessionLevel Int @default(0) @map("required_profession_level")
  inputs            BarRecipeInput[]

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
```

# 9. Опьянение

```prisma
model Character {
  // ... существующие поля
  intoxication          Int      @default(0)                        // 0..100
  intoxicationUpdatedAt DateTime? @map("intoxication_updated_at")
  hangoverUntil         DateTime? @map("hangover_until")
  lastBarBonusAt        DateTime? @map("last_bar_bonus_at")
  clanId                String?  @map("clan_id")                     // уже есть, включается
}
```

Градус не хранится «живым»: он пересчитывается при чтении по формуле
`current = max(0, stored − soberPerHour × прошло_часов)`, а воркер раз в пять
минут материализует значение, чтобы аналитика и админка видели актуальное.
Такой подход исключает расхождение между отображением и расчётом боя.

# 10. Кланы

```prisma
model Clan {
  id            String   @id @default(uuid())
  code          String   @unique                       // латиницей, для ссылок
  name          String   @unique
  motto         String?
  avatarCode    String?  @map("avatar_code")
  leaderId      String   @map("leader_id")
  level         Int      @default(1)
  exp           Int      @default(0)
  treasury      Int      @default(0)
  storageCapacity Int    @default(30) @map("storage_capacity")
  memberLimit   Int      @default(10) @map("member_limit")
  maintenanceDebt Int    @default(0) @map("maintenance_debt")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  members       ClanMember[]
  storageItems  ClanStorageItem[]
  logs          ClanLog[]

  @@map("clans")
}

model ClanMember {
  id          String   @id @default(uuid())
  clanId      String   @map("clan_id")
  characterId String   @unique @map("character_id")
  role        ClanRole @default(ROOKIE)
  joinedAt    DateTime @default(now()) @map("joined_at")
  takenToday  Int      @default(0) @map("taken_today")     // вынос со склада за сутки
  spentToday  Int      @default(0) @map("spent_today")     // трата из общака за сутки
  contributed Int      @default(0)                          // всего внесено в общак
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
  id             String  @id @default(uuid())
  clanId         String  @map("clan_id")
  itemInstanceId String? @unique @map("item_instance_id")
  resourceCode   String? @map("resource_code")
  quality        ResourceQuality?
  amount         Int     @default(1)
  putByCharacterId String @map("put_by_character_id")
  putAt          DateTime @default(now()) @map("put_at")
  clan           Clan    @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId])
  @@map("clan_storage_items")
}

model ClanLog {
  id          String  @id @default(uuid())
  clanId      String  @map("clan_id")
  actorId     String  @map("actor_id")
  action      ClanLogAction
  targetId    String? @map("target_id")
  amount      Int?
  detailsJson Json?   @map("details_json")
  createdAt   DateTime @default(now()) @map("created_at")
  clan        Clan    @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId, createdAt])
  @@map("clan_logs")
}

model ClanRelation {
  id           String   @id @default(uuid())
  clanId       String   @map("clan_id")
  targetClanId String   @map("target_clan_id")
  state        ClanRelationState @default(NEUTRAL)
  confirmed    Boolean  @default(false)          // для ALLY нужны обе стороны
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

Хранилище клана намеренно хранит предметы и ресурсы в одной таблице: у предмета
заполнен `itemInstanceId`, у ресурса — `resourceCode` с количеством и качеством.
Это упрощает единый журнал и единый лимит вместимости.

# 11. Порядок миграций

| № | Миграция | Содержание | Риск |
|---|---|---|---|
| 1 | `stage3_enums` | новые enum и новые значения существующих | нет |
| 2 | `stage3_production_chains` | рецепты, входы, склад объекта, циклы, вклад труда | нет, только новые таблицы |
| 3 | `stage3_object_ownership` | поля `ProductionObject` и `ProductionEquipment` | нет, nullable |
| 4 | `stage3_resource_quality` | `ResourceStack.quality` + перестройка уникального индекса | **средний**, требует репетиции |
| 5 | `stage3_farm` | ферма, участки, растения | нет |
| 6 | `stage3_bars` | рецепты бара, меню | нет |
| 7 | `stage3_intoxication` | поля персонажа | нет, nullable |
| 8 | `stage3_clans` | кланы, участники, права, склад, журнал, отношения, приглашения | нет |

Миграция 4 — единственная с перестройкой индекса. Порядок операций: добавить
колонку с дефолтом, заполнить, создать новый уникальный индекс, удалить старый.
На текущем объёме занимает секунды, но репетиция на копии прод-БД обязательна.
