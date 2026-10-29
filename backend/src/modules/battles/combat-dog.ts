// =============================================================
// Собака в бою (правка заказчика 22.10): «так же можно выпускать в бой
// собаку + помощника одного».
//
// Собака выходит рядом с хозяином, как боевой помощник (combat-helper.ts),
// и так же не занимает клетку: бьёт цель хозяина вслед за его ударом.
// Удары на себя не принимает и сама под удар не попадает. Выходит только
// сытая собака из Зоомагазина; бонус к характеристикам хозяина у неё
// остаётся отдельно (dogs.ts). В дуэль не выходит по тому же правилу,
// что и помощник: дуэль — один на один.
//
// Числа стартовые, их пересчитает математик.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { DOG_BREEDS, dogBonus } from '../city/dogs'
import { dogHpMax, type DogCombatStats } from './companions'
import type { GridPosition } from './grid'

export const COMBAT_DOG = {
  damageMin: 1, damageMinPerLevel: 1,
  damageMax: 3, damageMaxPerLevel: 1.5,
  hitChance: 0.7, critChance: 0.1, critMultiplier: 1.5,
  /** На поле (правка 28.10): своё здоровье и вклад характеристик собаки. */
  hpBase: 25, hpPerLevel: 6, hpPerEnd: 6,
  damagePerStr: 0.5, hitPerAcc: 0.02, critPerLuck: 0.01,
} as const

/** Собака в бою (лежит в Redis вместе с хозяином). На поле её нет, пока
 *  хозяин её не вызовет (companions.ts). */
export interface LiveDog {
  id: string
  name: string
  level: number
  damageDealt: number
  hp: number
  hpMax: number
  alive: boolean
  stats: DogCombatStats
  position?: GridPosition
  summoned?: boolean
}

export interface DogStrike { hit: boolean; crit: boolean; damage: number }

/** Укус по цели хозяина. rnd — для тестов. */
export function dogStrike(dog: LiveDog, rnd: () => number = Math.random): DogStrike {
  if (rnd() >= COMBAT_DOG.hitChance) return { hit: false, crit: false, damage: 0 }
  const min = COMBAT_DOG.damageMin + COMBAT_DOG.damageMinPerLevel * dog.level
  const max = COMBAT_DOG.damageMax + COMBAT_DOG.damageMaxPerLevel * dog.level
  const crit = rnd() < COMBAT_DOG.critChance
  const damage = Math.max(1, Math.round((min + (max - min) * rnd()) * (crit ? COMBAT_DOG.critMultiplier : 1)))
  return { hit: true, crit, damage }
}

/** Сытая собака хозяина для нового боя. */
export async function loadCombatDog(characterId: string, now = new Date()): Promise<LiveDog | undefined> {
  const pet = await prisma.characterPet.findFirst({
    where: { characterId, code: { in: DOG_BREEDS.map(b => b.code) }, fedUntil: { gt: now } },
    select: { id: true, name: true, level: true, code: true, fedUntil: true, allocation: true, gear: true },
  })
  if (!pet) return undefined
  // Характеристики собаки: стандартной — по породе, донатной — как
  // распределил хозяин, плюс снаряжение (dogs.ts).
  const bonus = dogBonus(pet)
  const stats: DogCombatStats = {
    str: bonus.str ?? 0, agi: bonus.agi ?? 0, rea: bonus.rea ?? 0,
    acc: bonus.acc ?? 0, end: bonus.end ?? 0, luck: bonus.luck ?? 0,
  }
  const hpMax = dogHpMax(pet.level, stats.end)
  return { id: pet.id, name: pet.name, level: pet.level, damageDealt: 0, hp: hpMax, hpMax, alive: true, stats }
}

