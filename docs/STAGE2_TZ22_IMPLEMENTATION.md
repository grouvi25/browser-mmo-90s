# Stage 2 TZ 2.2 implementation

Implemented on 2026-08-07.

## Independent professions

- `CharacterProfession` stores independent level and XP per character and profession.
- The nine Stage 2 professions are modeled explicitly.
- A profession unlocks only when its first shift starts successfully.
- Production objects require `requiredProfessionCode` and `requiredProfessionLevel`.
- Salary efficiency, shift XP, object locks, private-shop requirements, and upgrade chance use the relevant profession.
- XP thresholds are exactly 0, 500, 1,500, 3,500, 8,000, 16,000, and 30,000 for levels 0 through 6.
- Legacy character production fields remain compatibility aggregates only and are not used by functional mechanics.
- Existing production progress is preserved by an additive backfill migration.

## Item stat budget

- Templates support `statBudget`, `statAllocation`, and `allocationMode` (`FIXED`, `MASTER`, `PLAYER`).
- Instances support independent `statAllocation` and `freePoints`.
- Player allocation is validated by item family, is irreversible, transaction-safe, and audited as `POINTS_ALLOCATED`.
- Allocated points and upgrade points are combined into one effective stat budget.
- Damage, accuracy, crit, armor, durability, and anti-crit effects are applied in battle.
- Durability point allocation preserves the current durability ratio.
- The inventory UI exposes available points and compatible allocation actions.

## Verification

Coverage includes exact XP thresholds, all nine professions, first-shift unlock, profession isolation, profession-specific upgrades, item allocation validation, and effective stat calculations. Full database, API, browser, migration, security, and production checks are mandatory in CI.
