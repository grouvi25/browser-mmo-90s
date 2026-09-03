# Этап 4 — модель данных

Приложение к `STAGE4_OVERVIEW.md`. Имена таблиц, полей и enum-значений
канонические: реализация обязана использовать их дословно.

Политика миграций наследуется от Этапа 3 без изменений:

- только добавление таблиц и **nullable** полей;
- ни одно значение enum не удаляется и не переименовывается;
- добавление значения в enum — отдельным оператором
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, потому что проверка аддитивности
  в CI отклоняет всё остальное;
- каждый новый коэффициент живёт в `BalanceConfig`, а не в коде формул.

---

# 1. Что уже стоит в схеме

Эти поля добавлены заделом в Этапах 1–3 и в миграциях не нуждаются.
Этап 4 их **использует**, а не создаёт:

| Объект | Поле | Назначение в Этапе 4 |
|---|---|---|
| `BattleType` | `CLAN`, `TERRITORY` | типы боёв этапа |
| `BattleParticipant` | `side` | стороны в бою за территорию |
| `User` | `isPremium`, `premiumExpiresAt` | подписка |
| `WeaponSkill` | `premiumMultiplier` | множитель опыта навыка |
| `ItemSourceType` | `PREMIUM` | источник предметов премиум-магазина |
| `OwnerType` | `CLAN` | клановая собственность на объект |
| `ProductionObject` | `ownerClanId` | владелец-клан |
| `ProductionObject` | `locationId` | привязка объекта к району |
| `ProductionObject` | `status = DAMAGED` | результат диверсии |
| `ProductionObject` | `durabilityCurrent` | цель диверсии |
| `BattleAction` | `CHANGE_WEAPON` | переодевание в бою |

`locationId` — единственное поле из списка, которое сегодня не заполняется
ничем. Шаг F0 проставляет его всем объектам сида; до этого территории
бессмысленны, потому что бонус района некому применять.

---

# 2. Новые enum

```prisma
enum TerritoryStatus {
  NEUTRAL     // ничей
  CONTROLLED  // под контролем клана
  CONTESTED   // подана заявка, бой назначен
  UNDER_ATTACK// бой идёт
  PROTECTED   // 48 часов после захвата
}

enum TerritoryClaimStatus {
  PENDING     // подана, ждёт назначенного времени
  BATTLE      // бой идёт
  WON         // заявка выиграна, контроль передан
  LOST        // заявка проиграна
  CANCELLED   // отозвана подавшим или отменена системой
  EXPIRED     // истекла без боя
}

enum ObjectAttackType {
  SABOTAGE    // диверсия: прочность и простой
  ROBBERY     // ограбление: доля баланса
}

enum ObjectAttackResult {
  SUCCESS
  REPELLED    // объект защищён территорией обороняющегося
  BLOCKED     // кулдаун, нищий объект, вне клана
}

enum HelperStatus {
  ACTIVE      // подписка активна, работает
  DORMANT     // подписки нет, остаётся в профиле
}

enum PremiumProductKind {
  TIME        // ускорение того, чего можно дождаться
  COSMETIC    // не влияет на механику
  CONVENIENCE // удобство, не влияет на бой
}

enum ClanAuthorityReason {
  TERRITORY_WON
  TERRITORY_DEFENDED
  TERRITORY_HELD
  CYCLE_COMPLETED
  SHIFT_COMPLETED
  CLAIM_FILED
  SABOTAGE_FILED
  ROBBERY_FILED
  ADMIN_ADJUST
}
```

Добавляемые значения в существующие enum:

```sql
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'SABOTAGED';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'ROBBED';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'TRANSFERRED_TO_CLAN';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'TERRITORY_UPKEEP';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'TERRITORY_CLAIM_FEE';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'TERRITORY_MARKET_SHARE';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'OBJECT_ROBBERY';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'HELPER_SALARY';
```

---

# 3. Территории

```prisma
model Territory {
  id            String          @id @default(uuid())
  code          String          @unique   // 'center', 'market', ...
  name          String
  status        TerritoryStatus @default(NEUTRAL)

  ownerClanId   String?         @map("owner_clan_id")
  controlledAt  DateTime?       @map("controlled_at")
  protectedUntil DateTime?      @map("protected_until")

  // Бонус района. Тип и величина — из сида, не из кода.
  bonusCode     String          @map("bonus_code")
  bonusValue    Float           @map("bonus_value")

  // Порядковый номер владения у клана: определяет ступень содержания.
  // Пересчитывается при каждой смене владельца.
  upkeepTier    Int             @default(1) @map("upkeep_tier")
  upkeepDebt    Int             @default(0) @map("upkeep_debt")

  createdAt     DateTime        @default(now()) @map("created_at")
  updatedAt     DateTime        @updatedAt @map("updated_at")

  ownerClan     Clan?           @relation(fields: [ownerClanId], references: [id])
  claims        TerritoryClaim[]

  @@index([ownerClanId])
  @@index([status])
  @@map("territories")
}
```

Замечания:

- `code` совпадает с ключом района в `MENU.districts` фронта. Это единственная
  связь карты города с территориями, и она держится на совпадении строк —
  проверяется тестом, а не надеждой.
- `bonusCode` и `bonusValue` вынесены в данные, потому что подбор бонусов —
  предмет балансировки, а балансировка не должна требовать выката кода.
- `upkeepDebt` повторяет решение Этапа 3 по зарплате: если общак пуст,
  содержание копится долгом, а не отбирает территорию мгновенно. Клан, который
  разорился на час, не должен терять район, за который дрался неделю.

```prisma
model TerritoryClaim {
  id             String               @id @default(uuid())
  territoryId    String               @map("territory_id")
  attackerClanId String               @map("attacker_clan_id")
  defenderClanId String?              @map("defender_clan_id") // null для ничейной
  filedByCharacterId String           @map("filed_by_character_id")

  status         TerritoryClaimStatus @default(PENDING)
  battleStartsAt DateTime             @map("battle_starts_at")
  battleId       String?              @unique @map("battle_id")

  feePaid        Int                  @map("fee_paid")
  authoritySpent Int                  @map("authority_spent")
  /** Победа без боя: обороняющийся никого не выставил. */
  walkover       Boolean              @default(false)

  createdAt      DateTime             @default(now()) @map("created_at")
  resolvedAt     DateTime?            @map("resolved_at")

  territory      Territory            @relation(fields: [territoryId], references: [id])
  attackerClan   Clan                 @relation("ClaimAttacker", fields: [attackerClanId], references: [id])
  defenderClan   Clan?                @relation("ClaimDefender", fields: [defenderClanId], references: [id])
  battle         Battle?              @relation(fields: [battleId], references: [id])
  roster         TerritoryClaimRoster[]

  @@index([territoryId, status])
  @@index([attackerClanId])
  @@map("territory_claims")
}

model TerritoryClaimRoster {
  id          String  @id @default(uuid())
  claimId     String  @map("claim_id")
  characterId String  @map("character_id")
  /** Сторона: 1 — атакующий клан, 2 — обороняющийся. Совпадает с
      BattleParticipant.side, чтобы состав переносился в бой один в один. */
  side        Int
  /** Вес бойца на момент записи в состав. Ниже порога не считается
      в проверке «пять бойцов от 3 уровня» — иначе заявку закрывают альтами. */
  battleLevel Int     @map("battle_level")

  createdAt   DateTime @default(now()) @map("created_at")

  claim       TerritoryClaim @relation(fields: [claimId], references: [id], onDelete: Cascade)
  character   Character      @relation(fields: [characterId], references: [id])

  @@unique([claimId, characterId])
  @@index([claimId, side])
  @@map("territory_claim_rosters")
}
```

Состав пишется **до** боя и в бой переносится дословно. Это защита от подмены
состава между подачей заявки и началом боя: обороняющийся видит, с кем будет
драться, с момента подачи — как и требует раздел об интерфейсе.

---

# 4. Бои за объекты

```prisma
model ObjectAttack {
  id             String             @id @default(uuid())
  objectId       String             @map("object_id")
  attackerClanId String             @map("attacker_clan_id")
  defenderClanId String?            @map("defender_clan_id")
  filedByCharacterId String         @map("filed_by_character_id")

  type           ObjectAttackType
  result         ObjectAttackResult

  /** Диверсия: сколько прочности снято. Ограбление: 0. */
  durabilityLost Int                @default(0) @map("durability_lost")
  /** Ограбление: сколько рублей ушло в общак атакующего. Диверсия: 0. */
  moneyTaken     Int                @default(0) @map("money_taken")
  /** Отменённый диверсией цикл, если он был. Сырьё по нему возвращено. */
  cancelledCycleId String?          @map("cancelled_cycle_id")

  authoritySpent Int                @map("authority_spent")
  createdAt      DateTime           @default(now()) @map("created_at")

  object         ProductionObject   @relation(fields: [objectId], references: [id])
  attackerClan   Clan               @relation("AttackAttacker", fields: [attackerClanId], references: [id])
  defenderClan   Clan?              @relation("AttackDefender", fields: [defenderClanId], references: [id])

  @@index([objectId, createdAt])
  @@index([attackerClanId, createdAt])
  @@map("object_attacks")
}
```

Кулдаун в 72 часа считается запросом по `@@index([objectId, createdAt])`, а не
отдельным полем на объекте: поле пришлось бы чистить, индекс — нет.

Отдельной таблицы «восстановление» не заводится. Повреждённый объект чинится
существующими восстановительными работами Этапа 3: статус `DAMAGED` уже
включает их режим, а `ProductionLog` уже пишет ход ремонта. Дублировать это
второй сущностью значит завести второй источник правды о состоянии объекта.

---

# 5. Авторитет клана

```prisma
model ClanAuthorityLog {
  id        String              @id @default(uuid())
  clanId    String              @map("clan_id")
  amount    Float               // может быть отрицательным
  reason    ClanAuthorityReason
  /** Свободная ссылка на источник: id заявки, цикла, смены, атаки. */
  refId     String?             @map("ref_id")
  balanceAfter Float            @map("balance_after")
  createdAt DateTime            @default(now()) @map("created_at")

  clan      Clan                @relation(fields: [clanId], references: [id], onDelete: Cascade)

  @@index([clanId, createdAt])
  @@map("clan_authority_logs")
}
```

В `Clan` добавляется одно nullable-совместимое поле с умолчанием:

```prisma
// в model Clan
authority       Float @default(0)
territoryLimit  Int   @default(2) @map("territory_limit")
```

Текущее значение хранится на клане, а не считается из журнала каждый раз:
авторитет проверяется при каждой заявке и каждой атаке, а журнал растёт линейно
от активности. `balanceAfter` в журнале позволяет сверить одно с другим —
той же сверкой, какой Этап 5 ловит дюп.

Дробный тип у `amount` и `authority` не случаен: смена даёт 0.2, и целое поле
округлило бы её в ноль.

---

# 6. Premium и помощники

```prisma
model PremiumProduct {
  id          String             @id @default(uuid())
  code        String             @unique
  name        String
  description String
  kind        PremiumProductKind
  priceRub    Int                @map("price_rub")
  /** Что выдаётся: ключ эффекта, разбирается сервисом. */
  grantCode   String             @map("grant_code")
  grantValue  Int                @default(0) @map("grant_value")
  isActive    Boolean            @default(true) @map("is_active")
  sortOrder   Int                @default(0) @map("sort_order")

  @@map("premium_products")
}

model PremiumPurchase {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  productId  String   @map("product_id")
  priceRub   Int      @map("price_rub")
  /** Кто оформил: в первой версии оплата вне игры, оформляет админ. */
  grantedByAdminId String? @map("granted_by_admin_id")
  createdAt  DateTime @default(now()) @map("created_at")

  user       User           @relation(fields: [userId], references: [id])
  product    PremiumProduct @relation(fields: [productId], references: [id])

  @@index([userId, createdAt])
  @@map("premium_purchases")
}
```

`priceRub` дублируется в покупке намеренно: цена в каталоге меняется, а история
покупок обязана остаться неизменной. Тот же приём уже применён в рыночных
сделках Этапа 2.

```prisma
model Helper {
  id           String       @id @default(uuid())
  characterId  String       @map("character_id")
  name         String
  status       HelperStatus @default(ACTIVE)
  /** Профессия и её уровень — свои, не хозяйские. Потолок 3. */
  professionCode  String    @map("profession_code")
  professionLevel Int       @default(0) @map("profession_level")
  professionExp   Float     @default(0) @map("profession_exp")

  /** Текущая смена, если помощник занят. */
  activeShiftId String?     @unique @map("active_shift_id")

  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt @map("updated_at")

  character    Character    @relation(fields: [characterId], references: [id], onDelete: Cascade)
  activeShift  WorkShift?   @relation(fields: [activeShiftId], references: [id])

  @@index([characterId])
  @@map("helpers")
}
```

В `WorkShift` добавляется одно nullable-поле:

```prisma
// в model WorkShift
helperId String? @map("helper_id")
```

Смена помощника — **обычная смена** с проставленным `helperId`. Это
принципиальное решение: вклад труда, зарплата, износ оборудования и закрытие
цикла продолжают работать по коду Этапа 3 без единой правки. Отличается только
множитель эффективности, который читает `helperId` и берёт 0.6.

Альтернатива — отдельная таблица «смена помощника» — потребовала бы вторую
реализацию всей механики цикла и второй источник правды о вкладе труда.

---

# 7. Порядок миграций

Четыре миграции, каждая аддитивна и обратима откатом без потери данных.

| # | Имя | Содержание |
|---|---|---|
| 1 | `stage4_enums` | все новые enum, все `ADD VALUE IF NOT EXISTS` |
| 2 | `stage4_territories` | `territories`, `territory_claims`, `territory_claim_rosters` |
| 3 | `stage4_warfare` | `object_attacks`, `clan_authority_logs`, поля `Clan.authority`, `Clan.territoryLimit` |
| 4 | `stage4_premium_helpers` | `premium_products`, `premium_purchases`, `helpers`, поле `WorkShift.helperId` |

Первая миграция отдельная и только с enum: Postgres не позволяет использовать
добавленное значение enum в той же транзакции, где оно создано. В Этапе 3 на
это уже наступали — разделение обязательно.

Порядок выката совпадает с порядком шагов работ: `stage4_territories` едет с
F1, `stage4_warfare` с F3, `stage4_premium_helpers` с F5. Каждый шаг
принимается и выкатывается отдельно.

---

# 8. Инварианты

Проверяются тестами, а не соглашением.

1. Сумма `ClanAuthorityLog.amount` по клану равна `Clan.authority`.
2. У клана не больше `territoryLimit` территорий в статусе `CONTROLLED`.
3. `Territory.upkeepTier` равен порядковому номеру территории у владельца:
   если у клана две, у одной tier 1, у другой tier 2.
4. Территория в статусе `PROTECTED` не имеет заявок в статусе `PENDING`.
5. Заявка в статусе `BATTLE` имеет непустой `battleId`.
6. Состав `TerritoryClaimRoster` совпадает с `BattleParticipant` связанного боя
   по персонажам и сторонам.
7. Не больше одной атаки на объект за 72 часа.
8. `ObjectAttack.moneyTaken` не превышает потолок ограбления и 20% баланса
   объекта на момент атаки.
9. У персонажа не больше 2 помощников.
10. Помощник в статусе `DORMANT` не имеет `activeShiftId`.
11. `WorkShift` с непустым `helperId` не имеет `characterId`, отличного от
    хозяина помощника.
12. Ни один `PremiumProduct` не выдаёт предмет с ненулевым бюджетом статов.
    Проверяется сверкой `grantCode` со справочником предметов.

Инвариант 12 — машинная форма правила «премиум продаёт время, а не силу».
Он единственный из списка, который защищает не данные, а замысел игры,
и потому должен падать громко.
