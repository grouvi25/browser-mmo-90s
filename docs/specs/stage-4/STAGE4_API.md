# Этап 4 — контракты API

Приложение к `MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR`.

Общие правила наследуются с Этапов 2–3 без изменений:

- аутентификация JWT, чужие идентификаторы → 403 или 404, никогда 200 с пустым;
- любая мутация с деньгами, предметами или ресурсами требует заголовок
  `Idempotency-Key` (UUID на операцию); повтор возвращает сохранённый ответ
  с `replayed: true`;
- ошибки — код из закрытого списка плюс человекочитаемое сообщение;
- валидация zod, невалидное значение → 422 с указанием поля;
- денежные операции только через `EconomyService`, ресурсные — через
  `ResourcesService`;
- все таймеры считает сервер, клиент только отсчитывает.

Коды ошибок этапа: `TERR_*` (территории), `WAR_*` (заявки и атаки),
`PREM_*` (подписка и витрина), `HELP_*` (помощники).

Правило этапа, которого не было раньше: **причина отказа возвращается словами**.
В стратегическом слое отказ — половина игры: игрок обязан понимать, чего именно
не хватает, не заглядывая в документацию. Поле `reason` обязательно у всех
отказов, `blockedReason` — у всех списков с кнопками.

---

# 1. Территории

## 1.1. Карта территорий

```
GET /api/territories
→ 200 { items: [{
    code, name, status,
    owner: { clanId, name, tag } | null,
    bonus: { code, value, text },
    objectCount,
    protectedUntil: iso | null,
    activeClaim: { id, attackerTag, battleStartsAt } | null,
    myClan: {
      canClaim: boolean,
      blockedReason: 'NO_PERMISSION' | 'NO_CLAN' | 'PROTECTED' | 'CONTESTED'
        | 'LIMIT_REACHED' | 'NOT_ENOUGH_AUTHORITY' | 'NOT_ENOUGH_MONEY'
        | 'CLAN_COOLDOWN' | 'ALLY_OWNED' | null
    }
  }] }
```

`bonus.text` приходит с сервера готовой строкой («−15% ко времени цикла»):
иначе клиент повторяет таблицу бонусов и расходится с ней при первой правке
баланса.

`blockedReason` считает сервер. Клиент не должен вычислять право на заявку сам:
проверок восемь, и любая расхождение клиента с сервером выглядит как
сломанная кнопка.

## 1.2. Карточка территории

```
GET /api/territories/:code
→ 200 {
    ...поля из списка,
    upkeep: { tier, perDay, debt, bonusSuspended: boolean },
    objects: [{ id, name, type, ownerTag | null, status }],
    history: [{ at, event, clanTag }]   // последние 20 событий
  }
404 TERR_001  территория не найдена
```

`upkeep` показывается только участникам клана-владельца: чужой долг — не
публичная информация, иначе он превращается в сигнал «пора нападать».

## 1.3. Список территорий клана

```
GET /api/clans/:id/territories
→ 200 { items: [...], limit, upkeepPerDay, totalDebt }
403 CLAN_FORBIDDEN   не участник клана
```

---

# 2. Заявки на территорию

## 2.1. Подача заявки

```
POST /api/territories/:code/claims        Idempotency-Key
  { roster: [characterId, ...] }          // ровно 5
→ 201 { claim: { id, status, battleStartsAt, feePaid, authoritySpent } }

403 WAR_001  нет права WAR
400 WAR_002  в составе меньше пяти бойцов
400 WAR_003  боец ниже третьего уровня: <ник>
400 WAR_004  боец не состоит в клане: <ник>
409 WAR_005  на район уже подана заявка
409 WAR_006  район под защитой до <время>
409 WAR_007  клан подавал заявку менее 24 часов назад
409 WAR_008  достигнут предел территорий клана
409 WAR_009  район принадлежит союзному клану
400 WAR_010  не хватает авторитета: нужно 20, есть <n>
400 INSUFFICIENT_FUNDS  в общаке меньше 10 000 ₽
```

Транзакция подачи: проверить всё, списать 10 000 ₽ из общака
(`CurrencyLog(TERRITORY_CLAIM_FEE)`), списать 20 авторитета
(`ClanAuthorityLog(CLAIM_FILED)`), создать `TerritoryClaim` и
`TerritoryClaimRoster`, перевести территорию в `CONTESTED`.

Уникальный частичный индекс на `(territoryId)` при статусе `PENDING`/`BATTLE`
делает WAR_005 невозможным в гонке: вторая вставка падает на индексе, а не на
прочитанном ранее состоянии.

## 2.2. Состав обороны

```
POST /api/territories/:code/claims/:id/defence   Idempotency-Key
  { roster: [characterId, ...] }                 // до 5
→ 200 { roster: [...] }

403 WAR_011  район не принадлежит вашему клану
409 WAR_012  до боя меньше 10 минут, состав закрыт
400 WAR_003  боец ниже третьего уровня: <ник>
```

Состав обороны закрывается за 10 минут до боя. Без этого обороняющийся
подменяет состав в последнюю секунду, увидев, кого привёл атакующий.

## 2.3. Просмотр заявки

```
GET /api/territories/:code/claims/:id
→ 200 {
    id, status, battleStartsAt, battleId | null, walkover,
    attacker: { clanTag, roster: [{ nickname, battleLevel }] },
    defender: { clanTag, roster: [...] } | null
  }
```

Состав атакующего виден обороняющемуся **с момента подачи**. Это сознательное
решение: внезапное нападение в асинхронной игре означает, что побеждает тот,
кто оказался онлайн, а не тот, кто лучше играет.

## 2.4. Отзыв заявки

```
DELETE /api/territories/:code/claims/:id
→ 200 { status: 'CANCELLED', feeRefunded: false }
403 WAR_001  нет права WAR
409 WAR_013  бой уже начался
```

Взнос не возвращается. Возвратный взнос превращает заявку в бесплатную
разведку состава обороны.

## 2.5. Журнал войн клана

```
GET /api/clans/:id/wars?limit=20&cursor=
→ 200 { items: [{ at, territoryCode, role: 'ATTACK'|'DEFENCE',
                  result, authorityDelta, battleId | null }], nextCursor }
```

---

# 3. Бои за объекты

## 3.1. Что можно атаковать

```
GET /api/objects/attackable
→ 200 { items: [{
    objectId, name, type, districtCode,
    ownerClanTag, balanceBand: 'LOW'|'NORMAL'|'HIGH',
    cooldownUntil: iso | null,
    canSabotage: boolean, canRob: boolean,
    blockedReason: 'COOLDOWN' | 'NOT_AT_WAR' | 'OWNER_SOLO'
      | 'TOO_POOR' | 'NO_AUTHORITY' | 'NO_PERMISSION' | null
  }] }
```

`balanceBand` вместо точной суммы: точный баланс чужого объекта — разведка,
которую не должна давать бесплатная ручка списка. Порог ограбления при этом
виден (`TOO_POOR`), и этого достаточно для решения.

## 3.2. Диверсия

```
POST /api/objects/:id/sabotage        Idempotency-Key
→ 200 { durabilityLost, newDurability, status: 'DAMAGED',
        cancelledCycleId | null, authoritySpent: 12 }

403 WAR_001   нет права WAR
409 WAR_020   объект атаковали менее 72 часов назад
409 WAR_021   с владельцем нет вражды и он не владеет вашим спорным районом
409 WAR_022   владелец не состоит в клане
400 WAR_010   не хватает авторитета: нужно 12, есть <n>
```

Транзакция: `SELECT ... FOR UPDATE` по объекту, снять 40 прочности, перевести
в `DAMAGED`, отменить активный цикл с **полным возвратом сырья** на склад
объекта, списать авторитет, записать `ObjectAttack` и
`ProductionLog(SABOTAGED)`.

Сырьё возвращается, а не сгорает: ущерб — потерянное время, а не материал.
Труд рабочих уже оплачен, и наказывать войной надо владельца, а не наёмного
работника.

## 3.3. Ограбление

```
POST /api/objects/:id/rob             Idempotency-Key
→ 200 { moneyTaken, treasuryAfter, authoritySpent: 25 }

409 WAR_023   на балансе объекта меньше 5 000 ₽
(остальные коды те же, что у диверсии)
```

Транзакция: `SELECT ... FOR UPDATE` по объекту и общаку, снять
`min(баланс × 0.20, 8 000)`, зачислить в общак атакующего, две записи
`CurrencyLog(OBJECT_ROBBERY)` — списание и зачисление с общим correlation id.

Ограбление не трогает склад объекта. Вынос ресурсов конвертировал бы войну в
производство, и воевать стало бы выгоднее, чем работать.

---

# 4. Авторитет и клановая собственность

## 4.1. Авторитет клана

```
GET /api/clans/:id/authority
→ 200 { current, log: [{ at, amount, reason, refId, balanceAfter }] }
403 CLAN_FORBIDDEN
```

## 4.2. Перевод объекта в клан

```
POST /api/objects/:id/transfer-to-clan     Idempotency-Key
→ 200 { object: {...}, treasuryAfter }

403 WAR_030   нет права OBJECTS
403 WAR_031   вы не владелец объекта
409 WAR_032   у клана достигнут предел объектов: <limit>
409 WAR_033   объект повреждён, сначала восстановите
```

Транзакция: сменить `ownerType` на `CLAN`, проставить `ownerClanId`, обнулить
`ownerCharacterId`, перелить баланс объекта в общак, записать
`ProductionLog(TRANSFERRED_TO_CLAN)`.

**Операция необратима**, и ручка обязана сказать это в ответе на предпросмотр
(`GET /api/objects/:id/transfer-preview`). Необратимость — защита от схемы
«перевёл в клан, снял через общак, вышел из клана».

Предел клана: `2 + 2 × число территорий`.

---

# 5. Premium

## 5.1. Состояние подписки

```
GET /api/premium/me
→ 200 { isPremium, expiresAt | null,
        benefits: { skillMultiplier, helperSlots, dailyShiftCap, loadoutSlots } }
```

Числа льгот приходят с сервера, а не зашиты в клиент: они живут в
`BalanceConfig` и меняются без выката фронта.

## 5.2. Витрина

```
GET /api/premium/shop
→ 200 { items: [{ code, name, description, kind, priceRub, grantCode }] }
```

## 5.3. Выдача подписки и товара

```
POST /api/admin/premium/grant          админская, Idempotency-Key
  { userId, productCode, days? }
→ 200 { purchase: {...}, isPremium, expiresAt }

403 ADMIN_FORBIDDEN
404 PREM_001  товар не найден
400 PREM_002  товар выдаёт предмет со статами — запрещено
```

В первой версии оплата вне игры, оформляет администратор. Запись
`PremiumPurchase` хранит `priceRub` копией из каталога: цена в каталоге
меняется, история покупок обязана остаться неизменной.

PREM_002 — рантайм-форма инварианта 12: даже если кто-то заведёт в витрину
предмет со статами, выдать его не удастся.

---

# 6. Помощники

## 6.1. Список

```
GET /api/helpers
→ 200 { items: [{ id, name, status, professionCode, professionLevel,
                  activeShift: { objectId, endsAt } | null }],
        slots: { used, total } }
```

## 6.2. Найм

```
POST /api/helpers            Idempotency-Key
  { name, professionCode }
→ 201 { helper: {...} }

409 HELP_001  нет активной подписки
409 HELP_002  все слоты заняты: <total>
400 HELP_003  неизвестная профессия
```

## 6.3. Смена помощника

```
POST /api/helpers/:id/work   Idempotency-Key
  { objectId }
→ 201 { shift: { id, endsAt, salary } }

409 HELP_001  нет активной подписки
409 HELP_004  помощник уже на смене
409 HELP_005  профессия помощника ниже требуемой объектом
409 WORK_*    общие отказы смены Этапа 3
```

Создаётся **обычная `WorkShift`** с `helperId`. Вклад труда, зарплата, износ
оборудования и закрытие цикла идут по коду Этапа 3 без правок; отличается
только множитель эффективности 0.6.

Отдельной ручки «забрать смену помощника» нет: смена закрывается тем же
`POST /api/work/shifts/:id/claim`, что и своя.

---

# 7. Переодевание в бою

## 7.1. Смена оружия

```
POST /api/battles/:id/action           Idempotency-Key
  { action: 'CHANGE_WEAPON', hand: 'LEFT_HAND'|'RIGHT_HAND', itemInstanceId }
→ 200 { turn: {...}, pointsLeft }

409 BATTLE_020  не ваш ход
409 BATTLE_021  не хватает очков хода
400 BATTLE_022  предмет не в инвентаре или не оружие
```

Смена оружия тратит **одно очко хода** из двух. Игрок, сменивший оружие,
может нанести только один удар вместо двух — нападение по-прежнему уменьшает
защиту.

## 7.2. Смена брони

```
POST /api/battles/:id/action           Idempotency-Key
  { action: 'CHANGE_ARMOR', zone: BodyZone, itemInstanceId }
→ 200 { turn: {...}, pointsLeft: 0 }

409 BATTLE_023  на эту зону в текущем ходу поставлен блок
```

Смена брони тратит **ход целиком**. BATTLE_023 закрывает очевидную
эксплуатацию: поставить блок, увидеть удар, подменить броню под него.

---

# 8. Матрица прав

| Ручка | Право | Кто по умолчанию |
|---|---|---|
| `POST /territories/:code/claims` | `WAR` | Главарь, Бригадир |
| `DELETE /territories/:code/claims/:id` | `WAR` | Главарь, Бригадир |
| `POST /claims/:id/defence` | `WAR` | Главарь, Бригадир |
| `POST /objects/:id/sabotage` | `WAR` | Главарь, Бригадир |
| `POST /objects/:id/rob` | `WAR` | Главарь, Бригадир |
| `POST /objects/:id/transfer-to-clan` | `OBJECTS` | Главарь, Бригадир |
| `GET /clans/:id/territories` | участник | все |
| `GET /clans/:id/authority` | участник | все |
| `POST /admin/premium/grant` | админ | роль администратора |

Проверяется **право, а не роль** — правило Этапа 3 сохраняется. Главарь может
перенастроить любое право, кроме права назначать роли.

---

# 9. Полный список кодов ошибок

| Код | Смысл |
|---|---|
| `TERR_001` | территория не найдена |
| `WAR_001` | нет права `WAR` |
| `WAR_002` | в составе меньше пяти бойцов |
| `WAR_003` | боец ниже третьего уровня |
| `WAR_004` | боец не состоит в клане |
| `WAR_005` | на район уже подана заявка |
| `WAR_006` | район под защитой |
| `WAR_007` | пауза клана между заявками |
| `WAR_008` | предел территорий клана |
| `WAR_009` | район у союзного клана |
| `WAR_010` | не хватает авторитета |
| `WAR_011` | район не принадлежит вашему клану |
| `WAR_012` | состав обороны закрыт |
| `WAR_013` | бой уже начался |
| `WAR_020` | кулдаун атаки объекта |
| `WAR_021` | нет оснований для атаки |
| `WAR_022` | владелец объекта вне клана |
| `WAR_023` | на объекте слишком мало денег |
| `WAR_030` | нет права `OBJECTS` |
| `WAR_031` | вы не владелец объекта |
| `WAR_032` | предел объектов клана |
| `WAR_033` | объект повреждён |
| `PREM_001` | товар витрины не найден |
| `PREM_002` | товар выдаёт предмет со статами |
| `HELP_001` | нет активной подписки |
| `HELP_002` | слоты помощников заняты |
| `HELP_003` | неизвестная профессия |
| `HELP_004` | помощник уже на смене |
| `HELP_005` | профессия помощника ниже требуемой |
| `BATTLE_020` | не ваш ход |
| `BATTLE_021` | не хватает очков хода |
| `BATTLE_022` | предмет не подходит |
| `BATTLE_023` | зона заблокирована в этом ходу |
