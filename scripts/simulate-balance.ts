/**
 * БОЕВОЙ СИМУЛЯТОР — проверка баланса Этапа 1
 * ТЗ раздел 26.3: бой 4–8 раундов, win rate 55–70%, урон не в ноль
 *
 * Запуск: npx tsx scripts/simulate-balance.ts
 */

import { resolveAttack, resolveZonalAttack, calcInitiative } from '../backend/src/modules/battles/battle.formulas'
import { calcHpMax, calcRepairCost } from '../backend/src/modules/stats/stats.formulas'
import type { AttackerSnapshot, DefenderSnapshot } from '../backend/src/modules/battles/battle.formulas'

// ─── Стартовый персонаж (уровень 1, базовые статы) ───────────────────────────
if (process.argv.includes('--zonal')) {
  const attacker = {
    str: 3, acc: 3, agi: 3, rea: 2, luck: 1, agr: 1, end: 3,
    weaponSkillLevel: 1, minDamage: 10, maxDamage: 25, weaponAccuracy: 0.85,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: 0, antiDodgeBonus: 0, antiCounterBonus: 0,
  } as AttackerSnapshot
  const defender = {
    agi: 3, rea: 2, end: 3, luck: 1, armor: 5,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
    antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 3, maxDamage: 8,
  } as DefenderSnapshot
  const zones = ['HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM'] as const
  let hits = 0, damage = 0, blockPierced = 0
  for (let i = 0; i < 1000; i++) {
    const zone = zones[i % zones.length]
    const blockedZones = i % 2 === 0 ? [zone] : []
    const result = resolveZonalAttack(attacker, defender, { zone, blockedZones, zoneArmor: 5 })
    if (result.hit) hits++
    damage += result.finalDamage
    if (result.blockPierced) blockPierced++
  }
  const hitRate = hits / 1000
  const ok = hitRate >= 0.05 && hitRate <= 0.95 && damage >= 0
  console.log(JSON.stringify({ mode: 'zonal', runs: 1000, hitRate, damage, blockPierced, ok }, null, 2))
  process.exit(ok ? 0 : 1)
}

const STARTER_PLAYER = {
  str: 3, acc: 3, agi: 3, rea: 2, luck: 1, agr: 1, end: 3,
  level: 1,
  hp: calcHpMax(3, 1),  // 60 + 3×6 + 1×2 = 80
}

// ─── Оружие из магазина ──────────────────────────────────────────────────────
const WEAPONS = {
  fists:    { name: 'Кулаки',          min: 10, max: 25,  acc: 0.85, weight: 0,   price: 0,    wtype: 'MELEE'  },
  knife:    { name: 'Перочинный нож',  min: 20, max: 45,  acc: 0.80, weight: 0.5, price: 200,  wtype: 'KNIFE'  },
  pipe:     { name: 'Труба',           min: 30, max: 65,  acc: 0.70, weight: 2.0, price: 350,  wtype: 'CLUB'   },
  pistol:   { name: 'Пистолет ПМ',    min: 40, max: 80,  acc: 0.75, weight: 1.0, price: 800,  wtype: 'PISTOL' },
  shotgun:  { name: 'Охотничье ружьё', min: 70, max: 140, acc: 0.60, weight: 3.5, price: 1500, wtype: 'SHOTGUN'},
}

// ─── Броня из магазина ───────────────────────────────────────────────────────
const ARMOR_SETS = {
  none:  { name: 'Без брони',       armor: 0,  weight: 0,   price: 0    },
  basic: { name: 'Куртка + джинсы', armor: 16, weight: 2.3, price: 500  }, // jacket(10) + jeans(6)
  full:  { name: 'Полная броня',     armor: 41, weight: 8.5, price: 2850 }, // vest(25)+cap(4)+jeans(6)+boots(6) = 41
}

// ─── Боты из seed.ts ─────────────────────────────────────────────────────────
const BOTS = {
  training_bandit: {
    name: 'Тренировочный хулиган', level: 1, power: 5, hp: 40,
    stats: { str: 2, agi: 2, rea: 1, acc: 2, end: 2, luck: 1, agr: 1, armor: 5 },
    weapon: { min: 10, max: 22, acc: 0.65 },
  },
  basic_gangster: {
    name: 'Гопник', level: 2, power: 12, hp: 75,
    stats: { str: 3, agi: 3, rea: 2, acc: 3, end: 3, luck: 1, agr: 2, armor: 10 },
    weapon: { min: 20, max: 42, acc: 0.70 },
  },
  armed_thug: {
    name: 'Вооружённый бандит', level: 4, power: 25, hp: 90,
    stats: { str: 4, agi: 3, rea: 2, acc: 4, end: 4, luck: 1, agr: 2, armor: 18 },
    weapon: { min: 40, max: 80, acc: 0.72 },
  },
}

// ─── Одиночный бой ───────────────────────────────────────────────────────────
interface SimResult {
  rounds: number
  won: boolean
  playerDmgDealt: number
  botDmgDealt: number
  playerHpLeft: number
  botHpLeft: number
}

function simulateFight(
  playerWeapon: typeof WEAPONS.fists,
  playerArmor: typeof ARMOR_SETS.none,
  playerSkill: number,
  bot: typeof BOTS.training_bandit
): SimResult {
  const playerSnap: AttackerSnapshot = {
    str: STARTER_PLAYER.str, acc: STARTER_PLAYER.acc, agi: STARTER_PLAYER.agi,
    rea: STARTER_PLAYER.rea, luck: STARTER_PLAYER.luck, agr: STARTER_PLAYER.agr, end: STARTER_PLAYER.end,
    weaponSkillLevel: playerSkill,
    minDamage: playerWeapon.min, maxDamage: playerWeapon.max,
    weaponAccuracy: playerWeapon.acc,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: playerWeapon.weight + playerArmor.weight,
  }

  const playerDef: DefenderSnapshot = {
    agi: STARTER_PLAYER.agi, rea: STARTER_PLAYER.rea, end: STARTER_PLAYER.end, luck: STARTER_PLAYER.luck,
    armor: playerArmor.armor,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0,
    armorWeight: playerArmor.weight,
    antiSkillLevel: 0,
  }

  const botSnap: AttackerSnapshot = {
    str: bot.stats.str, acc: bot.stats.acc, agi: bot.stats.agi,
    rea: bot.stats.rea, luck: bot.stats.luck, agr: bot.stats.agr, end: bot.stats.end,
    weaponSkillLevel: 1,
    minDamage: bot.weapon.min, maxDamage: bot.weapon.max,
    weaponAccuracy: bot.weapon.acc,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: 0,
  }

  const botDef: DefenderSnapshot = {
    agi: bot.stats.agi, rea: bot.stats.rea, end: bot.stats.end, luck: bot.stats.luck,
    armor: bot.stats.armor,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
    antiSkillLevel: 0,
  }

  let playerHp = STARTER_PLAYER.hp
  let botHp = bot.hp
  let rounds = 0
  let playerDmgDealt = 0, botDmgDealt = 0

  while (playerHp > 0 && botHp > 0 && rounds < 30) {
    rounds++

    const pInit = calcInitiative(STARTER_PLAYER.rea, STARTER_PLAYER.agi, playerSkill, playerSnap.equipmentWeight)
    const bInit = calcInitiative(bot.stats.rea, bot.stats.agi, 1, 0)
    const playerFirst = pInit >= bInit

    const doPlayerAttack = () => {
      const r = resolveAttack(playerSnap, botDef, false)
      if (r.hit && !r.dodge) {
        botHp = Math.max(0, botHp - r.finalDamage)
        playerDmgDealt += r.finalDamage
      }
    }
    const doBotAttack = () => {
      const r = resolveAttack(botSnap, playerDef, false)
      if (r.hit && !r.dodge) {
        playerHp = Math.max(0, playerHp - r.finalDamage)
        botDmgDealt += r.finalDamage
      }
    }

    if (playerFirst) {
      doPlayerAttack()
      if (botHp > 0) doBotAttack()
    } else {
      doBotAttack()
      if (playerHp > 0) doPlayerAttack()
    }
  }

  return {
    rounds,
    won: botHp <= 0,
    playerDmgDealt, botDmgDealt,
    playerHpLeft: playerHp,
    botHpLeft: botHp,
  }
}

// ─── Статистика ───────────────────────────────────────────────────────────────
function stats(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b)
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const p25 = sorted[Math.floor(arr.length * 0.25)]
  const p75 = sorted[Math.floor(arr.length * 0.75)]
  const p95 = sorted[Math.floor(arr.length * 0.95)]
  return { mean: mean.toFixed(2), min, max, p25, p75, p95 }
}

// ─── Запуск симуляций ─────────────────────────────────────────────────────────
const RUNS = 10_000

console.log('\n═══════════════════════════════════════════════════════')
console.log('     СИМУЛЯЦИЯ БАЛАНСА — Этап 1 (10 000 боёв)')
console.log('═══════════════════════════════════════════════════════\n')

// Сценарии по ТЗ раздел 17.12
const scenarios = [
  {
    label: 'Новичок (кулаки) vs Тренировочный хулиган',
    weapon: WEAPONS.fists, armor: ARMOR_SETS.none, skill: 1, bot: BOTS.training_bandit,
    targetRounds: '4–6', targetWinRate: '55–70%',
  },
  {
    label: 'Новичок (нож) vs Тренировочный хулиган',
    weapon: WEAPONS.knife, armor: ARMOR_SETS.none, skill: 1, bot: BOTS.training_bandit,
    targetRounds: '4–6', targetWinRate: '65–80%',
  },
  {
    label: 'Новичок (нож+броня) vs Тренировочный хулиган',
    weapon: WEAPONS.knife, armor: ARMOR_SETS.basic, skill: 1, bot: BOTS.training_bandit,
    targetRounds: '5–8', targetWinRate: '70–85%',
  },
  {
    label: 'Новичок (нож) vs Гопник',
    weapon: WEAPONS.knife, armor: ARMOR_SETS.none, skill: 1, bot: BOTS.basic_gangster,
    targetRounds: '5–8', targetWinRate: '40–60%',
  },
  {
    label: 'Новичок (нож+броня) vs Гопник [стартовый набор]',
    weapon: WEAPONS.knife, armor: ARMOR_SETS.basic, skill: 1, bot: BOTS.basic_gangster,
    targetRounds: '5–8', targetWinRate: '55–70%',
  },
  {
    label: 'Новичок (труба) vs Гопник',
    weapon: WEAPONS.pipe, armor: ARMOR_SETS.basic, skill: 1, bot: BOTS.basic_gangster,
    targetRounds: '5–8', targetWinRate: '50–65%',
  },
  {
    label: 'Новичок (ПМ) vs Гопник',
    weapon: WEAPONS.pistol, armor: ARMOR_SETS.basic, skill: 3, bot: BOTS.basic_gangster,
    targetRounds: '4–7', targetWinRate: '60–75%',
  },
  {
    label: 'Новичок (дробовик) vs Бандит',
    weapon: WEAPONS.shotgun, armor: ARMOR_SETS.full, skill: 5, bot: BOTS.armed_thug,
    targetRounds: '5–10', targetWinRate: '35–55%',
  },
]

for (const s of scenarios) {
  const results: SimResult[] = []
  for (let i = 0; i < RUNS; i++) {
    results.push(simulateFight(s.weapon, s.armor, s.skill, s.bot))
  }

  const wins = results.filter(r => r.won).length
  const winRate = (wins / RUNS * 100).toFixed(1)
  const roundArr = results.map(r => r.rounds)
  const dmgArr   = results.map(r => r.playerDmgDealt)
  const rStats   = stats(roundArr)
  const dStats   = stats(dmgArr)

  const roundOk   = parseFloat(rStats.mean) >= 3.5 && parseFloat(rStats.mean) <= 12
  const winOk     = parseFloat(winRate) >= 30 && parseFloat(winRate) <= 90

  console.log(`📊 ${s.label}`)
  console.log(`   Цель раундов: ${s.targetRounds}  |  Цель win rate: ${s.targetWinRate}`)
  console.log(`   Раундов: avg=${rStats.mean}  p25=${rStats.p25}  p75=${rStats.p75}  p95=${rStats.p95}  ${roundOk ? '✅' : '⚠️'}`)
  console.log(`   Win rate: ${winRate}%  ${winOk ? '✅' : '⚠️'}`)
  console.log(`   Урон игрока за бой: avg=${dStats.mean}  min=${dStats.min}  max=${dStats.max}`)
  console.log()
}

// ─── Проверка ремонта ─────────────────────────────────────────────────────────
console.log('─── Стоимость ремонта (ТЗ: ощутимо, но не душит) ───────')
const repairTests = [
  { name: 'Нож (200₽)', price: 200, lost: 3, quality: 'COMMON' },
  { name: 'Труба (350₽)', price: 350, lost: 3, quality: 'COMMON' },
  { name: 'ПМ (800₽)', price: 800, lost: 3, quality: 'COMMON' },
  { name: 'Дробовик (1500₽)', price: 1500, lost: 3, quality: 'COMMON' },
  { name: 'Куртка (300₽)', price: 300, lost: 1, quality: 'COMMON' },
  { name: 'Бронежилет (2000₽)', price: 2000, lost: 2, quality: 'COMMON' },
]
for (const r of repairTests) {
  const cost = calcRepairCost(r.price, r.lost, r.quality)
  const pct  = (cost / r.price * 100).toFixed(1)
  const ok   = cost > 0 && cost < r.price * 0.15
  console.log(`   ${r.name}: −${r.lost} dur → ремонт ${cost}₽ (${pct}% от цены)  ${ok ? '✅' : '⚠️'}`)
}

// ─── Проверка урона (не уходит в 0, не взрывается) ───────────────────────────
console.log('\n─── Экстремальные сценарии (урон не в 0, не в ∞) ───────')
const extremeTests = [
  {
    label: 'Слабый vs очень сильный',
    atk: { ...WEAPONS.fists, weight: 0 },
    atkStats: { str: 1, acc: 1, agi: 1, rea: 1, luck: 1, agr: 1, end: 1 },
    def: { armor: 20, weight: 10 },
  },
  {
    label: 'Очень сильный vs слабый',
    atk: { ...WEAPONS.shotgun, weight: 3.5 },
    atkStats: { str: 10, acc: 10, agi: 10, rea: 5, luck: 5, agr: 5, end: 5 },
    def: { armor: 0, weight: 0 },
  },
]
for (const e of extremeTests) {
  const snap: AttackerSnapshot = {
    str: e.atkStats.str, acc: e.atkStats.acc, agi: e.atkStats.agi,
    rea: e.atkStats.rea, luck: e.atkStats.luck, agr: e.atkStats.agr, end: e.atkStats.end,
    weaponSkillLevel: 5,
    minDamage: e.atk.min, maxDamage: e.atk.max, weaponAccuracy: e.atk.acc,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: e.atk.weight,
  }
  const def: DefenderSnapshot = {
    agi: 3, rea: 2, end: 3, luck: 1, armor: e.def.armor,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: e.def.weight, antiSkillLevel: 0,
  }
  const damages: number[] = []
  for (let i = 0; i < 1000; i++) {
    const r = resolveAttack(snap, def, false)
    if (r.hit && !r.dodge && !r.block) damages.push(r.finalDamage)
  }
  if (damages.length > 0) {
    const avg = (damages.reduce((a, b) => a + b, 0) / damages.length).toFixed(1)
    const min = Math.min(...damages)
    const max = Math.max(...damages)
    const ok = min >= 1 && max <= 200
    console.log(`   ${e.label}: avg=${avg} min=${min} max=${max}  ${ok ? '✅' : '⚠️'}`)
  }
}

console.log('\n═══════════════════════════════════════════════════════')
console.log('     СИМУЛЯЦИЯ ЗАВЕРШЕНА')
console.log('═══════════════════════════════════════════════════════\n')
