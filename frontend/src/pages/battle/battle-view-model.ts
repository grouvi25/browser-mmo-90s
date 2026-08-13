import type { BodyZone, GridPosition, Stance } from '../../shared/api/battles.api'

export const BATTLE_ZONES: readonly { key: BodyZone; label: string; short: string }[] = [
  { key: 'HEAD', label: 'Голова', short: 'голова' },
  { key: 'CHEST', label: 'Корпус', short: 'корпус' },
  { key: 'LEFT_ARM', label: 'Левая рука', short: 'левая рука' },
  { key: 'RIGHT_ARM', label: 'Правая рука', short: 'правая рука' },
  { key: 'LEGS', label: 'Ноги', short: 'ноги' },
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
  if (input.blockZones.length < budget.blocks) {
    const left = budget.blocks - input.blockZones.length
    return { valid: false, reason: `Выберите ещё ${left} ${left === 1 ? 'зону блока' : 'зоны блока'}` }
  }
  return { valid: true, reason: '' }
}
