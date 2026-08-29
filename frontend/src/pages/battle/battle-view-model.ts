import type { AttackHand, BodyZone, GridPosition, Stance } from '../../shared/api/battles.api'

// caption — подпись на ячейке зоны. Отдельно от label: «Правая рука» не влезает
// в колонку и переносится на вторую строку, сдвигая ячейки руки вниз.
// Сокращения взяты из макета от 22.08.
export const BATTLE_ZONES: readonly { key: BodyZone; label: string; short: string; caption: string }[] = [
  { key: 'HEAD', label: 'Голова', short: 'голова', caption: 'Голова' },
  { key: 'CHEST', label: 'Корпус', short: 'корпус', caption: 'Корпус' },
  { key: 'LEFT_ARM', label: 'Левая рука', short: 'левая рука', caption: 'Л.рука' },
  { key: 'RIGHT_ARM', label: 'Правая рука', short: 'правая рука', caption: 'П.рука' },
  // Ноги разведены на левую и правую, как руки: макет рисует их
  // отдельными ячейками — слои «ЗБ Нога Л» и «ЗБ Нога П».
  { key: 'LEFT_LEG', label: 'Левая нога', short: 'левая нога', caption: 'Л.нога' },
  { key: 'RIGHT_LEG', label: 'Правая нога', short: 'правая нога', caption: 'П.нога' },
]

export const BATTLE_STANCES: readonly {
  key: Stance
  label: string
  attacks: number
  blocks: number
  hint: string
}[] = [
  { key: 'attack2', label: '2 удара', attacks: 2, blocks: 0, hint: 'Максимальная атака, без блоков' },
  { key: 'mixed', label: '1 удар + 2 блока', attacks: 1, blocks: 2, hint: 'Сбалансированный ход' },
  { key: 'defense4', label: '4 блока', attacks: 0, blocks: 4, hint: 'Полная защита, без атаки' },
]

export const ZONE_LABEL = Object.fromEntries(BATTLE_ZONES.map(zone => [zone.key, zone.short])) as Record<BodyZone, string>

export function getActionBudget(stance: Stance) {
  return BATTLE_STANCES.find(item => item.key === stance) ?? BATTLE_STANCES[0]
}

export function toggleZone(selected: BodyZone[], zone: BodyZone, limit: number): BodyZone[] {
  if (selected.includes(zone)) return selected.filter(item => item !== zone)
  if (selected.length >= limit) return selected
  return [...selected, zone]
}

export function appendAttackZone(selected: BodyZone[], zone: BodyZone, limit: number): BodyZone[] {
  if (selected.length >= limit) return selected
  return [...selected, zone]
}

export function removeAttackZone(selected: BodyZone[], index: number): BodyZone[] {
  return selected.filter((_, itemIndex) => itemIndex !== index)
}


export interface AutomaticTurnPlan {
  stance: Stance
  attackZones: BodyZone[]
  attackHands: AttackHand[]
  blockZones: BodyZone[]
}

const HAND_ORDER: readonly AttackHand[] = ['LEFT_HAND', 'RIGHT_HAND']

function deriveAutomaticPlan(attackHands: AttackHand[], attackZones: BodyZone[], blockZones: BodyZone[]): AutomaticTurnPlan {
  if (attackHands.length >= 2) return { stance: 'attack2', attackHands: attackHands.slice(0, 2), attackZones: attackZones.slice(0, 2), blockZones: [] }
  if (attackHands.length === 1) return { stance: 'mixed', attackHands, attackZones, blockZones: blockZones.slice(0, 2) }
  return { stance: 'defense4', attackHands: [], attackZones: [], blockZones: blockZones.slice(0, 4) }
}

/** The player selects intent on the two silhouettes. The stance is derived and
 * never chosen separately. Conflicting clicks are ignored instead of erasing a
 * choice the player already made. */
export function selectAutomaticAttack(plan: AutomaticTurnPlan, hand: AttackHand, zone: BodyZone): AutomaticTurnPlan {
  const choices = new Map<AttackHand, BodyZone>(plan.attackHands.map((value, index) => [value, plan.attackZones[index]]))
  if (choices.get(hand) === zone) choices.delete(hand)
  else if (choices.has(hand)) choices.set(hand, zone)
  else {
    if (plan.blockZones.length >= 3 || plan.attackHands.length >= 2) return plan
    if (plan.blockZones.length > 0 && plan.attackHands.length >= 1) return plan
    choices.set(hand, zone)
  }
  const ordered = HAND_ORDER.flatMap(value => choices.has(value) ? [{ hand: value, zone: choices.get(value)! }] : [])
  return deriveAutomaticPlan(ordered.map(item => item.hand), ordered.map(item => item.zone), plan.blockZones)
}

/** Сколько блоков принимает одна зона — зеркало MAX_BLOCKS_PER_ZONE сервера. */
export const MAX_BLOCKS_PER_ZONE = 2

export function blocksOnZone(plan: AutomaticTurnPlan, zone: BodyZone): number {
  return plan.blockZones.filter(value => value === zone).length
}

/**
 * Блок ставится в одну из двух ячеек зоны — как удар ставится в одну из
 * двух рук. Повторный клик по занятой ячейке снимает блок. Второй блок
 * на зоне держит удачный удар, который одиночный пропускает.
 */
export function toggleAutomaticBlockSlot(
  plan: AutomaticTurnPlan, zone: BodyZone, slot: number,
): AutomaticTurnPlan {
  if (plan.attackHands.length >= 2) return plan
  const limit = plan.attackHands.length === 1 ? 2 : 4
  const count = blocksOnZone(plan, zone)

  let blockZones: BodyZone[]
  if (count > slot) {
    const last = plan.blockZones.lastIndexOf(zone)
    blockZones = plan.blockZones.filter((_, index) => index !== last)
  } else {
    if (plan.blockZones.length >= limit || count >= MAX_BLOCKS_PER_ZONE) return plan
    blockZones = [...plan.blockZones, zone]
  }
  return deriveAutomaticPlan(plan.attackHands, plan.attackZones, blockZones)
}

export function removeAutomaticAttack(plan: AutomaticTurnPlan, index: number): AutomaticTurnPlan {
  return deriveAutomaticPlan(
    plan.attackHands.filter((_, itemIndex) => itemIndex !== index),
    removeAttackZone(plan.attackZones, index),
    plan.blockZones,
  )
}

export function getTurnPlanText(input: {
  stance: Stance
  attackZones: BodyZone[]
  blockZones: BodyZone[]
  selectedMove?: GridPosition | null
}): string {
  if (input.selectedMove) return `Движение: клетка ${input.selectedMove.x}:${input.selectedMove.y}`
  const budget = getActionBudget(input.stance)
  const attacks = input.attackZones.map(zone => ZONE_LABEL[zone]).join(', ')
  const blocks = input.blockZones.map(zone => ZONE_LABEL[zone]).join(', ')
  if (input.attackZones.length === 0 && input.blockZones.length === 0) return 'План не заполнен'
  if (budget.attacks > 0 && budget.blocks > 0) {
    return `${budget.attacks} удар: ${attacks || 'не выбрано'} · ${budget.blocks} блока: ${blocks || 'не выбрано'}`
  }
  if (budget.attacks > 0) return `${budget.attacks} удара: ${attacks || 'не выбрано'}`
  return `${budget.blocks} блока: ${blocks || 'не выбрано'}`
}

export type TurnPlanValidation = {
  valid: boolean
  reason: string
}

export function validateTurnPlan(input: {
  stance: Stance
  attackZones: BodyZone[]
  attackHands?: AttackHand[]
  blockZones: BodyZone[]
  targetParticipantId?: string | null
  targetInRange: boolean
  selectedMove?: GridPosition | null
}): TurnPlanValidation {
  if (input.selectedMove) return { valid: true, reason: '' }
  const budget = getActionBudget(input.stance)
  if (budget.attacks > 0 && !input.targetParticipantId) return { valid: false, reason: 'Выберите цель' }
  if (budget.attacks > 0 && !input.targetInRange) return { valid: false, reason: 'Цель вне досягаемости' }
  if (input.attackZones.length < budget.attacks) {
    const left = budget.attacks - input.attackZones.length
    return { valid: false, reason: `Выберите ещё ${left} ${left === 1 ? 'зону удара' : 'зоны удара'}` }
  }
  const hands = input.attackHands ?? []
  if (budget.attacks > 0 && hands.length < budget.attacks) return { valid: false, reason: 'Выберите руку для каждого удара' }
  if (input.stance === 'attack2' && new Set(hands).size !== 2) return { valid: false, reason: 'Для двух ударов нужны обе руки' }
  if (input.blockZones.length < budget.blocks) {
    const left = budget.blocks - input.blockZones.length
    return { valid: false, reason: `Выберите ещё ${left} ${left === 1 ? 'зону блока' : 'зоны блока'}` }
  }
  return { valid: true, reason: '' }
}
