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
import { DOG_BREEDS } from '../city/dogs'

export const COMBAT_DOG = {
  damageMin: 1, damageMinPerLevel: 1,
  damageMax: 3, damageMaxPerLevel: 1.5,
  hitChance: 0.7, critChance: 0.1, critMultiplier: 1.5,
} as const

/** Собака в бою (лежит в Redis вместе с хозяином). */
export interface LiveDog {
  id: string
  name: string
  level: number
  damageDealt: number
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
    select: { id: true, name: true, level: true },
  })
  if (!pet) return undefined
  return { id: pet.id, name: pet.name, level: pet.level, damageDealt: 0 }
}

