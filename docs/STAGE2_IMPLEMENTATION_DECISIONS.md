# Stage 2 implementation decisions

This file records deliberate deviations and clarifications for MASTER TZ 2.2. Runtime behavior and tests are the implementation evidence.

Production economy metrics are collected once on worker startup and daily at 04:00 UTC, after the scheduled database backup window. Snapshots stay in Redis for 40 days and are exposed through the admin economy overview.

## Salary fatigue

Accepted as a Stage 2 anti-farm rule. The first shift pays the calculated rate; each subsequent shift in the same UTC day reduces the multiplier by 0.20 down to a floor of 0.20. The coefficients live in `BalanceConfig.economy.work.salaryFatigueStep` and `salaryFatigueFloor`; runtime and the economy simulator use the same values.

Reason: eight full-rate shifts made work a flat money faucet and broke the sink/faucet corridors. Removing fatigue requires an explicit balance decision and a simulator report proving the economy remains healthy.

## SHIFT_READY production event

`SHIFT_READY` is the canonical event emitted when `work-shift-finalize` moves a shift from `ACTIVE` to `READY_TO_CLAIM`. It is intentionally distinct from `SHIFT_CLAIMED`: readiness releases the character from `WORKING`, while claim awards salary, profession XP and resources.

## Revision 2.1 production chains

Stage 2 implements the production foundation: professions, production objects, shifts, resource outputs, repair parts, private shops and market demand. Multi-step processing chains, installed equipment and tool wear are deferred to Stage 3. The current schema preserves `ownerType`, object durability, resource categories and profession requirements so this extension remains additive.

## Source of truth

`docs/specs/stage-2/MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx` is authoritative. Version 2.0 files are historical and must not be used for new implementation decisions.

## Revision 2.1 minimum implemented in Stage 2

Stage 2 includes the minimal `ProductionObject -> ProductionEquipment -> consumable Tool` contract required by MASTER v2.2. Every seeded system production object has one system-owned equipment record. Its `requiredToolTier` is enforced when a shift starts; the chosen tool is reserved on the shift and exactly one use is consumed atomically on successful claim. Cancellation releases the tool without consuming a use, and idempotent claim replay cannot consume twice.

This does not activate Stage 3 ownership or production chains. Players cannot buy production objects/equipment, equipment does not wear, objects have no input/output inventories, and recipes do not consume upstream resources yet.

## Combat compatibility corrections before Stage 3

The Apeha action budget is canonical: the mixed stance is one attack plus two blocked zones. A lucky hit pierces a selected block but does not bypass armor. The older behavior that let Luck ignore armor was removed because official Apeha material only supports block piercing and pressure against evasion.

## Canonical combat resolver

PvE and PvP now resolve through one zonal pipeline with injected RNG support. Accuracy and evasion are one contest; attacker Luck and anti-dodge pressure help that contest. Lucky hits pierce selected blocks but never armor. Anti-luck reduces block piercing, anti-counter reduces counter chance, and counter damage is a bounded fraction of incoming force. The compatibility resolveAttack entry point delegates to this resolver rather than maintaining a second formula.
