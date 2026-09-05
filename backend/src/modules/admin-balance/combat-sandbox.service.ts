// =============================================================
// ПЕСОЧНИЦА БОЯ
//
// «Что будет, если...» — вопрос, на который до сих пор отвечал только
// прогон симулятора из командной строки. Здесь то же самое, но с ответом
// сразу и по любым характеристикам: два бойца, разложенные шансы и серия
// дуэлей.
//
// Считают НАСТОЯЩИЕ функции боя — resolveAttack, calcHitChance и прочие из
// battle.formulas. Ни одна формула не переписана: песочница, считающая по
// своей копии, показывала бы не игру, а себя.
//
// Генератор случайных чисел детерминирован и берётся из зерна: один и тот
// же ввод даёт один и тот же результат, поэтому две прикидки можно честно
// сравнивать между собой.
// =============================================================
import { z } from 'zod'
import {
  calcBlockChance, calcCritChance, calcDodgeChance, calcEffectiveWeaponSkill,
  calcHitChance, calcInitiative, calcWeaponSkillMultiplier, resolveAttack,
  type AttackerSnapshot, type DefenderSnapshot,
} from '../battles/battle.formulas'
import { calcHpMax } from '../stats/stats.formulas'
import { BalanceConfig as B } from '../../config/balance.config'

const Fighter = z.object({
  name: z.string().min(1).max(24),
  str: z.number().int().min(1).max(30),
  agi: z.number().int().min(1).max(30),
  rea: z.number().int().min(1).max(30),
  acc: z.number().int().min(1).max(30),
  end: z.number().int().min(1).max(30),
  luck: z.number().int().min(0).max(30),
  agr: z.number().int().min(0).max(30),
  battleLevel: z.number().int().min(1).max(30),
  weaponSkill: z.number().int().min(0).max(30),
  antiSkill: z.number().int().min(0).max(30),
  minDamage: z.number().int().min(1).max(500),
  maxDamage: z.number().int().min(1).max(500),
  weaponAccuracy: z.number().min(0.05).max(1),
  armor: z.number().int().min(0).max(200),
  equipmentWeight: z.number().min(0).max(60),
})

export const CombatSandboxSchema = z.object({
  a: Fighter,
  b: Fighter,
  duels: z.number().int().min(10).max(5000),
  seed: z.number().int().min(1).max(1_000_000),
})

export type CombatSandboxInput = z.infer<typeof CombatSandboxSchema>
type FighterInput = z.infer<typeof Fighter>

function snapshots(fighter: FighterInput): { atk: AttackerSnapshot; def: DefenderSnapshot; hp: number } {
  return {
    atk: {
      str: fighter.str, acc: fighter.acc, agi: fighter.agi, rea: fighter.rea,
      luck: fighter.luck, agr: fighter.agr, end: fighter.end,
      weaponSkillLevel: fighter.weaponSkill,
      minDamage: Math.min(fighter.minDamage, fighter.maxDamage),
      maxDamage: Math.max(fighter.minDamage, fighter.maxDamage),
      weaponAccuracy: fighter.weaponAccuracy,
      critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
      equipmentWeight: fighter.equipmentWeight,
      antiDodgeBonus: 0, antiCounterBonus: 0,
    },
    def: {
      agi: fighter.agi, rea: fighter.rea, end: fighter.end, luck: fighter.luck,
      armor: fighter.armor, dodgeBonus: 0, antiCrit: 0, blockBonus: 0,
      armorWeight: fighter.equipmentWeight,
      antiSkillLevel: fighter.antiSkill, antiCounterDefense: 0, antiLuck: 0,
      minDamage: fighter.minDamage, maxDamage: fighter.maxDamage,
    },
    hp: calcHpMax(fighter.end, fighter.battleLevel),
  }
}

/** Детерминированный генератор: одно зерно — один и тот же прогон. */
function rng(seed: number): () => number {
  let state = seed | 0
  return () => {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Разложенные шансы одной стороны против другой — до всякой случайности. */
function odds(attacker: FighterInput, defender: FighterInput) {
  const a = snapshots(attacker)
  const d = snapshots(defender)
  const effectiveSkill = calcEffectiveWeaponSkill(attacker.weaponSkill, defender.antiSkill)
  // Инициатива показывается БЕЗ случайного слагаемого: calcInitiative
  // подмешивает разброс ±5, и у двух одинаковых бойцов числа выходили
  // разными — это читалось как преимущество, которого нет. В самом бою
  // разброс, конечно, работает.
  const initiativeBase = attacker.rea * B.initiative.reaMultiplier
    + attacker.agi * B.initiative.agiMultiplier
    + attacker.weaponSkill * B.initiative.wskMultiplier
    - attacker.equipmentWeight * B.initiative.weightPenalty

  return {
    initiative: Math.round(Math.max(B.initiative.min, initiativeBase)),
    initiativeSpread: B.initiative.randomRange,
    hit: calcHitChance(a.atk, d.def),
    dodge: calcDodgeChance(d.def, a.atk),
    block: calcBlockChance(d.def, a.atk),
    crit: calcCritChance(a.atk, d.def),
    effectiveSkill,
    skillMultiplier: calcWeaponSkillMultiplier(effectiveSkill),
  }
}

export function simulateCombat(input: CombatSandboxInput) {
  const random = rng(input.seed)
  let winsA = 0, winsB = 0, draws = 0
  let totalRounds = 0
  let damageA = 0, damageB = 0, hitsA = 0, hitsB = 0, swingsA = 0, swingsB = 0

  for (let duel = 0; duel < input.duels; duel++) {
    const a = snapshots(input.a)
    const b = snapshots(input.b)
    let round = 0
    // Предохранитель: при нулевом уроне бой иначе не кончится никогда.
    const MAX_ROUNDS = 200

    for (; round < MAX_ROUNDS; round++) {
      const initA = calcInitiative(a.atk.rea, a.atk.agi, a.atk.weaponSkillLevel, a.atk.equipmentWeight)
      const initB = calcInitiative(b.atk.rea, b.atk.agi, b.atk.weaponSkillLevel, b.atk.equipmentWeight)
      const order = initA >= initB
        ? [[a, b, 'a'], [b, a, 'b']] as const
        : [[b, a, 'b'], [a, b, 'a']] as const

      for (const [attacker, defender, side] of order) {
        if (attacker.hp <= 0 || defender.hp <= 0) continue
        const result = resolveAttack(attacker.atk, defender.def, false, random)
        defender.hp -= result.finalDamage
        if (result.counterDamage > 0) attacker.hp -= result.counterDamage
        if (side === 'a') {
          swingsA++; damageA += result.finalDamage; if (result.finalDamage > 0) hitsA++
        } else {
          swingsB++; damageB += result.finalDamage; if (result.finalDamage > 0) hitsB++
        }
      }

      if (a.hp <= 0 || b.hp <= 0) break
    }

    totalRounds += round + 1
    if (a.hp <= 0 && b.hp <= 0) draws++
    else if (b.hp <= 0) winsA++
    else if (a.hp <= 0) winsB++
    else draws++
  }

  const decided = winsA + winsB
  return {
    a: {
      name: input.a.name,
      hp: calcHpMax(input.a.end, input.a.battleLevel),
      odds: odds(input.a, input.b),
      wins: winsA,
      winShare: decided > 0 ? winsA / decided : 0,
      averageDamagePerSwing: swingsA > 0 ? damageA / swingsA : 0,
      landedShare: swingsA > 0 ? hitsA / swingsA : 0,
    },
    b: {
      name: input.b.name,
      hp: calcHpMax(input.b.end, input.b.battleLevel),
      odds: odds(input.b, input.a),
      wins: winsB,
      winShare: decided > 0 ? winsB / decided : 0,
      averageDamagePerSwing: swingsB > 0 ? damageB / swingsB : 0,
      landedShare: swingsB > 0 ? hitsB / swingsB : 0,
    },
    draws,
    duels: input.duels,
    averageRounds: input.duels > 0 ? totalRounds / input.duels : 0,
  }
}
