# GanjaWars / GanjaWiki and Apeha systems research

Collected: 2026-08-13
Purpose: source material for Kooperativ / browser-mmo-90s after Stage 2.

## 1. Source policy

Three evidence levels are used:

1. **Primary**: official game help/library and GanjaWiki pages describing live mechanics.
2. **Secondary**: community guides and archived forum explanations.
3. **Inference**: adaptation proposed for Kooperativ. Inferences are never presented as facts about the reference game.

The exact hidden probability formulas of Apeha are not public in the material found. The official library confirms dependencies and outcomes, not exact chance equations. Those equations must be calibrated through tests or treated as our own design.

---

# Part I. GanjaWars economy, work and production

## 2. Core gameplay loop

GanjaWars connects character progression, employment, resource conversion, property, trade and conflict:

`fight / obtain access → take a job → object consumes inputs → object produces output → worker receives salary + production XP → output is sold or processed → owner replenishes inputs and payroll → property becomes strategically valuable → syndicates contest control and monopoly`

Important lesson for Kooperativ: work is not an isolated timer. It is a labor input into a stateful production object with inventory, balance, capacity, profile, ownership and political control.

## 3. Employment

Primary source: GanjaWiki, “Работа”.

A character works on real-estate objects for money and production experience. There are two work modes:

- production of goods;
- restoration of damaged property.

### 3.1 Admission checks

The source lists blocking conditions:

- no free worker slots;
- the object requires a higher production level;
- object balance is negative;
- output storage is full;
- enemy syndicate controls the object;
- sector monopoly prevents this production profile;
- for ordinary production, required input resources must be available.

A CAPTCHA is required when taking a job. This is an anti-bot mechanism, not part of the economic formula.

### 3.2 Shift duration

Available employment duration grows with progression:

- 1 hour: any combat level, excluding technical characters;
- 2 hours: from combat level 11;
- 3 hours: from production level 16;
- 4 hours: from production level 20;
- 5 hours: from production level 25.

Historical news additionally confirms a two-hour employment option intended for players unable to return hourly. Its first hour awarded half production XP while retaining full salary.

### 3.3 Salary formula

When inputs are sufficient, hourly reward uses base salary `Pb` and production level `Lp`.

For levels 0–20:

`P = Pb × (1 + Lp / 5)`

For levels 21–25:

`P = Pb × (3 + Lp / 10)`

For levels 26 and 30:

`P = Pb × (0.3 × Lp − 2)`

For levels 27–29:

`P = Pb × (0.3 × Lp − 1.9)`

Production XP uses the same multiplier without `Pb`.

This is a discontinuous reference curve with explicit late-level tuning. We should copy the principle, not blindly copy the values: early linear growth, then manually controlled endgame steps.

### 3.4 Restoration work

Restoration pays no salary but triples production XP. This creates a strong choice:

- production: money + normal XP + output;
- restoration: no money + accelerated progression + restored strategic asset.

For Kooperativ this is a valuable Stage 3 pattern: allow players without capital to trade income for profession progression and repair public/private objects.

### 3.5 Production timing

The source separates worker commitment from the object’s production tick:

- worker commitment is 60 minutes;
- production payout/output tick is every 65 minutes after the first worker starts;
- leaving before the object’s tick can forfeit salary and XP;
- continuous staffing produces another cycle every 65 minutes.

This is a major design point. Reward is tied to a successful object cycle, not merely to waiting out a personal timer.

Recommended Kooperativ adaptation:

- retain user-friendly deterministic `endsAt` for the current Stage 2 shift;
- introduce object production cycles separately in Stage 3;
- a shift contributes `laborUnits` to cycles overlapping its active period;
- salary can be guaranteed per completed shift, while production bonuses depend on successful cycles;
- clearly show the next object cycle to avoid GanjaWars-style timing ambiguity.

## 4. Commercial property

Primary source: GanjaWiki, “Коммерческая собственность”.

Commercial property is an enterprise intended to make profit. It has:

- a production profile;
- stored input resources and finished output;
- property balance;
- worker slots;
- owner-controlled buy/sell prices;
- owner-controlled wages within a permitted range;
- work protocol/history;
- activity and damage state;
- control/lease restrictions;
- links to sector monopoly.

### 4.1 Owner controls

The owner sets:

- resource purchase prices;
- resource sale prices;
- wages, historically in a bounded range;
- production profile when allowed.

Salary cannot be paid when resources are missing, and employment is blocked when the property balance is negative.

This makes property balance economically meaningful. Kooperativ currently stores `ProductionObject.balance` but Stage 2 salaries are system emission. Stage 3 should support two modes:

- SYSTEM objects: salary emitted by the system;
- PRIVATE/CLAN objects: salary debited from object balance.

### 4.2 Profile switching

Switching a property profile:

- preserves old inputs and finished goods;
- hides irrelevant old resources while they still consume storage;
- is blocked for damaged property;
- damages the property and requires restoration afterward;
- can be blocked by control, lease or sector monopoly.

Good adaptation: switching production must have a real cost and downtime, preventing instant optimization around market prices.

## 5. Resource chain

Primary sources: GanjaWiki “Ресурс”, commercial property and factory pages.

Resources are divided into:

- **primary**: plantations, farms, mines, oil fields;
- **secondary**: laboratories and intermediate processing;
- **final**: manufactured weapon, armor, accessory and transport resources ready for retail.

Reference chain:

`primary extraction → laboratory/intermediate processing → factory/final resource → shop/terminal → usable item`

Examples:

- oil and steel feed weapons and armor production;
- grass and seaweed feed laboratories and factories;
- laboratory output such as ganjium feeds final factories;
- factories make final `(р)` resources, modules and equipment;
- stores retail goods supplied as final resources.

This is the missing depth in current Kooperativ Stage 2. Current production objects emit a resource directly. Stage 3 should add recipes and cycles rather than replacing existing models.

Suggested additive models:

- `ProductionRecipe`
- `ProductionRecipeInput`
- `ProductionCycle`
- `ProductionCycleContribution`
- `ProductionObjectInventory`
- `ProductionObjectEquipment`
- `ToolInstance` or reuse `ItemInstance` with `ItemType.TOOL`

## 6. Factory mechanics

Primary source: GanjaWiki “Завод”.

Factories:

- transform primary resources into technological inputs;
- produce resource items and equipment;
- perform weapon modernization;
- have per-profile input rates and output rates;
- have storage based on hours of production;
- preserve unused resources across profile changes;
- can merge only under matching control and timing restrictions.

### 6.1 Capacity

A factory can store roughly 12 hours of production inputs per cell. Every additional cell increases capacity, with a ceiling per resource. Uranium uses a special multiplier.

Adaptation principle:

`capacity(resource) = min(profileHourlyConsumption(resource) × reserveHours × cells × specialMultiplier, hardCap)`

This is better than arbitrary inventory slots because capacity scales from production reality.

### 6.2 Recipes as data

GanjaWiki exposes large tables with:

- working hours;
- power;
- output units per hour;
- multiple input resources per hour.

Kooperativ should store this as recipe data, not code constants. Every recipe must be simulatable and seedable.

## 7. Exchange terminal and market

Primary source: GanjaWiki “Терминал”.

The exchange terminal separates character holdings from terminal holdings. Players deposit money/resources, place orders and trade on an island-wide exchange. Trading through the exchange does not grant economic XP.

Useful distinction for Kooperativ:

- current player market: direct listings, seller earns EL;
- future exchange: fungible resource order book, no EL or reduced EL to prevent volume farming;
- terminal balances/reservations separate from carried inventory;
- price history and order depth become the natural source for economic metrics.

## 8. Property warfare and monopoly

Primary sources: GanjaWiki monopoly, syndicate battle and property pages.

Economic objects are strategic because syndicates can:

- control property;
- attack or damage property;
- restrict production profiles through sector monopoly;
- collect or benefit from wages/production control;
- require credit and PTS to initiate attacks.

Key design lesson: territorial war must affect real economic flows, but should not permanently delete player progress. Damage, downtime, control bonuses and restricted profiles are safer than permanent destruction.

## 9. What to adopt for Kooperativ

High priority:

1. object inventories and balances;
2. recipes with explicit input/output rates;
3. production cycles independent of personal shift timers;
4. production blocked by missing inputs, full output storage or negative balance;
5. restoration work as no-money/high-XP alternative;
6. private/clan payroll from object balance;
7. profile switching with cost and downtime;
8. terminal/order-book market for fungible resources;
9. property protocol and economic audit;
10. capacity derived from hours of production.

Do not copy literally:

- CAPTCHA as gameplay;
- opaque 60/65-minute timing mismatch;
- old late-game level discontinuities without simulation;
- severe monopoly locks without counterplay;
- hidden resources after profile switching without a management UI.

---

# Part II. Apeha combat system

## 10. Turn structure

Primary source: official Apeha FAQ.

A player selects a reachable opponent and chooses attacks and blocks. One turn permits exactly one of:

- 2 attacks;
- 4 blocks;
- 1 attack + 2 blocks.

Movement is cell-based: select a destination cell and confirm movement. Battle applications define fight type, opponent level, fighter count and turn duration.

This validates Kooperativ’s current stance model. The critical rule is not merely the numbers but the action-budget tradeoff: offense reduces defended zones.

## 11. Result resolution

Primary source: official Apeha library.

Officially documented results:

### 11.1 Critical hit

- damage equals Strength × 1.5 in the simplified official description;
- probability depends on attacker and defender Anger-related values;
- shown red in the log.

### 11.2 Counterattack

- occurs automatically outside the defender’s normal turn;
- damage depends on the incoming attack’s force;
- probability depends on the ratio of attacker and defender Reaction;
- shown brown in the log.

### 11.3 Dodge

- avoids an attack independently from blocking;
- probability depends on the ratio of attacker and defender Agility;
- shown green in the log.

### 11.4 Lucky hit

- pierces the opponent’s block;
- Luck also helps hit an evasive opponent;
- shown blue in the log.

## 12. Stats and counter-stats

Official mapping:

- Strength: damage;
- Agility: dodge chance;
- Reaction: counterattack chance;
- Luck: block piercing and hitting evasive targets;
- Anger: critical-hit chance;
- Constitution: HP;
- Intelligence: mana after unlocking a magical path.

Counter-stats (“обереги”):

- anti-dodge: reduces opponent dodge;
- anti-luck: reduces opponent block piercing;
- anti-counter: reduces opponent counterattack;
- anti-critical: reduces opponent critical hit chance.

The important architecture is paired stats:

`attacking stat ↔ defending ward`

Apeha does not rely on one universal Accuracy/Defense pair. Different builds attack different defensive dimensions.

## 13. Combat builds

Secondary community sources consistently identify:

- blocker;
- dodger;
- critical build;
- lucky build;
- tank;
- ranged/throwing build;
- hybrids.

A viable build requires giving up strength elsewhere. Therefore item budgeting and point allocation are essential: a build should not simultaneously maximize dodge, block piercing, counterattack, criticals, HP and armor.

This strongly supports Kooperativ’s v2.2 `statBudget` design.

## 14. Recommended resolution pipeline for Kooperativ

Apeha’s official descriptions suggest this order, with our own explicit implementation rules:

1. validate target and range;
2. resolve movement/position legality;
3. determine whether selected zone is blocked;
4. roll lucky block piercing;
5. if not blocked, roll dodge using Agility versus anti-dodge/attacker pressure;
6. roll critical using Anger versus anti-critical;
7. calculate raw weapon/Strength damage;
8. apply zone armor and durability;
9. apply endurance/protection;
10. apply HP damage;
11. if eligible, roll automatic counterattack using Reaction versus anti-counter;
12. write a fully explainable event log.

Current Kooperativ differs: dodge is checked before blocked-zone resolution. That is a design choice, not confirmed by the official source. We need an explicit product decision and simulation comparison for both orders.

## 15. Gaps in current Kooperativ combat relative to Apeha

1. `antiDodgeBonus` and `antiCounterBonus` remain zero in attacker snapshots.
2. Anti-luck / block-piercing defense is not a first-class item stat.
3. Counterattack damage currently uses a simplified fraction of defender weapon damage, while the official description relates it to incoming attack force.
4. Luck currently pierces block and bypasses armor in some paths; official Apeha material confirms block piercing, not armor bypass.
5. Exact contest ratios are our formulas, not Apeha facts.
6. Combat log should expose chance inputs and counters for balance debugging, while player-facing text may remain concise.
7. Build viability should be tested as a matrix, not only equal-stat random fights.

## 16. Required combat experiments

Create deterministic simulations for:

- blocker vs equal attacker;
- dodger vs high-accuracy attacker;
- lucky build vs blocker;
- critical build vs anti-critical tank;
- reaction build vs anti-counter build;
- hybrid vs specialist;
- armored zones vs uncovered zones;
- melee vs ranged at each distance;
- block-first versus dodge-first resolution order;
- counterattack based on defender weapon versus incoming attack force.

For each scenario record:

- win rate;
- average rounds;
- damage per round;
- block, pierce, dodge, crit and counter rates;
- armor durability loss by zone;
- action timeout/auto-action effect;
- effective cost of the build from item budgets.

## 17. Design decisions needed before changing combat

1. Does block resolution happen before dodge, or dodge before block?
2. Does a lucky hit only pierce block or also bypass armor?
3. Is counterattack damage derived from incoming attack force, defender weapon or both?
4. Do wards use flat subtraction, ratio pressure or diminishing returns?
5. Can one hit be both lucky and critical?
6. Does counterattack trigger on a blocked hit, landed hit, or any attack attempt?
7. Which result takes precedence in the log and animation?

Until these are answered, Apeha research should inform experiments, not trigger a blind rewrite.

---

# Part III. Direct implications for roadmap

## 18. Stage 2 completion versus Stage 3 scope

Keep in Stage 2 hardening:

- economic metrics and alarms;
- anti-abuse detection;
- market filters/history;
- profession progression and item budgets;
- formula/source documentation.

Move into Stage 3 production expansion:

- object balances and private payroll;
- object inventories;
- production recipes and cycles;
- equipment/tools and wear;
- restoration work;
- multi-step processing;
- fungible-resource exchange;
- private/clan ownership;
- property damage/control/monopoly with counterplay.

Treat Apeha combat changes as a separate combat revision, gated by simulations and product decisions. Do not mix them into production-economy migrations.

## 19. Source index

Primary GanjaWars/GanjaWiki:

- Work: http://ganjawiki.ru/Работа
- Commercial property: https://www.ganjawiki.ru/index.php?title=Бар
- Factory: https://www.ganjawiki.ru/Завод
- Resource: http://ganjawiki.ru/Ресурс
- Exchange terminal: https://www.ganjawiki.ru/Терминал
- Monopoly: https://www.ganjawiki.ru/Монополия
- Employment news: https://www.ganjawiki.ru/(news)_Устройство_на_работу
- Syndicate production: https://www.ganjawiki.ru/(news)_Синдикаты,_производство

Primary Apeha:

- Official description and result mechanics: https://apeha.ru/lib.shtml?id=3
- Official FAQ, movement and action budget: https://apeha.ru/faq_pg_1.shtml
- Paths and pre-turn magic: https://kovcheg.apeha.ru/lib.shtml?id=14
- Combat magic: https://apeha.ru/lib.shtml?id=30
- Item stones: https://apeha.ru/lib.shtml?id=105

Secondary Apeha:

- Character stat guide: https://apehablog.ru/polezno-znat/harakteristiki-personazha-v-igre/
- Historical result explanation: http://psphome.ru/chto-takoe-onlajn-igra-apeha-ru.html

## 20. Confidence summary

High confidence:

- Apeha action budget 2 attacks / 4 blocks / 1+2;
- cell movement and target reach;
- official stat/outcome dependencies;
- GanjaWars work restrictions, salary/XP formulas and production timing;
- resource tiers and production-property structure;
- object inputs, outputs, capacity, balance and ownership controls.

Medium confidence:

- practical build meta from community guides;
- historical values that may have changed over time;
- intended ordering among block, dodge, critical and counterattack.

Unknown and requiring experiment or explicit Kooperativ design:

- exact hidden Apeha chance formulas;
- exact current Apeha armor/durability equations;
- exact precedence of simultaneous lucky/critical/dodge/counter outcomes;
- optimal numerical transfer from either reference into Kooperativ.
