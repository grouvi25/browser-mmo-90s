# Apeha combat experiment matrix for Kooperativ

Collected: 2026-08-13
Machine-readable matrix: `data/apeha_combat_experiment_matrix.csv`

## Ground truth from Apeha

Officially confirmed:

- one turn permits 2 attacks, 4 blocks, or 1 attack + 2 blocks;
- movement is cell-based;
- Strength controls damage;
- Agility controls dodge;
- Reaction controls automatic counterattack;
- Luck pierces blocks and helps against evasive opponents;
- Anger controls critical hits;
- Constitution controls HP;
- critical hit is described as Strength × 1.5;
- counterattack depends on incoming attack force and the Reaction contest;
- wards counter dodge, luck, counterattack and critical hit.

Not publicly confirmed:

- exact probability formulas;
- exact order of block versus dodge resolution;
- whether lucky and critical can coexist;
- full armor/durability formula;
- exact counterattack damage formula and trigger conditions.

Those unknowns are experiments, not facts to invent.

## Matrix size

The CSV contains **40 experiments** in five phases:

1. resolution semantics and formulas;
2. builds and action-budget balance;
3. zones, movement, targeting and timeout behavior;
4. economy, durability, rewards and anti-farm;
5. deterministic regression and invariants.

## Phase 1: resolve ambiguous mechanics first

Run A01–A13 before tuning any constants. These are paired A/B tests that answer structural questions:

- block-first vs dodge-first;
- lucky pierces block only vs block+armor;
- coexistence of lucky and critical;
- when counterattack triggers;
- counterattack based on incoming force vs defender weapon;
- ratio vs additive contests;
- diminishing-return wards;
- wiring anti-luck, anti-dodge and anti-counter.

Do not tune builds until these choices are stable. Changing resolution order after balance work invalidates the reports.

### Recommended initial hypotheses

These are proposed defaults, not Apeha claims:

1. block status is evaluated before dodge for a selected blocked zone;
2. lucky pierces block but does not bypass armor;
3. lucky and critical may coexist, but joint burst is capped by normal armor/endurance rules;
4. counterattack triggers only when an attack reaches the defender, including an intentionally blocked attack only if product decides so;
5. counter damage blends incoming force with defender capability and has a cap;
6. every offensive dimension has a ward with diminishing returns.

## Phase 2: build matrix

B01–B10 compare equal total stat/item budgets. Equal level is not enough. Every build fixture must expose:

- base stats;
- item stat budget;
- upgrade budget;
- price and repair burden;
- weapon range;
- armor by zone;
- relevant wards.

### Target balance

- mirror match: 50% ±3 percentage points;
- soft counter: 55–70%;
- hard counter: never above 75% at equal economic budget;
- hybrid: 40–60% average and no normal matchup below 25%;
- one-turn kill rate below 5% for ordinary equal-tier builds;
- block-only timeout below 10%.

These are Kooperativ acceptance targets, not claims about Apeha.

## Phase 3: tactical field

C01–C08 validate:

- zone armor mapping;
- zonal durability wear;
- melee closing distance;
- ranged point-blank behavior;
- line of sight;
- target selection in 2v2 and 4v4;
- spawn symmetry;
- seven-second auto-action behavior.

Every movement experiment must run with sides swapped. Side delta above 3pp is a map/spawn bug until proven otherwise.

## Phase 4: economy coupling

Combat cannot be balanced only by win rate. D01–D04 measure:

- combat power per ruble;
- repair burden by build;
- reward efficiency by strategy;
- repeated-bot anti-farm bias.

A tank that wins 50% but costs twice as much to repair is not economically equal. A blocker that farms XP by extending rounds is exploitable even if combat win rate looks correct.

## Phase 5: regression invariants

E01–E05 become permanent CI gates:

- deterministic report for fixed seed;
- side symmetry;
- all probabilities bounded;
- all legal fights terminate;
- event-log replay reproduces HP, positions and durability exactly.

## Fixture catalog

Create immutable fixtures:

- `baseline_equal`
- `strength_specialist`
- `accuracy_specialist`
- `dodge_specialist`
- `reaction_specialist`
- `luck_specialist`
- `anger_crit_specialist`
- `blocker`
- `anti_dodge_ward`
- `anti_counter_ward`
- `anti_luck_ward`
- `anti_crit_tank`
- `hybrid`
- tier-1 and tier-2 versions of each where applicable.

Each fixture must have the same declared total budget inside a comparison group.

## Required report schema

```json
{
  "experimentId": "A02",
  "seed": 90210,
  "configHash": "...",
  "runs": 10000,
  "variants": {
    "A": { "wins": 0, "metrics": {} },
    "B": { "wins": 0, "metrics": {} }
  },
  "delta": {},
  "acceptance": { "passed": true, "reasons": [] }
}
```

Per experiment capture at minimum:

- win rate and confidence interval;
- average/p50/p95 rounds;
- damage per attack and per round;
- hit, dodge, block, lucky, critical and counter rates;
- damage share by source;
- HP remaining;
- movement and distance by round;
- timeout rate;
- durability loss and repair cost;
- XP/money per minute where relevant.

## Statistical procedure

- probability micro-tests: at least 10,000 events per variant;
- full 1v1 simulations: at least 5,000 fights per variant;
- 2v2: at least 3,000;
- 4v4: at least 2,000;
- fixed seed for reproducibility plus a second validation seed;
- report Wilson 95% confidence intervals for binary outcomes;
- reject a claimed difference if confidence intervals overlap heavily and effect size is negligible;
- never tune more than one mechanic family in one experiment batch.

## Implementation order

1. Add seeded RNG injection to every combat random decision.
2. Add explainable event fields: pre-chance, final chance, roll, modifiers and cap.
3. Implement a simulator adapter around production `resolveZonalAttack`, grid and snapshots.
4. Add fixtures with explicit stat budgets.
5. Run A01–A13 and record product decisions.
6. Freeze resolution semantics.
7. Run build matrix B01–B10.
8. Tune one coefficient family at a time.
9. Run C/D phases.
10. Promote E01–E05 to CI.

## Immediate code findings to test

Current Kooperativ behavior requiring direct experiments:

- dodge is resolved before blocked-zone handling;
- lucky can bypass armor in the zonal path;
- counterattack damage is simplified;
- anti-dodge and anti-counter are zero in attacker snapshots;
- explicit anti-luck ward is absent;
- timeout auto-block can be strategically stronger than an active mixed turn;
- equal-stat tests do not establish equal-budget build balance.

## Exit criteria for a combat revision

A combat revision can ship only when:

- all Phase 1 structural questions have explicit decisions;
- all build fixtures declare equal budget;
- mirror symmetry passes;
- no normal soft counter exceeds 75%;
- timeout/stall and one-turn kill limits pass;
- repair cost and reward efficiency have no unintended dominant build;
- event-log replay is exact;
- production formulas and simulator use the same code paths.

This matrix is intentionally stricter than “run random fights and inspect win rate.” It is designed to stop hidden interactions among zones, wards, movement, economy and progression from slipping into production.
