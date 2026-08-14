// =============================================================
// Зональная боёвка (модель Апехи): 5 зон, стойки, маппинг брони
// Чистый модуль без зависимостей от БД — легко тестировать.
// =============================================================
import type { ArmorSlot, BodyZone } from '@prisma/client'

export const BODY_ZONES: BodyZone[] = ['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM']

// Какие слоты брони прикрывают каждую зону.
// LEFT_HAND — это оружие (не броня), поэтому левую руку прикрывают только перчатки.
export const ZONE_ARMOR_SLOTS: Record<BodyZone, ArmorSlot[]> = {
  HEAD: ['HEAD'],
  CHEST: ['CHEST', 'BACK', 'BELT'],
  LEGS: ['LEGS', 'FEET'],
  RIGHT_ARM: ['RIGHT_HAND', 'GLOVES', 'HANDS'],
  LEFT_ARM: ['GLOVES', 'HANDS'],
}

// Стойки хода: сколько ударов и блоков допускается (фидбэк заказчика).
export type Stance = 'attack2' | 'mixed' | 'defense4'
export type AttackHand = 'LEFT_HAND' | 'RIGHT_HAND'

/** Сколько блоков принимает одна зона. Второй держит удачный удар. */
export const MAX_BLOCKS_PER_ZONE = 2

export const STANCE_BUDGET: Record<Stance, { attacks: number; blocks: number }> = {
  attack2: { attacks: 2, blocks: 0 },
  mixed: { attacks: 1, blocks: 2 },
  defense4: { attacks: 0, blocks: 4 },
}

export interface ZonalTurnInput {
  stance: Stance
  attackZones: BodyZone[]
  attackHands: AttackHand[]
  blockZones: BodyZone[]
  moveTo?: { x: number; y: number }
  targetParticipantId?: string
}

// Минимальная форма экипированного предмета для расчёта брони по зоне.
export interface EquipArmorLike {
  armor: number
  slot: ArmorSlot | null | undefined
}

// Суммарная броня зоны = сумма armor всех предметов в слотах этой зоны.
export function armorOfZone(equipped: EquipArmorLike[], zone: BodyZone): number {
  const slots = ZONE_ARMOR_SLOTS[zone]
  return equipped.reduce((sum, it) => {
    if (it.slot && slots.includes(it.slot)) return sum + (it.armor ?? 0)
    return sum
  }, 0)
}

export function botArmorOfZone(
  equipment: Record<string, unknown>,
  zone: BodyZone,
  fallbackArmor: number,
): number {
  const armor = equipment.armor
  if (!armor || typeof armor !== 'object' || Array.isArray(armor)) return Math.max(0, fallbackArmor)
  const value = (armor as Record<string, unknown>)[zone]
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : Math.max(0, fallbackArmor)
}

// Валидируем и нормализуем ход. Обрезаем зоны под бюджет стойки.
// Дубли разрешены с обеих сторон: бить дважды в одну зону можно, и
// закрыть одну зону двумя блоками тоже — второй блок держит удачный
// удар, который одиночный блок пробивает. Больше двух на зону смысла
// не имеет, поэтому третий отбрасывается.
export function normalizeTurn(input: Partial<ZonalTurnInput> | undefined): ZonalTurnInput {
  const stance: Stance =
    input?.stance && STANCE_BUDGET[input.stance] ? input.stance : 'attack2'
  const budget = input?.moveTo ? { attacks: 0, blocks: 0 } : STANCE_BUDGET[stance]

  const rawAttack = (input?.attackZones ?? []).filter(isBodyZone)
  const rawHands = (input?.attackHands ?? []).filter(isAttackHand)
  const rawBlock = (input?.blockZones ?? []).filter(isBodyZone)

  const attackZones = rawAttack.slice(0, budget.attacks)
  const attackHands = rawHands.slice(0, budget.attacks)
  // блоки: одна зона принимает не больше двух
  const blockCount = new Map<BodyZone, number>()
  const blockZones: BodyZone[] = []
  for (const zone of rawBlock) {
    if (blockZones.length >= budget.blocks) break
    const used = blockCount.get(zone) ?? 0
    if (used >= MAX_BLOCKS_PER_ZONE) continue
    blockCount.set(zone, used + 1)
    blockZones.push(zone)
  }

  // Если атак не хватает до бюджета — добиваем корпусом (дефолтная зона).
  while (attackZones.length < budget.attacks) attackZones.push('CHEST')
  const defaultHands: AttackHand[] = stance === 'attack2' ? ['LEFT_HAND', 'RIGHT_HAND'] : ['LEFT_HAND']
  while (attackHands.length < budget.attacks) attackHands.push(defaultHands[attackHands.length] ?? 'LEFT_HAND')
  // Если блоков не хватает — добиваем приоритетными зонами.
  if (blockZones.length < budget.blocks) {
    for (let layer = 0; layer < MAX_BLOCKS_PER_ZONE; layer++) {
      for (const z of DEFAULT_BLOCK_PRIORITY) {
        if (blockZones.length >= budget.blocks) break
        if ((blockCount.get(z) ?? 0) > layer) continue
        blockCount.set(z, (blockCount.get(z) ?? 0) + 1)
        blockZones.push(z)
      }
    }
  }

  return {
    stance,
    attackZones,
    attackHands,
    blockZones,
    moveTo: input?.moveTo,
    targetParticipantId: input?.targetParticipantId,
  }
}

// Приоритет зон для авто-блока (голова и корпус важнее рук).
export const DEFAULT_BLOCK_PRIORITY: BodyZone[] = ['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM']

// Маппинг старых действий на стойки (обратная совместимость API/старого фронта).
export function legacyActionToTurn(action: string): ZonalTurnInput {
  if (action === 'block') {
    // Полная защита: блок 4 из 5 зон (по приоритету), 5-я открыта.
    return normalizeTurn({ stance: 'defense4', blockZones: DEFAULT_BLOCK_PRIORITY.slice(0, 4) })
  }
  // attack по умолчанию: 2 удара в корпус.
  return normalizeTurn({ stance: 'attack2', attackZones: ['CHEST', 'CHEST'] })
}

// Простое AI бота: случайная стойка + случайные зоны.
export function botChooseTurn(rng: () => number = Math.random): ZonalTurnInput {
  const roll = rng()
  if (roll < 0.55) {
    // чаще атакует
    return normalizeTurn({
      stance: 'attack2',
      attackZones: [randomZone(rng), randomZone(rng)],
    })
  } else if (roll < 0.8) {
    return normalizeTurn({
      stance: 'mixed',
      attackZones: [randomZone(rng)],
      blockZones: [randomZone(rng)],
    })
  }
  // полная защита: 4 случайные уникальные зоны
  return normalizeTurn({ stance: 'defense4', blockZones: shuffle(BODY_ZONES, rng).slice(0, 4) })
}

export function randomZone(rng: () => number = Math.random): BodyZone {
  return BODY_ZONES[Math.floor(rng() * BODY_ZONES.length)]
}

// helpers
function isAttackHand(hand: unknown): hand is AttackHand {
  return hand === 'LEFT_HAND' || hand === 'RIGHT_HAND'
}
function isBodyZone(z: unknown): z is BodyZone {
  return typeof z === 'string' && (BODY_ZONES as string[]).includes(z)
}
function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
