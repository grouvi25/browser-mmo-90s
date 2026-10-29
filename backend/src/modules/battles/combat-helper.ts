// =============================================================
// Боевой помощник: дерётся рядом с хозяином.
//
// Правка заказчика (21.10.2026): помощников двое — боевой и рабочий (или
// два рабочих). Что делает боевой, взято из «Апехи» по решению владельца
// проекта: бойцовый питомец выходит в бой вместе с хозяином и дерётся
// сам по выбранной тактике, растёт в уровне от боёв.
//
// Помощник не занимает клетку на поле: оба резолвера (бой с ботом и
// групповой) рассчитаны на бойцов-персонажей, и второй фигурой его
// пришлось бы вписывать в сетку, ходы и износ заново. Вместо этого он
// бьёт цель хозяина после его удара и по тактике принимает часть ударов
// по хозяину на себя. Выбитый помощник до конца боя не действует.
// В дуэли не выходит — иначе дуэль становится двое на одного.
// =============================================================
import type { HelperTactic } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { PremiumService } from '../premium/premium.service'
import { gridDistance, type GridPosition } from './grid'

/** Стартовые числа; согласуются с заказчиком, как и остальной баланс. */
export const COMBAT_HELPER = {
  hpBase: 30, hpPerLevel: 12,
  damageMin: 2, damageMinPerLevel: 1.5,
  damageMax: 4, damageMaxPerLevel: 2.5,
  hitChance: 0.75, critChance: 0.1, critMultiplier: 1.5,
  /** Тактика: множитель урона и шанс принять удар по хозяину на себя. */
  tactics: {
    ATTACK: { damage: 1.25, intercept: 0 },
    STANDARD: { damage: 1, intercept: 0.15 },
    DEFENSIVE: { damage: 0.6, intercept: 0.35 },
  } satisfies Record<HelperTactic, { damage: number; intercept: number }>,
  /** Опыт: за урон и за победу хозяина; порог уровня — 50 × уровень². */
  expPerDamage: 1, expForWin: 20, expForLoss: 5, expLevelBase: 50, maxLevel: 20,
} as const

export const TACTIC_LABEL: Record<HelperTactic, string> = { ATTACK: 'атакующая', STANDARD: 'стандартная', DEFENSIVE: 'защитная' }

/** Состояние помощника в бою (лежит в Redis вместе с хозяином). */
export interface LiveHelper {
  id: string
  name: string
  level: number
  tactic: HelperTactic
  hp: number
  hpMax: number
  alive: boolean
  damageDealt: number
  /** На поле только после вызова (companions.ts, правка 28.10). */
  position?: GridPosition
  summoned?: boolean
}

export function helperHpMax(level: number): number {
  return COMBAT_HELPER.hpBase + COMBAT_HELPER.hpPerLevel * Math.max(1, level)
}

export function expToNextLevel(level: number): number {
  return COMBAT_HELPER.expLevelBase * level * level
}

/** Уровень по накопленному опыту: суммарные пороги 50·1², 50·2², … */
export function helperLevelFromExp(exp: number): number {
  let level = 1, need = expToNextLevel(1), left = exp
  while (left >= need && level < COMBAT_HELPER.maxLevel) { left -= need; level++; need = expToNextLevel(level) }
  return level
}

export interface HelperStrike { hit: boolean; crit: boolean; damage: number }

/** Удар помощника по цели хозяина. rnd — для тестов. */
export function helperStrike(helper: LiveHelper, rnd: () => number = Math.random): HelperStrike {
  const t = COMBAT_HELPER.tactics[helper.tactic]
  if (rnd() >= COMBAT_HELPER.hitChance) return { hit: false, crit: false, damage: 0 }
  const min = COMBAT_HELPER.damageMin + COMBAT_HELPER.damageMinPerLevel * helper.level
  const max = COMBAT_HELPER.damageMax + COMBAT_HELPER.damageMaxPerLevel * helper.level
  const base = min + (max - min) * rnd()
  const crit = rnd() < COMBAT_HELPER.critChance
  const damage = Math.max(1, Math.round(base * t.damage * (crit ? COMBAT_HELPER.critMultiplier : 1)))
  return { hit: true, crit, damage }
}

/** Принимает ли помощник этот удар по хозяину на себя: только вызванный на
 *  поле и стоящий вплотную к хозяину (правка 28.10 — помощник теперь фигура). */
export function helperIntercepts(helper: LiveHelper | undefined, owner?: GridPosition, rnd: () => number = Math.random): boolean {
  if (!helper?.alive || !helper.summoned || !helper.position || !owner) return false
  if (gridDistance(helper.position, owner) > 1) return false
  return rnd() < COMBAT_HELPER.tactics[helper.tactic].intercept
}

/** Помощник принял удар: урон идёт в него, при нуле он выбывает. */
export function damageHelper(helper: LiveHelper, damage: number): void {
  helper.hp = Math.max(0, helper.hp - damage)
  if (helper.hp === 0) helper.alive = false
}

/** Активный боевой помощник хозяина для нового боя (полное здоровье). */
export async function loadCombatHelper(characterId: string): Promise<LiveHelper | undefined> {
  const helper = await prisma.helper.findFirst({
    where: { characterId, kind: 'COMBAT', status: 'ACTIVE' },
    select: { id: true, name: true, combatLevel: true, tactic: true },
  })
  if (!helper) return undefined
  // Без подписки помощник «спит» (как и рабочий) и в бой не выходит.
  if (!(await PremiumService.state(characterId)).isPremium) return undefined
  const hpMax = helperHpMax(helper.combatLevel)
  return { id: helper.id, name: helper.name, level: helper.combatLevel, tactic: helper.tactic, hp: hpMax, hpMax, alive: true, damageDealt: 0 }
}

/** Опыт за бой: урон помощника и итог хозяина. Возвращает новый уровень. */
export async function awardCombatHelper(helper: LiveHelper | undefined, won: boolean): Promise<{ exp: number; level: number } | null> {
  if (!helper) return null
  const gain = Math.round(helper.damageDealt * COMBAT_HELPER.expPerDamage + (won ? COMBAT_HELPER.expForWin : COMBAT_HELPER.expForLoss))
  const row = await prisma.helper.findUnique({ where: { id: helper.id }, select: { combatExp: true } })
  if (!row) return null
  const exp = row.combatExp + gain
  const level = helperLevelFromExp(exp)
  await prisma.helper.update({ where: { id: helper.id }, data: { combatExp: exp, combatLevel: level } })
  return { exp: gain, level }
}
