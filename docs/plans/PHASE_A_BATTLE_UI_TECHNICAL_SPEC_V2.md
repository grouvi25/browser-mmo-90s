# Phase A Battle UI, technical specification v2

Status: design revision after first production slice. This document supersedes the layout and hand-language sections of `PHASE_A_BATTLE_UI_TECHNICAL_SPEC.md`. It does not authorize combat-formula or database changes.

## 1. Verified problems

1. The authored desktop game viewport is only `1000.5 x 496` inside the `1550 x 900` stage. The current screen stacks the header, board, timer, a three-column planner, weapon line, log and pockets. The planner alone needs about 300 px, so scrolling is structural, not a spacing bug.
2. `LEFT_ARM` and `RIGHT_ARM` are defender body zones. They are not equipment slots and they are not the source of an attack.
3. `LEFT_HAND` and `RIGHT_HAND` exist as equipment slots, but weapon occupancy is not modeled. A weapon receives no hand slot and equipping one weapon unequips every other weapon. The current runtime therefore supports one active weapon, not dual wielding.
4. `HANDS` and `GLOVES` are both independently equippable and both add armor to both arms. `RIGHT_HAND` armor also protects `RIGHT_ARM`, while `LEFT_HAND` does not protect `LEFT_ARM`. This is compatibility residue, not a coherent hand model.
5. Backend attack zones may repeat, but the Phase A `toggleZone` UI behaves like a set. Therefore a legal plan such as two attacks to the chest cannot be entered from the current selector.
6. The current silhouettes duplicate information below the battlefield and disconnect the compact participant identity from zone selection.

## 2. Apeha evidence and Kooperativ adaptation

Official Apeha equipment rules treat the hands as two independent item positions: a complete set can contain two shields, two weapons, or one shield and one weapon. Apeha's useful lesson is the explicit separation of participant state, battlefield target selection and turn construction. It is not evidence that every one of the two attack actions belongs to a different anatomical hand.

Kooperativ will use the simpler and clearer model:

- left and right **arms** remain five-zone hit/block targets;
- left and right **hands** describe held equipment;
- the current two attacks are ordered blow slots, not “left punch” and “right punch”;
- Phase A shows both held-item positions but labels the current runtime honestly: one active weapon and one free/unsupported secondary hand;
- future equipment work may add `ONE_HANDED` and `TWO_HANDED` occupancy, with a main-hand weapon, an off-hand shield/sidearm, or one two-handed weapon occupying both hands;
- if dual wielding later affects resolution, each blow must carry an explicit `sourceHand`; it must never be inferred from target arm or blow order.

Recommended Stage 3 invariant: remove `HANDS` as an equippable runtime slot after migration, keep one canonical gloves slot for arm armor, and treat hand-held items separately from armor coverage.

## 3. Desktop composition, no page scroll

Target container: the standalone battle route, `100vw x 100dvh`. The battle root owns the viewport and uses `overflow: hidden`; it does not inherit the city shell or its scroll area. The layout must still remain usable at a minimum test canvas of `1000 x 496`.

- Top strip, 34 px: location, round, server/pending state.
- Middle region, remaining height: `190px / fluid / 190px` columns.
  - Left: compact own profile. HP, level, five clickable body zones for blocks, left/right held items.
  - Center: tactical field. Grid selection, target marker, range and one-line latest event. The current grid skin is temporary: the designer battlefield mockup will replace its visual layer next, without changing the surrounding profile and command contracts.
  - Right: compact selected-target profile. HP, level, five clickable body zones for attacks, left/right visible equipment when known.
- Bottom command dock, 118 px:
  - stance selector;
  - ordered attack slots and unique block summary;
  - seven-second timer;
  - one primary submit action;
  - log and pockets as overlays/disclosures, never rows in normal layout.

The side profiles are controls, not decorative cards. Clicking the left silhouette selects own block zones. Clicking the right silhouette appends attack targets. This removes two duplicated selectors and makes the left/right mental model obvious.

## 4. Turn interaction

### 4.1 Attacks

Attack selections are an ordered multiset.

- `attack2`: two entries, duplicates allowed.
- `mixed`: one entry.
- `defense4`: no entries.
- Clicking an enemy zone appends it to the next free blow slot.
- If both slots are full, the UI does not silently replace a blow. The user clears a slot or resets the plan.
- Selected zones display a count (`x2`) when repeated.

### 4.2 Blocks

Block selections are a unique set.

- `attack2`: zero zones.
- `mixed`: two unique zones.
- `defense4`: four unique zones.
- Clicking an own zone toggles it.

### 4.3 Movement and target

- Clicking a reachable empty grid cell creates a movement plan and temporarily clears attack/block choices.
- Clicking an enemy token changes the right profile and selected target without choosing an attack zone.
- Attack-zone controls remain disabled when the selected target is out of range.

## 5. Mobile composition

Battle routes use a focused shell. City district strips, contextual room strips and the normal bottom tab bar are hidden for the active fight; a compact exit/back action remains.

Portrait layout stays within `100dvh`:

- 32 px battle header;
- middle three-column duel view with narrow own/enemy profiles and a fluid field;
- 174 px command dock;
- zone labels abbreviate visually but keep full accessible names;
- log, pockets and surrender open in top-layer sheets and do not change page height.

Landscape under 560 px high uses the same focused shell and the full horizontal composition. There is no document scrolling in either orientation.

## 6. Data contract required for honest profiles

Phase A can ship without schema changes, but the battle response should expose stable participant presentation data:

- participant name and level;
- HP current/max;
- selected target id;
- public equipment summary for left hand and right hand, or an explicit unknown state;
- active weapon range;
- optional avatar.

Do not derive an enemy name as the hard-coded string “Opponent”, and do not infer hand occupancy from item type on the client.

## 7. Implementation sequence

1. Add ordered attack-slot view-model helpers and regression tests for duplicate zones.
2. Add compact `BattleFighterPanel` used for both sides, with mode `block` or `attack`.
3. Recompose the page into header, duel stage and command dock.
4. Move log and pockets into non-layout overlays/disclosures.
5. Add battle focus mode to desktop and mobile shells.
6. Expose participant presentation fields from the battle API.
7. Run keyboard, touch, 1550x900, 1366x768, 1000x496, 390x844 and 844x390 checks.

## 8. Acceptance criteria

- The battle document has no vertical or horizontal scrollbar at all target sizes.
- All primary actions are visible without scrolling.
- Own and selected-enemy compact profiles are simultaneously visible on desktop.
- Left and right arm zones are distinct on both profiles.
- Left and right held-item positions are displayed separately and never confused with body zones.
- Two attacks to the same body zone can be planned and submitted in order.
- Blocks cannot contain duplicates.
- Changing stance clears incompatible selections.
- Log, pockets and surrender never increase the base battle layout height.
- Focus, accessible names and 44 px touch targets remain intact.

