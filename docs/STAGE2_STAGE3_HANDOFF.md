# Stage 2 to Stage 3 Handoff

Date: 2026-08-13

## Stable foundation inherited by Stage 3

Stage 3 must reuse, not replace:

- `ProductionObject` ownership, balance, durability, status and location hooks.
- `ProductionEquipment` and consumable tool instances.
- `WorkShift` lifecycle and profession-specific progression.
- `ResourceTemplate`, `ResourceStack`, reservation and `ResourceLog`.
- `EconomyService` and correlated `CurrencyLog` operations.
- Player market for fungible resources and unique items.
- Repair, upgrades, item stat budgets and durability demand.
- Daily economy metrics, anti-abuse signals and admin governance.
- Canonical zonal combat resolver and combat wards.

## Stage 3 production additions

Implement additively:

1. `ProductionRecipe` and explicit inputs/outputs.
2. `ProductionObjectInventory` with amount, reserved amount and capacity.
3. `ProductionCycle` independent from personal shift timers.
4. Labor contributions from overlapping shifts.
5. Input reservation at cycle start and atomic output at completion.
6. Failure reasons for missing input, full output storage, damaged equipment or negative balance.
7. Private ownership and payroll from object balance.
8. Equipment durability and maintenance with repair components.
9. Restoration work with no salary and increased profession XP.
10. Profile switching with cost, downtime and visible retained inventory.

## Stage 3 social economy additions

- Personal farm and crops.
- Bars, recipes, food, drinks, buffs and sobriety.
- Consumable crafting.
- Clans, roles and permissions.
- Clan warehouse with audit trail.
- Clan treasury and spending policy.
- Clan farm/production access policy.

## Explicitly not carried as debt

These are new Stage 3 scope, not missing Stage 2 work:

- Multi-step conversion chains.
- Object input/output warehouses.
- Player-owned production facilities.
- Object-funded salaries.
- Equipment wear.
- Resource quality.
- Exchange order book beyond current listings.
- Territorial monopoly and property warfare.

## First vertical slice

Build and balance one closed chain before adding content breadth:

`scrap -> steel/component -> TT pistol -> battle wear -> repair component`

Acceptance requires atomic inventory reservation, observable cycle state, positive player specialization value, no duplicate output under retries, and economy simulation within the Stage 2 corridors.

## Migration policy

- Add tables and nullable fields only.
- Preserve all Stage 2 codes and logs.
- No rewrite of character resource stacks or market listings.
- New production events retain shared correlation IDs.
- Every new coefficient belongs in `BalanceConfig` and in deterministic simulation.
