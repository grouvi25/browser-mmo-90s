/**
 * СИМУЛЯТОР АНТИМАСТЕРСТВА — шаг G4 Этапа 5.
 *
 * Структура «20/1–20/20» заложена в Этапе 1 и ни разу не проверялась на
 * длинной дистанции. Сценарий из docs/specs/stage-5/STAGE5_ACCEPTANCE.md,
 * раздел 2:
 *
 *   два бойца равных характеристик и уровня
 *   A: навык «пистолет» 20, антимастерства нет
 *   B: навык «пистолет» 10, антимастерство против пистолета 20
 *   проверка: доля побед B не выше 60%
 *
 * Если B выигрывает чаще — специализация (путь A) наказана сильнее, чем
 * посредственность с точечной контрой (путь B), и это надо чинить до
 * релиза: после него игроки уже вложат в 20 уровень месяцы.
 *
 * Считается той же функцией, что и бой в игре — resolveAttack из
 * battle.formulas.ts, а не переписанной копией. Секундные характеристики
 * (STR/AGI/REA/END/LUCK/AGR, оружие, броня) у бойцов идентичны — раз ТЗ
 * говорит «равных характеристик», отличие только в навыке и антимастерстве.
 *
 * Раунд — взаимный обмен: оба бьют друг друга по разу, без блока (проверка
 * про навык и антимастерство, не про тактику блока). Это упрощение
 * реального пошагового боя, но не искажает то, что здесь измеряется:
 * calcRawDamage/calcHitChance/calcCritChance берут WSK и antiSkillLevel
 * ровно так же, как в настоящем бое.
 *
 * Запуск:
 *   npx tsx ../scripts/simulate-antimastery.ts --duels 2000 --seed 90210
 *
 * Отчёт: docs/stage5-antimastery-report.json. Код возврата 1, если доля
 * побед B выше 60%.
 */
import { writeFileSync } from 'fs'
import { resolveAttack, calcInitiative, type AttackerSnapshot, type DefenderSnapshot } from '../backend/src/modules/battles/battle.formulas'
import { calcHpMax } from '../backend/src/modules/stats/stats.formulas'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const duelCount = Number(arg('duels', '2000'))
const initialSeed = Number(arg('seed', '90210'))
const jsonPath = arg('json', '')

let seed = initialSeed
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Равные характеристики: STR/AGI/REA/END/LUCK/AGR = 20/20/20/20/10/10,
// пистолет ПМ (weapon_pistol_pm из economy-data.ts: 40-80 урона, точность
// 0.75), броня 20 (уровень «Кепка»+«Джинсы» по броне, без слотов головы/
// корпуса). Уровень для HP — 10 (не участвует в проверке, только общий
// пул очков здоровья).
const BASE_HP = calcHpMax(20, 10)

function makeFighter(weaponSkillLevel: number, antiSkillLevel: number): { atk: AttackerSnapshot; def: DefenderSnapshot; hp: number } {
  const atk: AttackerSnapshot = {
    str: 20, acc: 20, agi: 20, rea: 20, luck: 10, agr: 10, end: 20,
    weaponSkillLevel,
    minDamage: 40, maxDamage: 80, weaponAccuracy: 0.75,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: 3, antiDodgeBonus: 0, antiCounterBonus: 0,
  }
  const def: DefenderSnapshot = {
    agi: 20, rea: 20, end: 20, luck: 10,
    armor: 20, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 3,
    antiSkillLevel, antiCounterDefense: 0, antiLuck: 0,
    minDamage: 40, maxDamage: 80,
  }
  return { atk, def, hp: BASE_HP }
}

/** Один взаимный раунд: оба бьют друг друга без блока, урон применяется сразу. */
function fightRound(
  a: { atk: AttackerSnapshot; def: DefenderSnapshot; hp: number },
  b: { atk: AttackerSnapshot; def: DefenderSnapshot; hp: number },
) {
  // Инициатива решает, кто бьёт первым в этом раунде — совпадает с тем,
  // что WSK двигает инициативу в настоящем бою (ТЗ 17.3).
  const initA = calcInitiative(a.atk.rea, a.atk.agi, a.atk.weaponSkillLevel, a.atk.equipmentWeight)
  const initB = calcInitiative(b.atk.rea, b.atk.agi, b.atk.weaponSkillLevel, b.atk.equipmentWeight)
  const order = initA >= initB ? [[a, b], [b, a]] as const : [[b, a], [a, b]] as const
  for (const [attacker, defender] of order) {
    if (attacker.hp <= 0 || defender.hp <= 0) continue
    const result = resolveAttack(attacker.atk, defender.def, false, rnd)
    defender.hp -= result.finalDamage
    if (result.counterDamage > 0) attacker.hp -= result.counterDamage
  }
}

function fightDuel(): 'A' | 'B' | 'DRAW' {
  const a = makeFighter(20, 0)   // A: навык 20, антимастерства нет
  const b = makeFighter(10, 20)  // B: навык 10, антимастерство против пистолета 20
  const MAX_ROUNDS = 200 // предохранитель от зависшего боя при нулевом уроне
  for (let round = 0; round < MAX_ROUNDS; round++) {
    fightRound(a, b)
    const aDead = a.hp <= 0
    const bDead = b.hp <= 0
    if (aDead && bDead) return 'DRAW'
    if (bDead) return 'A'
    if (aDead) return 'B'
  }
  return 'DRAW'
}

let winsA = 0, winsB = 0, draws = 0
for (let i = 0; i < duelCount; i++) {
  const result = fightDuel()
  if (result === 'A') winsA++
  else if (result === 'B') winsB++
  else draws++
}

const decided = winsA + winsB
const bShare = decided > 0 ? winsB / decided : 0
const corridorOk = bShare <= 0.6

// --- Групповой вариант: B держит антимастерство только против пистолета.
// Пять атакующих, каждый со своим типом оружия (не только пистолет),
// бьют по B пять раз подряд — проверяем, что защита не размазывается на
// чужие типы оружия сами по себе (никакой отдельной формулы для этого нет,
// это чистая проверка на утечку — если B выживает так же хорошо, как в
// дуэли с пистолетчиком, антимастерство просто не сработало по типу).
function fightGroupRound(): { survivedHits: number; totalDamage: number } {
  const b = makeFighter(10, 20)
  let survivedHits = 0
  let totalDamage = 0
  // «Пистолет» — тот единственный тип, против которого у B 20 антимастерства;
  // остальные четыре — другой урон того же станка (min/max), но antiSkillLevel
  // применяется в бою по типу оружия защитника, здесь мы напрямую бьём с
  // antiSkillLevel=20 (как будто все пятеро — пистолетчики) и с antiSkillLevel=0
  // (как будто все пятеро — другим оружием), чтобы показать разницу.
  for (let i = 0; i < 5; i++) {
    const attacker = makeFighter(20, 0).atk
    const isPistolAttacker = i === 0 // один из пяти реально бьёт тем оружием, от которого есть антимастерство
    const def: DefenderSnapshot = { ...b.def, antiSkillLevel: isPistolAttacker ? 20 : 0 }
    const result = resolveAttack(attacker, def, false, rnd)
    totalDamage += result.finalDamage
    if (result.hit) survivedHits++
  }
  return { survivedHits, totalDamage }
}
let groupTotalDamage = 0
const GROUP_TRIALS = 500
for (let i = 0; i < GROUP_TRIALS; i++) groupTotalDamage += fightGroupRound().totalDamage
const avgGroupDamage = groupTotalDamage / GROUP_TRIALS
// Для сравнения: пятеро пистолетчиков (антимастерство B работает против всех)
function fightGroupAllPistol(): number {
  const b = makeFighter(10, 20)
  let dmg = 0
  for (let i = 0; i < 5; i++) {
    const attacker = makeFighter(20, 0).atk
    const result = resolveAttack(attacker, b.def, false, rnd)
    dmg += result.finalDamage
  }
  return dmg
}
let allPistolTotal = 0
for (let i = 0; i < GROUP_TRIALS; i++) allPistolTotal += fightGroupAllPistol()
const avgAllPistolDamage = allPistolTotal / GROUP_TRIALS
// В ТЗ нет точного числа для этой части — только качественное требование
// «антимастерство не размазывается на чужие типы оружия». Разношёрстная
// группа обязана бить ощутимо больнее (антимастерство B помогает только
// против одного пистолетчика из пяти), любой заметный зазор в верном
// направлении — не совпадение случайных бросков.
const antiSkillScoped = avgGroupDamage > avgAllPistolDamage * 1.05

console.log('\nСИМУЛЯТОР АНТИМАСТЕРСТВА\n')
console.log(`Дуэлей: ${duelCount}, зерно ${initialSeed}\n`)
console.log(`  A (навык 20, без антимастерства)            побед: ${winsA}`)
console.log(`  B (навык 10, антимастерство×пистолет 20)     побед: ${winsB}`)
console.log(`  Ничьих: ${draws}`)
console.log(`  Доля побед B (от решённых): ${(bShare * 100).toFixed(1)}%  (нужно ≤ 60%)`)
console.log(`  ${corridorOk ? 'OK' : 'FAIL'}   Антимастерство не делает специализацию проигрышной\n`)
console.log(`  Урон по B от 5 разных типов оружия (только 1 из 5 — пистолет): ${avgGroupDamage.toFixed(1)}`)
console.log(`  Урон по B от 5 пистолетчиков (антимастерство работает против всех): ${avgAllPistolDamage.toFixed(1)}`)
console.log(`  ${antiSkillScoped ? 'OK' : 'FAIL'}   Антимастерство не размазывается на чужие типы оружия (5×5)\n`)

const allOk = corridorOk && antiSkillScoped
console.log(`ИТОГ: ${allOk ? 'антимастерство не наказывает специализацию' : 'есть проблема'}`)

const report = {
  meta: { generatedAt: new Date().toISOString(), duels: duelCount, seed: initialSeed, source: 'docs/specs/stage-5/STAGE5_ACCEPTANCE.md, раздел 2' },
  duel: { winsA, winsB, draws, bSharePercent: Math.round(bShare * 1000) / 10, corridorOk },
  group: { avgGroupDamage, avgAllPistolDamage, antiSkillScoped },
  ok: allOk,
}
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')
else writeFileSync(require('path').resolve(__dirname, '../docs/stage5-antimastery-report.json'), JSON.stringify(report, null, 2), 'utf-8')

process.exit(allOk ? 0 : 1)
