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
