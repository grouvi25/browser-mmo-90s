# Этап 3 — контракты API

Приложение к `MASTER_TZ_STAGE_3_CRAFT_CLANS_ECONOMY`.

Общие правила, унаследованные с Этапа 2 и обязательные здесь:

- аутентификация JWT, чужие идентификаторы → 403 или 404, никогда 200 с пустым;
- любая мутация с деньгами, предметами или ресурсами требует заголовок
  `Idempotency-Key` (UUID на операцию); повтор возвращает сохранённый ответ
  с `replayed: true`;
- ошибки — код из закрытого списка плюс человекочитаемое сообщение;
- валидация zod, невалидное значение → 422 с указанием поля;
- денежные операции только через `EconomyService`, ресурсные — через
  `ResourcesService`.

Коды ошибок этапа: `PROD_*` (производство), `FARM_*`, `BAR_*`, `CLAN_*`.

---

# 1. Производство и объекты

## 1.1. Каталог объектов на продажу

```
GET /api/objects/market
→ 200 { items: [{
    id, code, name, type, professionCode, professionLevel,
    purchasePrice, baseSalary, storageCapacity,
    recipes: [{ code, name, cycleMinutes, laborRequired, inputs, output }],
    canBuy: boolean, blockedReason: string | null
  }] }
```

`blockedReason` — почему кнопка недоступна: `NO_MONEY`, `PROFESSION_TOO_LOW`,
`OBJECT_LIMIT_REACHED`. Клиент не должен вычислять это сам.

## 1.2. Покупка объекта

```
POST /api/objects/:id/buy        Idempotency-Key
→ 201 { object: {...}, newBalance }
409 PROD_001  объект уже продан
409 PROD_002  лимит объектов на персонажа
400 PROD_003  профессия ниже требуемой
400 INSUFFICIENT_FUNDS
```

Транзакция: списать деньги, сменить `ownerType` на `PRIVATE`, записать
`CurrencyLog(OBJECT_PURCHASE)` и `ProductionLog(OBJECT_OWNERSHIP_CHANGED)`.

## 1.3. Продажа объекта государству

```
POST /api/objects/:id/sell       Idempotency-Key
→ 200 { payout, newBalance }
409 PROD_004  на объекте идёт цикл или есть активные смены
409 PROD_005  на складе объекта остались ресурсы
```

Выплата: `purchasePrice × objectResaleRate` (0.5). Перепродажа между игроками на
Этапе 3 не предусмотрена — только государству, чтобы не появился второй рынок
без антиабуза.

## 1.4. Мои объекты

```
GET /api/objects/mine
→ 200 { items: [{
    id, name, balance, maintenanceDebt,
    activeRecipe: { code, name } | null,
    cycle: { id, status, progress, endsAt, failureReason } | null,
    equipment: { tier, durabilityCurrent, durabilityMax },
    workers: { active: number, slots: number },
    inventory: [{ resourceCode, quality, amount, reservedAmount }],
    storageUsed, storageCapacity,
    salary: { current, min, max },
    profileSwitchingUntil
  }] }
```

## 1.5. Управление объектом

```
PATCH /api/objects/:id/salary    { salary: number }
→ 200 { salary }
400 PROD_006  ставка вне коридора [base × 0.5, base × 2.0]

POST /api/objects/:id/balance    { amount: number }   Idempotency-Key
→ 200 { balance, newCharacterBalance }

POST /api/objects/:id/withdraw   { amount: number }   Idempotency-Key
→ 200 { balance, newCharacterBalance, tax }
409 PROD_007  сумма больше баланса объекта

POST /api/objects/:id/profile    { recipeCode: string }   Idempotency-Key
→ 200 { activeRecipeId, switchingUntil, cost }
409 PROD_008  объект повреждён
409 PROD_009  смена профиля уже идёт
```

## 1.6. Склад объекта

```
POST /api/objects/:id/stock/put   { resourceCode, quality, amount }  Idempotency-Key
→ 200 { inventory, storageUsed }
409 PROD_010  склад переполнен
409 PROD_011  недостаточно ресурса у персонажа

POST /api/objects/:id/stock/take  { resourceCode, quality, amount }  Idempotency-Key
→ 200 { inventory, storageUsed }
409 PROD_012  ресурс зарезервирован под цикл
```

## 1.7. Циклы

```
GET  /api/objects/:id/cycles?limit=20
→ 200 { items: [{ id, recipeCode, status, laborRequired, laborAccumulated,
                  startedAt, endsAt, completedAt, failureReason,
                  contributors: [{ nickname, laborMinutes }] }] }

POST /api/objects/:id/cycles/start   Idempotency-Key
→ 201 { cycle }
409 PROD_013  условия не выполнены, поле reason содержит ProductionCycleFailure
```

Ручной старт нужен владельцу, чтобы не ждать воркера. Автоматический старт —
воркер `production-cycle` раз в минуту.

## 1.8. Обслуживание оборудования

```
POST /api/objects/:id/equipment/repair   Idempotency-Key
→ 200 { durabilityCurrent, spent: { money, resources } }
409 PROD_014  оборудование не изношено
409 PROD_015  недостаточно деталей
```

## 1.9. Восстановительные работы

```
POST /api/work/shifts/start  { productionObjectId, mode: "PRODUCTION" | "RESTORATION" }
```

Поле `mode` добавляется к существующему контракту. При `RESTORATION`: зарплата
не начисляется, профессиональный опыт умножается на `restorationExpMultiplier`,
доступно только для объектов в статусе `DAMAGED`.

---

# 2. Ферма

```
GET /api/farm
→ 200 { farm: { balance, plotsOwned },
        plots: [{ index, status, plantCode, plantedAt, readyAt, withersAt,
                  waterCount, canWater, buildingType,
                  remainingSeconds, neighbourBonus }],
        nextPlotPrice: number | null }

POST /api/farm/plots/buy          Idempotency-Key
→ 201 { plot, newBalance }
409 FARM_001  достигнут максимум участков

POST /api/farm/plots/:index/plant  { plantCode }   Idempotency-Key
→ 200 { plot }
400 FARM_002  уровень профессии ниже требуемого растением
409 FARM_003  участок занят
400 INSUFFICIENT_FUNDS  не хватает на семена

POST /api/farm/plots/:index/water  Idempotency-Key
→ 200 { plot, newReadyAt }
409 FARM_004  полив на перезарядке
409 FARM_005  достигнут предел поливов

POST /api/farm/plots/:index/harvest  Idempotency-Key
→ 200 { resources: [{ code, quality, amount }], exp, plot }
409 FARM_006  урожай не готов
409 FARM_007  урожай засох — сначала перекопать

POST /api/farm/plots/:index/clear   Idempotency-Key
→ 200 { plot }

POST /api/farm/buildings           { index, type }   Idempotency-Key
→ 201 { plot, newBalance }
409 FARM_008  участок занят посадкой

POST /api/farm/withdraw            { amount }        Idempotency-Key
→ 200 { farmBalance, newCharacterBalance }

GET  /api/plants
→ 200 { items: [PlantTemplate] }
```

`remainingSeconds` и `canWater` считает сервер: клиент не должен повторять
формулу роста, иначе таймеры разъедутся.

---

# 3. Бары

```
GET /api/bars
→ 200 { items: [{ id, name, ownerNickname, menu: [{ recipeCode, name,
        category, price, hpRestore, intoxication, buff, available }] }] }

POST /api/bars/:id/buy   { recipeCode }   Idempotency-Key
→ 200 { hpRestored, intoxication: { value, tier, name },
        buff: { code, until } | null, newBalance }
409 BAR_001  позиция недоступна: нет ингредиентов
409 BAR_002  персонаж в бою
409 BAR_003  похмелье: пить нельзя
409 BAR_004  бонус уже брали, доступен через N часов

GET  /api/bars/mine/:id/menu
PATCH /api/bars/mine/:id/menu   { items: [{ recipeCode, price, isActive }] }
→ 200 { menu }
400 BAR_005  цена вне коридора [себестоимость, себестоимость × 3]
```

Ответ покупки возвращает не «выпито», а конечное состояние персонажа: сколько HP
восстановлено, какой градус и ступень получились, какой бафф навешен. Клиент
показывает результат, а не пересчитывает.

---

# 4. Кланы

## 4.1. Создание и профиль

```
POST /api/clans   { code, name, motto? }   Idempotency-Key
→ 201 { clan }
400 CLAN_001  боевой уровень ниже требуемого
409 CLAN_002  имя или код заняты
409 CLAN_003  персонаж уже в клане
400 INSUFFICIENT_FUNDS

GET /api/clans?q=&page=&limit=
→ 200 { items: [{ code, name, motto, level, memberCount, memberLimit }], total }

GET /api/clans/:code
→ 200 { clan: {...}, members: [{ nickname, role, joinedAt, contributed }],
        relations: [{ clanCode, name, state }],
        myRole: ClanRole | null, myPermissions: ClanPermissionCode[] }
```

## 4.2. Участники

```
POST   /api/clans/:code/invite   { nickname }
→ 201 { invite }
403 CLAN_004  нет права INVITE
409 CLAN_005  лимит участников
409 CLAN_006  приглашение уже отправлено

POST   /api/clans/:code/invite/accept   Idempotency-Key
→ 200 { clan, role }
409 CLAN_007  недавно вышел из клана, действует задержка
409 CLAN_008  приглашение истекло

DELETE /api/clans/:code/members/:nickname
→ 200 { removed: true }
403 CLAN_004  нет права KICK
409 CLAN_009  нельзя исключить главаря

PATCH  /api/clans/:code/members/:nickname   { role }
→ 200 { member }
403 CLAN_004  нет права ROLE_SET
409 CLAN_010  нельзя назначить второго главаря; передача власти — отдельная ручка

POST   /api/clans/:code/leave   Idempotency-Key
→ 200 { left: true }
409 CLAN_011  главарь не может выйти, сначала передать власть

POST   /api/clans/:code/transfer  { nickname }
→ 200 { newLeader }
```

## 4.3. Склад

```
GET  /api/clans/:code/storage
→ 200 { items: [{ id, kind: "ITEM" | "RESOURCE", ... , putBy, putAt }],
        used, capacity, myTakenToday, myTakeLimit }

POST /api/clans/:code/storage/put   { itemInstanceId } | { resourceCode, quality, amount }   Idempotency-Key
→ 200 { item, used }
403 CLAN_004  нет права STORAGE_PUT
409 CLAN_012  склад переполнен

POST /api/clans/:code/storage/take  { storageItemId, amount? }   Idempotency-Key
→ 200 { taken, myTakenToday }
403 CLAN_004  нет права STORAGE_TAKE
409 CLAN_013  дневной лимит выноса исчерпан
```

## 4.4. Общак

```
GET  /api/clans/:code/treasury
→ 200 { balance, maintenanceDebt, mySpentToday, mySpendLimit,
        operations: [{ actor, action, amount, createdAt }] }

POST /api/clans/:code/treasury/deposit  { amount }   Idempotency-Key
→ 200 { balance, newCharacterBalance, contributed }

POST /api/clans/:code/treasury/spend    { amount, purpose }   Idempotency-Key
→ 200 { balance, newCharacterBalance }
403 CLAN_004  нет права TREASURY_SPEND
409 CLAN_014  дневной лимит траты исчерпан
```

`purpose` обязателен и попадает в `ClanLog`. Трата без указания причины —
готовый конфликт внутри клана.

## 4.5. Отношения

```
GET  /api/clans/:code/relations
POST /api/clans/:code/relations   { targetClanCode, state }
→ 200 { relation }
403 CLAN_004  нет права RELATION_SET
409 CLAN_015  смена отношения на перезарядке (24 часа)
```

Правила: `ENEMY` устанавливается односторонне и действует сразу. `ALLY`
записывается с `confirmed = false` и вступает в силу, когда вторая сторона
выставит `ALLY` в ответ. Односторонний `ALLY` цен не меняет.

## 4.6. Журнал

```
GET /api/clans/:code/log?page=&limit=&action=
→ 200 { items: [{ actor, action, target, amount, details, createdAt }], total }
```

Журнал доступен всем участникам клана: прозрачность — единственная защита от
конфликтов вокруг общака.

---

# 5. Изменения в существующих контрактах

## 5.1. Рынок: цены по отношениям

```
GET /api/market/listings
→ 200 { items: [{ ...,
      price,                    // цена продавца
      finalPrice,               // с учётом отношения к продавцу
      relation: "OWN" | "ALLY" | "NEUTRAL" | "ENEMY",
      relationModifier: number  // -0.10 | -0.05 | 0 | +0.25
    }] }
```

`POST /api/market/listings/:id/buy` списывает `finalPrice`. Разница по наценке
уходит в налог с причиной `MARKET_RELATION_MARKUP`, продавцу приходит цена без
наценки.

## 5.2. Работа: вклад труда

```
POST /api/work/shifts/:id/claim
→ 200 { ..., cycleContribution: { cycleId, laborMinutes, cycleProgress } | null }
```

Игрок должен видеть, что его смена во что-то вложилась, иначе цикл выглядит
как чужая механика.

## 5.3. Персонаж: градус и клан

```
GET /api/characters/me
→ 200 { ..., intoxication: { value, tier, name, soberAt },
        hangoverUntil, clan: { code, name, role } | null }
```

---

# 6. Матрица прав

| Действие | LEADER | BRIGADIER | FIGHTER | ROOKIE |
|---|---|---|---|---|
| Приглашать | ✓ | ✓ | | |
| Исключать | ✓ | ✓ | | |
| Менять роли | ✓ | | | |
| Класть на склад | ✓ | ✓ | ✓ | ✓ |
| Брать со склада | ✓ | ✓ | ✓ (лимит 3) | |
| Вносить в общак | ✓ | ✓ | ✓ | ✓ |
| Тратить общак | ✓ | ✓ (лимит) | | |
| Менять отношения | ✓ | | | |
| Управлять объектами клана | ✓ | ✓ | | |
| Править профиль клана | ✓ | | | |

Матрица хранится в `ClanRolePermission` и создаётся при создании клана по этому
образцу. Главарь может её менять — но не может отнять у себя `ROLE_SET`,
иначе клан станет неуправляемым.
