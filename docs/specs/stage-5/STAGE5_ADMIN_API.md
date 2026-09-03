# Этап 5 — админка: контракты и обратимость

Приложение к `MASTER_TZ_STAGE_5_FINAL_ASSEMBLY_RELEASE_PREP`.

Общие правила всех административных ручек:

- префикс `/api/admin`, отдельная аутентификация (`admin-auth`), свой rate
  limit (5 попыток входа в минуту — уже реализовано);
- любая мутация требует поле `reason` длиной **от 10 символов**; короче или
  пусто → 422 с указанием поля;
- любая мутация требует `Idempotency-Key`;
- любая мутация пишет `AdminActionLog` с обратной операцией;
- ответ мутации всегда содержит `actionId` — по нему выполняется откат;
- роль проверяется до всего остального: 403 раньше 404, чтобы `SUPPORT` не мог
  перебором узнать, какие id существуют.

Коды ошибок: `ADMIN_*`.

---

# 1. Что уже есть

Семнадцать ручек: пятнадцать от Этапа 3 и две от Этапа 4. Все остаются, к
мутирующим добавляется `reason` и запись в журнал.

| Ручка | Тип |
|---|---|
| `GET /users` | чтение |
| `GET /characters/:id` | чтение |
| `GET /battles/:id` | чтение |
| `GET /stats` | чтение |
| `GET /economy/overview` | чтение |
| `GET /logs/currency`, `/logs/items`, `/logs/resources` | чтение |
| `GET /market/listings` | чтение |
| `GET /work/shifts` | чтение |
| `POST /grant-money` | **мутация, требует доработки** |
| `POST /grant-item` | **мутация, требует доработки** |
| `POST /market/listings/:id/lock` / `/unlock` | **мутация, требует доработки** |
| `POST /private-shops/items/:id/deactivate` | **мутация, требует доработки** |
| `POST /premium/grant` (Этап 4) | **мутация, требует доработки** |
| `POST /premium/revoke` (Этап 4) | **мутация, требует доработки** |

«Требует доработки» означает ровно два добавления: обязательное `reason` и
запись обратной операции. Логику трогать не нужно.

---

# 2. Журнал административных действий

## 2.1. Модель

```prisma
enum AdminActionKind {
  GRANT_MONEY
  TAKE_MONEY
  GRANT_ITEM
  DELETE_ITEM
  EDIT_CHARACTER
  BAN_USER
  UNBAN_USER
  LOCK_LISTING
  UNLOCK_LISTING
  FREEZE_MARKET
  UNFREEZE_MARKET
  END_BATTLE
  EDIT_CATALOG
  GRANT_PREMIUM
  REVOKE_PREMIUM
  RESET_TERRITORY
  EXPIRE_CLAIM
  CLEAR_ATTACK_COOLDOWN
  ADJUST_AUTHORITY
  SLEEP_HELPER
  ROLLBACK
}

model AdminActionLog {
  id          String          @id @default(uuid())
  adminId     String          @map("admin_id")
  /** Роль на момент действия. Роль аккаунта может измениться позже,
      история обязана остаться правдивой. */
  adminRole   AdminRole       @map("admin_role")
  kind        AdminActionKind
  reason      String

  /** Кого/что затронуло: тип и id. Свободная пара, потому что цели
      разнородны — персонаж, предмет, лот, клан, территория. */
  targetType  String          @map("target_type")
  targetId    String          @map("target_id")

  /** Параметры выполненной операции и параметры обратной к ней.
      Обратная обязательна: действие без неё не заводится (принцип П1). */
  payload     Json
  undoKind    AdminActionKind @map("undo_kind")
  undoPayload Json            @map("undo_payload")

  /** Если это откат — ссылка на отменённое действие. */
  rolledBackId String?        @unique @map("rolled_back_id")
  rolledBackAt DateTime?      @map("rolled_back_at")

  /** Общий идентификатор для сшивания с денежными и предметными журналами. */
  correlationId String        @map("correlation_id")
  createdAt     DateTime      @default(now()) @map("created_at")

  @@index([adminId, createdAt])
  @@index([targetType, targetId])
  @@index([correlationId])
  @@map("admin_action_logs")
}
```

`rolledBackId` уникален: одно действие нельзя откатить дважды. Это не
удобство, а защита — двойной откат выдачи денег превратился бы в списание.

**Идентификатор действия выдаётся до исполнения.** Денежный и предметный
журналы ссылаются на него прямо в момент записи (`refType='admin_action'` у
денег, `details.adminActionId` у предметов), а сослаться на строку, которой
ещё нет, нельзя. Без этого цепочка транзакций не связывает выданные деньги с
админом, который их выдал, — что и случилось на первом прогоне тестов.

**Исполнители прямой и обратной операции — один и тот же код.** Откат выдачи
денег это списание, а списание админ и так умеет. Отдельная «ветка для
отката» разошлась бы с прямой на первой же правке.

**Каждый исполнитель проверяет состояние и отказывает с ADMIN_004, если мир
изменился.** Откат выдачи предмета, который уже продан, — это не откат, а
кража у покупателя; откат выдачи денег, которые уже потрачены, — долг,
которого в игре нет. Отказ полный: ни состояние, ни журнал не трогаются.

## 2.2. Откат

```
POST /api/admin/actions/:id/rollback     Idempotency-Key
  { reason }
→ 200 { actionId, rolledBack: { id, kind, targetType, targetId } }

403 ADMIN_001  недостаточно прав (нужен SUPER_ADMIN)
404 ADMIN_002  действие не найдено
409 ADMIN_003  действие уже откачено <когда>, откат <id>
409 ADMIN_004  откат невозможен: состояние изменилось после действия
422 ADMIN_005  причина короче 10 символов
```

`ADMIN_004` — важный отказ. Пример: админ выдал предмет, игрок его продал,
админ пытается откатить выдачу. Предмета у игрока нет, и молча списать
что-нибудь другое нельзя. Откат отклоняется, админ разбирается вручную.

Откат сам является действием `ROLLBACK` и пишется в журнал со ссылкой на
отменённое. Откат отката запрещён: отменять надо исходное действие заново.

## 2.3. Журнал действий

```
GET /api/admin/actions?adminId=&kind=&targetType=&targetId=&from=&to=&cursor=
→ 200 { items: [{ id, at, adminUsername, adminRole, kind, reason,
                  targetType, targetId, rolledBackAt, correlationId }], nextCursor }
```

Доступен `SUPPORT` на чтение: прозрачность действий админов друг для друга —
дешёвая и очень полезная мера.

---

# 3. Цепочка транзакций

Главная новая возможность этапа.

```
GET /api/admin/trace?type=item|money|character|resource&id=<id>
→ 200 {
    subject: { type, id, label },
    events: [{
      at, source: 'CURRENCY'|'ITEM'|'RESOURCE'|'PRODUCTION'|'ADMIN'|'MARKET',
      action, amount | null,
      from: { type, id, label } | null,
      to:   { type, id, label } | null,
      correlationId,
      adminActionId: string | null
    }]
  }
404 ADMIN_006  объект трассировки не найден
```

Сшивает шесть журналов по `correlationId` и по идентификатору предмета.
Для предмета показывает всю жизнь экземпляра: создан (крафт, магазин, админ),
надет, снят, продан, куплен, изношен, отремонтирован, удалён.

## 3.1. Зачем именно так

Дюп предмета выглядит в базе как два экземпляра с одинаковой историей до
момента раздвоения. Перелив денег — как односторонний поток между двумя
аккаунтами с общим IP. Ни то ни другое не видно в отдельном журнале: видно
только в сшитой цепочке.

Без этой ручки журналы Этапов 2–4 остаются шестью таблицами, по которым нельзя
проследить один предмет, и все девять рисков антиабуза остаются на бумаге.

---

# 4. Новые разделы

**Состояние на 03.09.2026.** Шаг G1 реализован и закрыт: все перечисленные
ниже ручки ЧТЕНИЯ работают, покрыты `admin-strategy.test.ts`, доступны роли
`SUPPORT`. Мутации разделов не реализованы намеренно — они приходят шагом G2
вместе с `AdminActionLog`.

Причина именно такого порядка: по принципу П1 действие без записанной
обратной операции админу не выдаётся. Выдать «сброс района» сейчас, а
обратимость приделать на следующем шаге — значит оставить между шагами окно,
в котором админ ломает состояние безвозвратно. Читать при этом можно всё
и сразу: чтение необратимым не бывает.

| Ручка | Шаг | Состояние |
|---|---|---|
| `GET /clans`, `/clans/:id` | G1 | готово |
| `GET /territories` | G1 | готово |
| `GET /claims`, `/claims/:id/roster` | G1 | готово |
| `GET /objects/:id/attacks` | G1 | готово |
| `GET /premium?characterId=` | G1 | готово |
| `GET /logs` | G1 | готово |
| `GET /actions`, `POST /actions/:id/rollback` | G2 | готово |
| `GET /trace` | G2 | готово |
| `POST /characters/money` | G2 | готово |
| `POST /items/grant`, `/items/:id/delete` | G2 | готово |
| `POST /listings/:id/lock`, `/unlock` | G2 | готово |
| `POST /shop-items/:id/deactivate` | G2 | готово |
| `POST /territories/:code/reset` | G2 | готово |
| `POST /claims/:id/expire` | G2 | готово |
| `POST /clans/:id/authority` | G2 | готово |
| `POST /attacks/:id/clear-cooldown` | G2 | готово |
| `POST /helpers/:id/sleep` | G2 | готово |
| `POST /premium/grant`, `/revoke` | G2 | готово, с причиной и снимком срока |

**Старые ручки без журнала удалены, а не оставлены рядом.** Ушли
`/grant-money`, `/grant-item`, `/market/listings/:id/lock` и `/unlock`,
`/private-shops/items/:id/deactivate` и премиумные ручки Этапа 4. Две двери
к одному действию, из которых одна ничего не записывает, делают правило
«ничего без причины» необязательным: достаточно постучать во вторую.

## 4.1. Кланы

```
GET  /api/admin/clans?query=&cursor=
→ 200 { items: [{ id, name, tag, level, members, treasury, authority,
                  territories, isFrozen, debt }], nextCursor }

GET  /api/admin/clans/:id
→ 200 { clan: { ..., upkeepPerDay },
        authorityAudit: { stored, fromLog, matches },
        members: [...], storage: [...], treasuryLog: [...],
        authorityLog: [...], territories: [...],
        openClaims, attacksMade }
404 ADMIN_002  бригада не найдена
```

`authorityAudit` — сверка поля `Clan.authority` с суммой журнала, тем же
кодом, что `AuthorityService.audit`. Она идёт прямо в карточке, а не
отдельной ручкой: расхождение означает либо дефект, либо правку мимо
приложения, и админ должен увидеть его тогда же, когда смотрит на клан, а не
когда специально пойдёт проверять.

`members` собирается двумя запросами: у `ClanMember` нет связи с персонажем,
только `characterId` без внешнего ключа, и ники добираются отдельно.

Чтение доступно `SUPPORT`. Мутаций над кланом в первой версии нет: распустить
клан или отобрать общак — действия, которые нечем корректно откатить, и по
принципу П1 они не заводятся.

## 4.2. Территории

```
GET  /api/admin/territories
→ 200 { items: [{ code, name, status, ownerTag, upkeepDebt,
                  protectedUntil, activeClaim }] }

POST /api/admin/territories/:code/reset      Idempotency-Key
  { reason }
→ 200 { actionId, territory: { code, status: 'NEUTRAL' } }
403 ADMIN_001  нужен SUPER_ADMIN
409 ADMIN_007  идёт бой за территорию
```

Единственная мутация — принудительный сброс в `NEUTRAL`. Нужна на случай
зависшей заявки или клана, распавшегося с территорией на руках. Обратная
операция — вернуть прежнего владельца и статус из снимка.

Сброс во время боя запрещён: иначе бой заканчивается в никуда, и участники
теряют ход впустую.

## 4.2a. Заявки и войны

```
GET  /api/admin/claims?status=open|all&cursor=
→ 200 { items: [{ id, territoryCode, attackerTag, defenderTag, status,
                  battleStartsAt, battleId, feePaid, authoritySpent,
                  roster: { attack: n, defence: n } }], nextCursor }

POST /api/admin/claims/:id/expire            Idempotency-Key
  { reason }
→ 200 { actionId, status: 'EXPIRED', feeRefunded: false }
403 ADMIN_001  нужен SUPER_ADMIN
409 ADMIN_008  бой уже начался
```

Гашение **без возврата взноса** — единственная форма, доступная админу.
Возврат заводить нельзя: пока заявка висела, район был занят и другие бригады
не могли его тронуть; после возврата взноса и разблокировки район мог занять
кто угодно, и вернуть всё как было невозможно. Обратной операции у такого
действия нет, а по принципу П1 действие без обратной операции не заводится.

Гашение без возврата обратимо: заявку можно восстановить в `PENDING` со всем
составом и прежним временем боя, потому что деньги никуда не двигались.

Автоматическое гашение с возвратом остаётся у воркера и срабатывает только
в одном случае — к часу боя не осталось ни одного нападающего. Это не
админское действие, и в `AdminActionLog` оно не попадает; в алерты (риск Р13)
попадает обязательно.

## 4.2b. Налёты на объекты

```
GET  /api/admin/objects/:id/attacks
→ 200 { items: [{ at, type, attackerTag, defenderTag, durabilityLost,
                  moneyTaken, cancelledCycleId, authoritySpent }] }

POST /api/admin/objects/:id/clear-cooldown   Idempotency-Key
  { reason }
→ 200 { actionId, cooldownUntil: null }
403 ADMIN_001  нужен MODERATOR
```

Снятие отката нужно на разбор жалоб: если атака прошла из-за дефекта, откат в
72 часа наказывает пострадавшего второй раз. Обратная операция — вернуть
прежнюю отметку времени атаки из снимка.

Отмена последствий самой диверсии (вернуть прочность и отменённый цикл) в
первой версии не заводится: цикл уже помечен `FAILED`, резервы сняты, рабочие
получили расчёт, и «отменить» это значит собрать состояние заново из
нескольких журналов. Вместо этого админ пользуется существующими средствами —
выдать деньги на ремонт с причиной.

## 4.2c. Авторитет бригады

```
GET  /api/admin/clans/:id/authority
→ 200 { current, fromLog, matches, log: [...] }

POST /api/admin/clans/:id/authority          Idempotency-Key
  { amount, reason }
→ 200 { actionId, authority }
403 ADMIN_001  нужен SUPER_ADMIN
```

`matches` — сверка поля с журналом тем же кодом, что и `AuthorityService.audit`
из Этапа 4. Это единственная сверка «поле против журнала», которая в проекте
уже есть, и она же образец для остальных: расхождение означает либо дефект,
либо вмешательство в базу мимо приложения.

Правка авторитета обратима: обратная операция — правка на ту же величину со
знаком минус.

## 4.3. Premium и помощники

```
GET  /api/admin/premium?userId=
→ 200 { isPremium, expiresAt, purchases: [...], helpers: [...] }

POST /api/admin/premium/grant                Idempotency-Key
  { userId, productCode, days?, reason }
→ 200 { actionId, isPremium, expiresAt }
400 PREM_002  товар выдаёт предмет со статами — запрещено

POST /api/admin/premium/revoke               Idempotency-Key
  { userId, reason }
→ 200 { actionId, isPremium: false }
```

`PREM_002` здесь — рантайм-форма инварианта 12 Этапа 4. Даже если в витрину
попадёт товар со статами, выдать его не удастся ни игроку, ни админу.

Отдельно `PREM_003`: товар с нереализованным эффектом не выдаётся тоже. На
03.09.2026 реализован один эффект из восьми — `SUBSCRIPTION_DAYS`; остальные
семь выключены в витрине и закрываются шагом G0. Отказ нужен именно кодом, а
не отсутствием строки: админ должен видеть разницу между «товара нет» и
«эффект ещё не сделан».

Усыпление помощника:

```
POST /api/admin/helpers/:id/sleep            Idempotency-Key
  { reason }
→ 200 { actionId, status: 'DORMANT' }
```

Нужно на разбор жалоб по риску Р10 (помощник доит общак бригады). Обратная
операция — вернуть `ACTIVE`. Увольнение помощника админом не заводится: у
помощника накоплен опыт профессии, и восстановить его нечем.

## 4.4. Единый поиск по логам

```
GET /api/admin/logs?source=all|currency|item|resource|production|treasury|authority
                   &characterId=&clanId=&from=&to=&limit=
→ 200 { items: [{ at, source, action, actor, amount, balanceAfter, ref, note }],
        sources, truncated }
422 GEN_001  characterId и clanId одновременно
```

Один запрос вместо шести таблиц. Старые ручки `/logs/currency`, `/logs/items`,
`/logs/resources` остаются: их использует текущая страница админки, и ломать
её ради унификации незачем.

Три отличия от первой редакции контракта, каждое по делу:

- **`correlationId` не отдаётся.** Его нет ни в одном журнале Этапов 2–4: поле
  появится вместе с `AdminActionLog` на шаге G2. Отдавать всегда `null` —
  значит врать в контракте, поэтому события пока сшиваются по `ref`, который
  журналы уже пишут (`refType`/`refId`, id предмета, id объекта).
- **Добавлены источники `treasury` и `authority`.** Общак и авторитет бригады
  — это журналы Этапа 4, и без них лента не показывает войну вовсе. Одно
  событие «подана заявка» оставляет след сразу в обоих, и именно связка, а не
  отдельная строка, показывает, что произошло.
- **Курсора нет, есть `limit` и признак `truncated`.** Курсор по шести
  разнородным таблицам — это шесть курсоров, и склеить их в один честно
  нельзя. Каждый журнал берёт свои `limit` строк, лента сливается и режется по
  времени; `truncated` говорит, что за границей осталось ещё. Настоящая
  постраничная выдача по всей ленте появится, когда у событий будет общий
  ключ сортировки, то есть с `correlationId` на G2.

`characterId` и `clanId` вместе отклоняются, а не возвращают пустоту молча:
журналы персонажа и бригады разные, и такой запрос — это ошибка вызывающего.

## 4.5. Заморозка рынка

```
POST /api/admin/market/freeze      Idempotency-Key   { reason }
→ 200 { actionId, frozenAt }
POST /api/admin/market/unfreeze    Idempotency-Key   { reason }
→ 200 { actionId }
403 ADMIN_001  нужен SUPER_ADMIN
```

Пока рынок заморожен, выставление и покупка лотов отвечают 503 с внятным
текстом. Снятие лотов **разрешено**: игрок не должен терять доступ к своим
вещам из-за административной меры.

## 4.6. Завершение зависшего боя

```
POST /api/admin/battles/:id/end    Idempotency-Key
  { winnerSide: 1|2|null, reason }
→ 200 { actionId, battle: { id, status: 'FINISHED' } }
403 ADMIN_001  нужен MODERATOR или выше
409 ADMIN_008  бой уже завершён
```

`winnerSide: null` — ничья, никто не получает опыт и деньги. Это безопасный
исход для боя, зависшего по технической причине: он не должен становиться
источником наград.

## 4.7. Справочники

```
GET  /api/admin/catalog/:kind          kind = items|recipes|objects|shop
→ 200 { items: [...] }

PATCH /api/admin/catalog/:kind/:code   Idempotency-Key
  { fields: {...}, reason }
→ 200 { actionId, before: {...}, after: {...} }
403 ADMIN_001  нужен SUPER_ADMIN
409 ADMIN_009  поле неизменяемо: <field>
```

Неизменяемые поля — `code`, тип предмета, тип объекта: их правка сломала бы
уже существующие экземпляры и историю. Изменяемы цены, названия, описания,
пороги и числа баланса.

Обратная операция — вернуть `before` целиком. Поэтому ответ и содержит оба
снимка: без `before` откат правки справочника невозможен.

---

# 5. Матрица прав

| Ручка | Минимальная роль |
|---|---|
| Любое чтение, включая `/actions` и `/trace` | `SUPPORT` |
| `POST /users/:id/ban`, `/unban` | `MODERATOR` |
| `POST /battles/:id/end` | `MODERATOR` |
| Жалобы | `MODERATOR` |
| `POST /grant-money`, `/grant-item`, удаление предмета | `SUPER_ADMIN` |
| `POST /market/freeze`, `/unfreeze` | `SUPER_ADMIN` |
| `POST /market/listings/:id/lock`, `/unlock` | `MODERATOR` |
| `PATCH /catalog/*` | `SUPER_ADMIN` |
| `POST /premium/grant`, `/revoke` | `SUPER_ADMIN` |
| `POST /territories/:code/reset` | `SUPER_ADMIN` |
| `POST /claims/:id/expire` (без возврата взноса) | `SUPER_ADMIN` |
| `POST /clans/:id/authority` | `SUPER_ADMIN` |
| `POST /objects/:id/clear-cooldown` | `MODERATOR` |
| `POST /helpers/:id/sleep` | `MODERATOR` |
| `POST /actions/:id/rollback` | `SUPER_ADMIN` |

Блокировка отдельного лота оставлена `MODERATOR`: это точечная мера против
конкретной махинации, а не изменение правил для всех.

---

# 6. Полный список кодов ошибок

| Код | Смысл |
|---|---|
| `ADMIN_001` | недостаточно прав |
| `ADMIN_002` | действие не найдено |
| `ADMIN_003` | действие уже откачено |
| `ADMIN_004` | откат невозможен, состояние изменилось |
| `ADMIN_005` | причина короче 10 символов |
| `ADMIN_006` | объект трассировки не найден |
| `ADMIN_007` | идёт бой за территорию |
| `ADMIN_008` | бой уже начался или уже завершён |
| `ADMIN_009` | поле справочника неизменяемо |
| `PREM_002` | товар выдаёт предмет со статами |
| `PREM_003` | эффект товара ещё не реализован |

---

# 7. Интерфейс админки

Сегодня — одна страница на сто строк. Достраивается до тринадцати разделов, но
**без редизайна**: та же вёрстка, тот же список-плюс-карточка. Админка не витрина, и
вкладывать в неё дизайн раньше, чем в игру, незачем.

Три требования, общие для всех разделов:

1. **Причина спрашивается модальным окном** перед выполнением, а не после.
   Админ, которого просят объяснить действие до, а не после, чаще передумывает.
2. **Кнопка отката стоит рядом с записью журнала**, а не в отдельном разделе.
   Откат, до которого надо искать путь, не используется.
3. **Цепочка транзакций открывается с любой карточки**: с предмета, с суммы в
   журнале, с персонажа. Это главный инструмент расследования, и он должен
   быть в один клик из места, где возникло подозрение.
