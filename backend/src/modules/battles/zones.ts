// =============================================================
// Зональная боёвка (модель Апехи): 6 зон, стойки, маппинг брони
// Чистый модуль без зависимостей от БД — легко тестировать.
// =============================================================
import type { ArmorSlot, BodyZone } from '@prisma/client'

// Ноги разведены на левую и правую, как руки: макет рисует их двумя
// ячейками («ЗБ Нога Л» и «ЗБ Нога П»). Устаревшее LEGS в список не
// входит — новые бои им не пользуются, оно живёт только в истории.
export const BODY_ZONES: BodyZone[] = ['HEAD', 'CHEST', 'RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG']

// Какие слоты брони прикрывают каждую зону.
// LEFT_HAND — это оружие (не броня), поэтому левую руку прикрывают только перчатки.
// Штаны и обувь прикрывают обе ноги сразу — отдельной брони на одну
// ногу в игре нет, поэтому у левой и правой набор слотов одинаковый.
export const ZONE_ARMOR_SLOTS: Record<BodyZone, ArmorSlot[]> = {
  HEAD: ['HEAD'],
  CHEST: ['CHEST', 'BACK', 'BELT'],
  RIGHT_ARM: ['RIGHT_HAND', 'GLOVES', 'HANDS'],
  LEFT_ARM: ['GLOVES', 'HANDS'],
  RIGHT_LEG: ['LEGS', 'FEET'],
  LEFT_LEG: ['LEGS', 'FEET'],
  // Старые бои: зона встречается в истории, броню по ней считаем так же.
  LEGS: ['LEGS', 'FEET'],
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
  /** Этап 4: переодевание в бою. Смена оружия — очко хода, брони — весь ход. */
  swapWeapon?: { hand: AttackHand; itemInstanceId: string }
  swapArmor?: { zone: BodyZone; itemInstanceId: string }
}

/**
 * Бюджет хода — два очка. Одно очко это либо удар, либо два блока: отсюда
 * и берутся три стойки, 2/0, 1/2 и 0/4, а не три отдельных набора.
 *
 * Переодевание тратит очки из того же бюджета, а не заводит своё правило:
 * смена оружия — одно очко, смена брони — оба. Так сохраняется главное
 * свойство боёвки: НАПАДЕНИЕ ВСЕГДА УМЕНЬШАЕТ ЗАЩИТУ, и наоборот.
 *
 * Очки снимаются сначала с ударов, потом с блоков. Порядок предсказуем:
 * игрок, сменивший оружие, теряет удар, а не защиту, — и это то, чего он
 * ожидает, меняя оружие.
 */
export function budgetAfterSwaps(
  budget: { attacks: number; blocks: number },
  swaps: { weapon?: unknown; armor?: unknown },
): { attacks: number; blocks: number } {
  if (swaps.armor) return { attacks: 0, blocks: 0 }
  if (!swaps.weapon) return budget
  if (budget.attacks > 0) return { attacks: budget.attacks - 1, blocks: budget.blocks }
  // Очков ударов нет — снимаем очко блоков, то есть два блока.
  return { attacks: 0, blocks: Math.max(0, budget.blocks - MAX_BLOCKS_PER_ZONE) }
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
  const budget = input?.moveTo
    ? { attacks: 0, blocks: 0 }
    : budgetAfterSwaps(STANCE_BUDGET[stance], { weapon: input?.swapWeapon, armor: input?.swapArmor })

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
    swapWeapon: input?.swapWeapon,
    swapArmor: input?.swapArmor,
    moveTo: input?.moveTo,
    targetParticipantId: input?.targetParticipantId,
  }
}

// Приоритет зон для авто-блока (голова и корпус важнее конечностей).
export const DEFAULT_BLOCK_PRIORITY: BodyZone[] = ['HEAD', 'CHEST', 'RIGHT_LEG', 'LEFT_LEG', 'RIGHT_ARM', 'LEFT_ARM']

// Маппинг старых действий на стойки (обратная совместимость API/старого фронта).
export function legacyActionToTurn(action: string): ZonalTurnInput {
  if (action === 'block') {
    // Полная защита: блок 4 из 6 зон (по приоритету), две остаются открыты.
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
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
