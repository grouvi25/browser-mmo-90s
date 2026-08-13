# Stage 2 Closure Plan

Date: 2026-08-13
Authority: `docs/specs/stage-2/MASTER_TZ_STAGE_2_ECONOMY_CORE_v2.2.docx`, revisions 2.1 and 2.2 override earlier text. The five-stage roadmap defines product boundaries but does not override the detailed Stage 2 MASTER specification.

## Closure rule

Stage 2 is accepted only when the implemented loop `work -> resources/components -> market/private shops -> repair/upgrades -> battle` is complete, reproducible, observable, covered by CI, and deployed by the existing CI/CD pipeline. Multi-step recipes, object inventories, private production ownership, equipment maintenance and resource quality remain Stage 3.

## Track A: Canon and scope

1. Record all deliberate deviations from v2.2 in `STAGE2_IMPLEMENTATION_DECISIONS.md`.
2. Keep independent professions from revision 2.2; the aggregate production level remains compatibility-only.
3. Keep salary fatigue as the approved anti-farm deviation, with coefficients in `BalanceConfig`.
4. Implement the Stage 2 portion of revision 2.1: consumable tools and one system-owned equipment record per production object.
5. Do not introduce recipes, object inventory, private payroll or multi-stage conversion in Stage 2.

Exit: no unresolved contradiction between roadmap, MASTER v2.2, code and acceptance report.

## Track B: Production tools and equipment

1. Extend item templates/instances with tool tier and remaining/max uses.
2. Add `ProductionEquipment`, exactly one active system record per seeded production object.
3. Seed three tool tiers in the government shop and equipment for every active Stage 2 object.
4. Expose required tool tier and equipment in the work-object API/UI.
5. At shift start, select and lock an eligible owned tool with remaining uses.
6. Store the chosen tool on `WorkShift`; never re-select it at claim time.
7. At claim, atomically consume one use in the same transaction as salary, XP and resource output.
8. A tool with zero uses becomes `CONSUMED`; cancellation does not consume a use.
9. Concurrent starts/claims must not overbook or over-consume a tool.

Exit: a shift cannot start without the required tool, one successful claim consumes exactly one use, retries are idempotent.

## Track C: Work limits and progression

1. Remove hard-coded daily limits from `WorkService`; use `BalanceConfig` as the sole source.
2. Preserve the accepted salary-fatigue model separately from eligibility limits.
3. Keep profession XP independent per profession.
4. Validate 2/4/8/14-hour activity profiles in the deterministic progression simulation.
5. Require top profession progression to take at least 6 months at 14 hours/day; publish the evidence artifact in CI.

Exit: runtime, UI and simulations report identical limits and progression.

## Track D: Combat foundation debt blocking expansion

1. Fix the mixed stance to 1 attack + 2 blocks.
2. Create one canonical zonal resolution pipeline; retire the divergent legacy resolver after compatibility tests.
3. Use attacker Luck, never defender Luck, for lucky outcomes.
4. Lucky attacks pierce selected blocks and pressure dodge, but do not bypass armor.
5. Wire hit/accuracy into the canonical resolver without double-counting dodge.
6. Wire anti-dodge, anti-luck, anti-counter and anti-crit modifiers through item stats and battle snapshots.
7. Derive counterattack damage from incoming attack force with bounded coefficients.
8. Move every coefficient to `BalanceConfig`.
9. Emit structured resolution evidence (chance inputs, roll, outcome) to battle logs for debugging.
10. Run the 40-case Apeha experiment matrix before accepting balance.

Exit: one resolver for PvE/PvP, deterministic tests, no dominant build outside agreed corridors.

## Track E: QA and CI gates

1. Unit tests: tool selection/use, equipment requirements, time limits, profession progression, combat resolution.
2. Integration tests: start/claim/cancel, retry/replay, concurrent claim, concurrent market buy, repair and upgrades.
3. E2E: complete economic loop and browser work flow.
4. Migration additivity gate remains mandatory.
5. Backend/frontend lint, typecheck and production builds remain mandatory.
6. Economy, profession, zonal combat and Apeha matrix simulations become required CI artifacts.
7. Update authenticated production smoke to verify equipment/tool fields and the loop without bypasses.

Exit: all CI jobs green for the exact main commit; CD deploys only that verified SHA.

## Track F: Observability and formal acceptance

1. Add metrics for shifts blocked by missing tools, tool uses consumed, claims replayed and failed cycles.
2. Preserve CurrencyLog, ResourceLog, ItemLog, ProductionLog and UpgradeLog correlation IDs.
3. Add admin read models for equipment/tool state and suspicious replay/concurrency activity.
4. Produce `STAGE2_ACCEPTANCE_REPORT.md` mapping every v2.2 criterion to code, tests and CI evidence.
5. Produce `STAGE2_STAGE3_HANDOFF.md` listing deferred recipes, inventories, private payroll, equipment wear and ownership.

Exit: acceptance report contains no `unknown`, `partial` or unowned blocker; Stage 2 status becomes `ACCEPTED`.

## Implementation order

P0: scope record, additive schema/migration, tools/equipment seed, transactional work flow.
P1: combat resolver consolidation and modifiers.
P2: full CI evidence, smoke updates, observability and acceptance documents.

No Stage 3 feature starts before P0-P2 are green in CI/CD.