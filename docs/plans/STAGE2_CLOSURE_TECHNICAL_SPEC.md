# Stage 2 Closure Technical Specification

Status: implementation baseline  
Date: 2026-08-13  
Authority: `docs/specs/stage-2/MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx`

## 1. Purpose

Close Stage 2 as a stable economic foundation for Stages 3 through 5 without pulling future content into the current milestone.

Stage 2 is accepted when the loop `work -> resources and components -> market or private shop -> repair or upgrade -> battle -> wear -> renewed demand` works as one observable and transactionally safe system.

The five-stage roadmap defines the product boundary. MASTER v2.2 defines detailed Stage 2 behavior. Revisions 2.1 and 2.2 override conflicting earlier sections.

## 2. Scope

### 2.1 Required in Stage 2

- Independent profession progression.
- System-owned production objects.
- Work shifts with `ACTIVE -> READY_TO_CLAIM -> CLAIMED`, plus cancellation and failure.
- Salary, profession XP and direct resource/component rewards.
- Salary fatigue as the accepted anti-farm deviation.
- Resources, reservation and government buyback.
- Tier 2 private shops.
- Player market for items and resources.
- Repair with components.
- Item upgrades and stat budgets.
- Minimal production equipment contract.
- Consumable tools with tier and remaining uses.
- Economy metrics, logs, moderation and anti-abuse signals.
- CI simulations, integration tests, API E2E and browser flow evidence.
- Corrections to Stage 1 combat behavior that would otherwise corrupt future item balance.

### 2.2 Explicitly deferred to Stage 3

- Multi-step production recipes.
- Input and output inventories owned by a production object.
- Production cycles independent from a personal shift.
- Private ownership and purchase of production objects or equipment.
- Salary paid from object balance.
- Equipment durability and maintenance.
- Resource quality.
- Farming, bars, consumable crafting and clan production.

No deferred feature may be partially activated behind undocumented behavior.

## 3. Domain invariants

### 3.1 Work shift

- A character may have at most one shift in `ACTIVE` or `READY_TO_CLAIM`.
- A character in battle cannot start work.
- Starting work atomically changes character status from `ACTIVE` to `WORKING`.
- A completed shift releases the character before the reward is claimed.
- Claim is idempotent and all rewards are written in one database transaction.
- Cancellation grants no salary, XP, resource or tool wear.
- A claim replay returns the stored response and cannot duplicate any effect.

### 3.2 Profession

- XP is stored per `characterId + professionCode`.
- XP in one profession never improves another profession.
- Aggregate `productionLevel` and `productionExp` are compatibility projections only.
- Runtime, UI and upgrade chance use the relevant profession level.
- Progression evidence includes 2, 4, 8 and 14 active hours per day.
- Top profession level must not be reachable in less than six months at 14 active hours per day.

### 3.3 Equipment and tools

- Every seeded Stage 2 production object has exactly one system-owned equipment record.
- Active equipment declares `requiredToolTier`.
- A shift cannot start without an owned usable tool of sufficient tier.
- The lowest sufficient tier is selected first, then the oldest instance.
- The selected tool is locked and stored on the shift at start.
- Claim consumes exactly one use from that same instance.
- The last use moves the tool to `CONSUMED`; otherwise it returns to `NORMAL`.
- Cancellation returns the tool to `NORMAL` without changing `usesLeft`.
- No tool can back two concurrent shifts.
- Government shop, private shop and admin creation initialize `usesLeft = usesMax`.

### 3.4 Market and resources

- Reserved resources can never be spent or sold twice.
- Listed items are non-usable outside the market transaction.
- Buyer claim and seller payout are one transaction.
- Currency, resources, items and upgrades retain correlated logs.
- Dangerous retryable mutations are idempotent.

### 3.5 Combat compatibility corrections

- Turn budgets are `2 attacks`, `4 blocks`, or `1 attack + 2 blocks`.
- Lucky hit uses attacker Luck.
- Lucky hit may pierce a selected block but does not bypass armor.
- One canonical zonal resolver serves PvE and PvP before Stage 3 item expansion.
- Accuracy, dodge, block, critical and counter outcomes cannot have contradictory parallel formulas.
- New combat coefficients belong in `BalanceConfig` and require deterministic simulation evidence.

## 4. Data model

### 4.1 ItemTemplate

- `toolTier Int?`
- `usesMax Int?`

For `type = TOOL`, both values are positive. Non-tool templates keep them null.

### 4.2 ItemInstance

- `usesLeft Int?`

For tools, `0 <= usesLeft <= template.usesMax`.

### 4.3 ProductionEquipment

Fields: `id`, unique `productionObjectId`, unique `code`, `name`, `tier`, `requiredToolTier`, `producesResourceCode`, `isActive`, `ownerType`, `ownerCharacterId`, timestamps.

Stage 2 permits only `ownerType = SYSTEM` in seeded data.

### 4.4 WorkShift

`toolInstanceId` stores the exact reserved tool. It is nullable only for legacy shifts and objects without active equipment requirements.

### 4.5 Migration rules

- Additive migration only.
- Existing items and shifts remain valid.
- No table or column is deleted or renamed.
- New nullable columns preserve old behavior.
- Shift tool FK uses `ON DELETE SET NULL`.
- Equipment owned by a production object uses `ON DELETE CASCADE`.
- Existing CI migration-additivity gate remains mandatory.

## 5. API contract

### GET `/api/work/objects`

Each object includes profession state, lock state, equipment, required tool tier, `toolAvailable`, duration, salary and output.

### GET `/api/work/shifts/current`

The shift includes production object, equipment, selected tool with remaining uses, profession, readiness and remaining seconds.

### POST `/api/work/shifts/start`

Character state, profession, daily policy, slots, equipment and tool availability are validated. Tool reservation and shift creation are one transaction.

Errors: `WORK_011` for missing required tool; `WORK_012` if the reserved tool becomes unavailable inside a protected mutation.

### POST `/api/work/shifts/:id/claim`

Response adds `toolUse: { itemId, usesLeft }`. The idempotency response stores it with salary, XP, resource reward and balance.

### POST `/api/work/shifts/:id/cancel`

Cancellation unlocks the reserved tool and grants no reward.

## 6. Seed

- Tier 1 tool: 50 uses, price 500.
- Tier 2 tool: 50 uses, price 1,250.
- Tier 3 tool: 50 uses, price 1,800.
- All six Stage 2 production objects receive one equipment record.
- Seed is idempotent and runs in CD after migrations.
- Authenticated production smoke verifies six equipment records and three tool templates.

## 7. Implementation plan

### P0. Canon and schema

- [x] Record Stage 2 versus Stage 3 boundary.
- [x] Add tool and equipment schema.
- [x] Add additive migration.
- [x] Add error codes and API types.

### P1. Transactional production flow

- [x] Seed tools and equipment.
- [x] Initialize tool uses in every item creation path.
- [x] Select and reserve a tool at shift start.
- [x] Consume one use at claim.
- [x] Release without wear at cancellation.
- [x] Expose equipment and tool state in API and UI.
- [x] Add database check constraints for positive tiers and use counts.
- [x] Cover concurrent starts competing for one tool.
- [x] Cover tool purchase initialization through the public shop API.

### P2. Combat foundation correction

- [x] Fix mixed stance to one attack and two blocks.
- [x] Use attacker Luck for lucky outcomes.
- [x] Stop lucky hits from bypassing armor.
- [x] Inject deterministic RNG into the canonical resolver.
- [x] Integrate hit and dodge into one contest.
- [x] Add anti-dodge, anti-luck and anti-counter item modifiers.
- [x] Derive counter damage from bounded incoming force.
- [x] Retire the legacy resolver by delegating compatibility calls to the canonical zonal resolver.
- [x] Execute and report the 40-case experiment matrix.

### P3. Balance, observability and acceptance

- [x] Add tool replacement cost to economy simulation.
- [x] Run profession simulation for 2, 4, 8 and 14 hours.
- [x] Add metrics for missing-tool blocks and consumed uses.
- [x] Complete integration and API E2E coverage for work with tools.
- [x] Add browser work flow: missing tool, purchase, shift and cancellation; claim is covered by API E2E.
- [x] Produce acceptance and Stage 3 handoff reports.
- [x] Merge only after all CI jobs pass.

## 8. CI/CD acceptance

The existing pipeline is authoritative:

1. CI runs security audit, migration additivity, simulations, backend/frontend builds, unit tests, integration tests, API E2E and Playwright.
2. CD starts only from successful CI on `main`.
3. CD deploys the verified SHA, backs up the database, builds images, migrates, seeds, restarts, checks health and runs authenticated Stage 2 smoke.
4. Application rollback runs automatically if deployment verification fails.

Direct VPS inspection is not part of routine implementation acceptance.

## 9. Definition of Done

Stage 2 becomes `ACCEPTED` only when:

- all required scope is implemented;
- no deferred Stage 3 feature is accidentally active;
- all invariants are covered by tests or database constraints;
- economy and profession simulations pass agreed corridors;
- combat corrections have deterministic evidence;
- CI is green for the exact commit merged to `main`;
- CD deploys that verified commit and smoke passes;
- `STAGE2_ACCEPTANCE_REPORT.md` maps every v2.2 criterion to code, tests and CI evidence;
- `STAGE2_STAGE3_HANDOFF.md` records every deliberate deferral.

Until then the status is `IMPLEMENTATION IN PROGRESS`, not `ACCEPTED`.
