// =============================================================
// ЖИВЫЕ ПРИМЕРЫ РАСЧЁТА
//
// Формула словами объясняет замысел, но не показывает, как из входов
// получается число. Здесь каждый пример считается ТЕМИ ЖЕ функциями, что
// работают в игре, — ни одна формула не переписана. Поэтому пример не может
// разойтись с игрой: поменяется коэффициент или код — поменяется и разбор.
//
// Шаги показывают промежуточные значения: видно не только «сколько», но и
// «откуда столько».
// =============================================================
import { BalanceConfig as B } from '../../config/balance.config'
import { attackDamageHp, catalogPointsToHp as hp } from '../battles/combat-hp'
import {
  calcCritChance, calcDodgeChance, calcEffectiveWeaponSkill,
  calcWeaponSkillMultiplier, calcArmorFlat, calcLuckyPierceChance,
} from '../battles/battle.formulas'
import { calcFinalSalary, dailyShiftSalaryCoeff, objectLevelCoeff, workerEfficiency } from '../work/work.formulas'
import { calcUpgradeCost, calcUpgradeSuccessChance } from '../upgrades/upgrades.formulas'
import { calcListingFee, calcSaleTax, calcSellerPayout } from '../market/market.formulas'
import { territoryUpkeepPerDay } from '../territories/territories.formulas'
import { calcRepairCost } from '../stats/stats.formulas'

export interface ExampleStep {
  /** Что считаем на этом шаге — с подставленными числами. */
  text: string
  /** Что получилось. */
  value: string
}

export interface BalanceExample {
  /** Исходные данные примера. */
  given: string[]
  steps: ExampleStep[]
  /** Итог и что он означает. */
  result: string
  meaning: string
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`
const round2 = (value: number) => Math.round(value * 100) / 100

/** Боец средней руки — общий герой примеров, чтобы числа были сопоставимы. */
const ATTACKER = {
  str: 8, acc: 7, agi: 6, rea: 6, luck: 3, agr: 4, end: 6,
  weaponSkillLevel: 10,
  minDamage: 20, maxDamage: 45,
  weaponAccuracy: 0.8,
  critBonus: 0, critDamageBonus: 0, blockPierce: 0,
  flatDamageBonus: 0, equipmentWeight: 12,
  antiDodgeBonus: 0, antiCounterBonus: 0,
}

const DEFENDER = {
  agi: 6, rea: 5, end: 7, luck: 2, agr: 3, level: 5,
  armor: 15,
  dodgeBonus: 0, antiCrit: 0, blockBonus: 0,
  armorWeight: 14,
  antiSkillLevel: 0,
  antiCounterDefense: 0,
}

export const BALANCE_EXAMPLES: Record<string, () => BalanceExample> = {
  'character.hp': () => {
    const end = 5, level = 3
    const fromEnd = end * B.character.hpPerEnd
    const fromLevel = level * B.character.hpPerBattleLevel
    return {
      given: [`END ${end}`, `боевой уровень ${level}`],
      steps: [
        { text: 'база одинаковая у всех', value: String(B.character.baseHp) },
        { text: `выносливость: ${end} × ${B.character.hpPerEnd}`, value: `+${fromEnd}` },
        { text: `уровень: ${level} × ${B.character.hpPerBattleLevel}`, value: `+${fromLevel}` },
      ],
      result: `${B.character.baseHp + fromEnd + fromLevel} HP`,
      meaning: 'Столько урона держит боец до поражения. Каждая единица END дороже уровня втрое.',
    }
  },

  'character.carry': () => {
    const str = 8
    const fromStr = str * B.character.carryWeightPerStr
    return {
      given: [`STR ${str}`],
      steps: [
        { text: 'база', value: `${B.character.baseCarryWeight} кг` },
        { text: `сила: ${str} × ${B.character.carryWeightPerStr}`, value: `+${fromStr} кг` },
      ],
      result: `${B.character.baseCarryWeight + fromStr} кг`,
      meaning: 'Больше не унести: снаряжение и добыча вместе не должны превышать этот вес.',
    }
  },

  'battle.dodge': () => {
    // №130 (Nobody 16.11): цепочка условий, оберег не главнее ловкости.
    const E = B.edge
    const cases = [
      { text: `ловкость ${ATTACKER.agi} против ${DEFENDER.agi}, обереги равны`, a: { ...ATTACKER }, d: { ...DEFENDER } },
      { text: `ловкость бьющего больше на ${E.statGap}`, a: { ...ATTACKER, agi: DEFENDER.agi + E.statGap }, d: { ...DEFENDER } },
      { text: `то же, но у цели минус-оберег уворота ${E.charmGap * 100 + 50}%`, a: { ...ATTACKER, agi: DEFENDER.agi + E.statGap, dodgeCharmEdge: -(E.charmGap + 0.5) }, d: { ...DEFENDER } },
      { text: `ловкость равна, оберег уворота бьющего +${E.charmGap * 100}%`, a: { ...ATTACKER, dodgeCharmEdge: E.charmGap }, d: { ...DEFENDER } },
      { text: `ловкость цели больше на ${E.statGap}`, a: { ...ATTACKER }, d: { ...DEFENDER, agi: ATTACKER.agi + E.statGap } },
    ]
    return {
      given: ['бьющий и цель из общего примера, точность оружия как у бьющего'],
      steps: cases.map(c => ({ text: c.text, value: `попадание ${pct(1 - calcDodgeChance(c.d, c.a))}` })),
      result: 'перевес ловкости или оберега даёт попадание без рандома',
      meaning: 'Попал без рандома, если оберег уворота перекрыл минус цели на порог ИЛИ ловкость больше на порог. Не прошло ни то, ни другое: дальше крит и удачный сквозь уворот (их минус-обереги больше и агрессия или фарт выше). Иначе уворот.',
    }
  },

  'battle.block': () => {
    const pierce = calcLuckyPierceChance({ luck: ATTACKER.luck }, { luck: DEFENDER.luck })
    const pierceEdge = calcLuckyPierceChance({ luck: DEFENDER.luck + B.edge.statGap }, { luck: DEFENDER.luck })
    return {
      given: [`фарт бьющего ${ATTACKER.luck}`, `фарт цели ${DEFENDER.luck}`],
      steps: [
        { text: 'удар в зону, закрытую одним блоком', value: 'гасится, если удар не удачный' },
        { text: `шанс удачного при фарте ${ATTACKER.luck} против ${DEFENDER.luck}`, value: pct(pierce) },
        { text: `фарт бьющего больше на ${B.edge.statGap}`, value: pct(pierceEdge) },
        { text: 'два блока в одну зону', value: 'держат и удачный' },
        { text: `антифарт блокера: очко = ${pct(B.edge.antiFartPerPoint ?? 0.01)}, не больше ${pct(B.edge.antiFartCap ?? 0.2)}`, value: 'держит удар мимо блока или пробивший блок' },
      ],
      result: `удачный пробивает одиночный блок с шансом ${pct(pierce)}`,
      meaning: 'Блоки выставляет сам игрок, шанса «словить блок» нет. Крит блок не пробивает, только удачный. Блок без ответки гасит удар целиком, с реакцией больше на порог блокер бьёт в ответ.',
    }
  },

  'battle.crit': () => {
    const value = calcCritChance(ATTACKER, DEFENDER)
    const edge = calcCritChance({ ...ATTACKER, agr: DEFENDER.agr + B.edge.statGap }, DEFENDER)
    return {
      given: [`агрессия бьющего ${ATTACKER.agr}`, `агрессия цели ${DEFENDER.agr}`],
      steps: [
        { text: `${B.edge.critMid * 100}% при равенстве, каждый пункт разницы сдвигает шанс`, value: pct(value) },
        { text: `агрессия бьющего больше на ${B.edge.statGap}`, value: pct(edge) },
        { text: 'оберег крита бьющего против оберега крита цели', value: `перевес ${B.edge.charmGap * 100}% решает без рандома` },
        { text: 'сила крита', value: `×${B.crit.multiplierBase}` },
      ],
      result: pct(value),
      meaning: `При крите урон ×${B.crit.multiplierBase}. Крит сквозь уворот ловкача проходит, если минус-оберег крита больше и агрессия выше; блок крит не пробивает.`,
    }
  },

  'battle.damage': () => {
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const effective = calcEffectiveWeaponSkill(ATTACKER.weaponSkillLevel, DEFENDER.antiSkillLevel)
    const mult = calcWeaponSkillMultiplier(effective)
    const raw = roll * mult + ATTACKER.str * B.strike.strCoeff
    return {
      given: [`оружие ${hp(ATTACKER.minDamage)}–${hp(ATTACKER.maxDamage)} HP (берём ${hp(roll)})`,
        `владение ${ATTACKER.weaponSkillLevel}`, `сила ${ATTACKER.str}`],
      steps: [
        { text: `множитель владения при навыке ${effective}`, value: `×${round2(mult)}` },
        { text: `оружие × множитель: ${hp(roll)} × ${round2(mult)}`, value: round2(hp(roll * mult)).toString() },
        { text: `сила: ${ATTACKER.str} × ${hp(B.strike.strCoeff)}`, value: `+${hp(ATTACKER.str * B.strike.strCoeff)} HP` },
      ],
      result: `${round2(hp(raw))} HP до брони`,
      meaning: 'Это ещё не то, что увидит защитник: дальше урон срежет броня.',
    }
  },

  'battle.armor': () => {
    const C = B.strike
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const mult = calcWeaponSkillMultiplier(ATTACKER.weaponSkillLevel)
    const raw = roll * mult + ATTACKER.str * C.strCoeff
    const flat = calcArmorFlat(DEFENDER.armor, DEFENDER.end)
    const left = Math.max(0, hp(raw) - hp(flat))
    const final = attackDamageHp(raw, flat, 1, 1, B.damage.minFinalDamage)
    return {
      given: [`атака до брони ${round2(hp(raw))} HP`, `броня зоны ${hp(DEFENDER.armor)} HP`, `выносливость цели ${DEFENDER.end}`],
      steps: [
        { text: `броня: ${hp(DEFENDER.armor)} + ${hp(C.endArmor)} × ${DEFENDER.end}`, value: String(round2(hp(flat))) },
        { text: `вычитаем из удара: ${round2(hp(raw))} − ${round2(hp(flat))}`, value: String(round2(left)) },
        { text: `разброс ±${pct(C.spread)}`, value: 'взят средний' },
        { text: `мастерство защиты ${C.defenseFullAt * 100}% (за вычетом минус-защиты бьющего)`, value: 'урон в ноль, меньше — пропорционально' },
      ],
      result: `${final} урона по здоровью`,
      meaning: `Очко брони на вещи поглощает ${hp(C.armorPerPoint)} HP до разброса. На красной зоне (третье попадание) броня вещи не действует.`,
    }
  },

  'battle.antimastery': () => {
    const skill = 20, anti = 20
    const effective = calcEffectiveWeaponSkill(skill, anti)
    const withAnti = calcWeaponSkillMultiplier(effective)
    const without = calcWeaponSkillMultiplier(skill)
    return {
      given: [`владение атакующего ${skill}`, `антимастерство защитника ${anti}`],
      steps: [
        { text: `${skill} − ${anti} × ${B.weaponSkill.antiSkillReductionPerLevel}`, value: `эффективный навык ${effective}` },
        { text: 'множитель урона без антимастерства', value: `×${round2(without)}` },
        { text: 'с антимастерством', value: `×${round2(withAnti)}` },
      ],
      result: `урон падает на ${pct(1 - withAnti / without)}`,
      meaning: 'Контр-навык обесценивает владение оружием, но не отменяет его: даже при полном антимастерстве множитель не опускается ниже минимума.',
    }
  },

  'work.salary': () => {
    const base = 100, objectLevel = 3, professionLevel = 4
    const salary = calcFinalSalary(base, objectLevel, professionLevel, 0.5, 1)
    return {
      given: [`оклад объекта ${base} ₽`, `уровень объекта ${objectLevel}`,
        `уровень профессии ${professionLevel}`, 'первая смена за сутки', 'средний бросок'],
      steps: [
        { text: `уровень объекта: 1 + ${B.economy.work.objectLevelStep} × (${objectLevel}−1)`, value: `×${objectLevelCoeff(objectLevel)}` },
        { text: `профессия: 1 + ${professionLevel} × ${B.economy.work.efficiencyPerProfessionLevel}`, value: `×${round2(workerEfficiency(professionLevel))}` },
        { text: 'случайный разброс (взят средний)', value: '×1.0' },
        { text: 'усталость первой смены', value: `×${dailyShiftSalaryCoeff(1)}` },
        { text: `потолок: оклад × ${B.economy.work.salaryCapMultiplier}`, value: `${base * B.economy.work.salaryCapMultiplier} ₽` },
      ],
      result: `${salary} ₽ за смену`,
      meaning: 'Столько получит рабочий. Пятая смена за те же сутки принесёт впятеро меньше — см. усталость.',
    }
  },

  'work.fatigue': () => {
    const base = 100, objectLevel = 3, professionLevel = 4
    const steps = [1, 2, 3, 5].map(number => ({
      text: `смена №${number} (коэффициент ${dailyShiftSalaryCoeff(number)})`,
      value: `${calcFinalSalary(base, objectLevel, professionLevel, 0.5, number)} ₽`,
    }))
    return {
      given: [`оклад ${base} ₽`, `объект ${objectLevel}`, `профессия ${professionLevel}`],
      steps,
      result: `пятая смена дешевле первой в ${Math.round(1 / dailyShiftSalaryCoeff(5))} раз`,
      meaning: 'Так работа перестаёт быть ровным краном денег: выгоднее отработать несколько смен, а не сидеть весь день.',
    }
  },

  'money.market': () => {
    const price = 1000
    const fee = calcListingFee(price)
    const tax = calcSaleTax(price)
    return {
      given: [`цена лота ${price} ₽`],
      steps: [
        { text: 'выставление', value: fee > 0 ? `−${fee} ₽` : 'бесплатно' },
        { text: `налог с продажи: ${price} × ${B.economy.market.saleTaxRate}`, value: `−${tax} ₽` },
        { text: 'продавец получает', value: `${calcSellerPayout(price)} ₽` },
        { text: `сырьё: цена за штуку от затрат × ${B.economy.market.craftPriceMin} до затрат × ${B.economy.market.craftPriceMax}`, value: 'затраты = госцены входов рецепта, у добываемого — госцена' },
      ],
      result: `из ${price} ₽ экономика забирает ${fee + tax} ₽`,
      meaning: 'Дима 16.11: выставлять бесплатно, с продажи 10%. Налог берётся только со сделки.',
    }
  },

  'money.upgrades': () => {
    const priceBase = 2400
    const steps = [1, 2, 3, 4, 5].map(level => ({
      text: `уровень ${level}: цена ${calcUpgradeCost(priceBase, level)} ₽`,
      value: `шанс ${pct(calcUpgradeSuccessChance(level - 1, 0))}`,
    }))
    const total = [1, 2, 3, 4, 5].reduce((sum, level) => sum + calcUpgradeCost(priceBase, level), 0)
    return {
      given: [`вещь за ${priceBase} ₽`, 'профессия 0'],
      steps,
      result: `все пять уровней стоят ${total} ₽ — и это без учёта провалов`,
      meaning: 'Цена растёт степенью, а шанс падает линейно: пятый уровень почти вдвое рискованнее первого при цене в семь раз выше.',
    }
  },

  'money.repair': () => {
    const priceBase = 1000, repairBasePrice = 500, lost = 100
    const perPoint = repairBasePrice / B.repair.baseCostDivider
    const common = calcRepairCost(repairBasePrice, lost, 'COMMON')
    const rare = calcRepairCost(repairBasePrice, lost, 'RARE')
    return {
      given: [`цена вещи ${priceBase} ₽`, `ремонтная база ${repairBasePrice} ₽`, `потеряно ${lost} прочности`],
      steps: [
        { text: `цена пункта прочности = ${repairBasePrice} / ${B.repair.baseCostDivider}`, value: `≈ ${round2(perPoint)} ₽` },
        { text: `обычное качество × ${B.repair.qualityCoeff.COMMON}, округление вверх`, value: `${common} ₽` },
        { text: `редкое качество: ×${B.repair.qualityCoeff.RARE}`, value: `${rare} ₽` },
      ],
      result: `${common}–${rare} ₽ за ремонт`,
      meaning: 'Ремонтная база может отличаться от цены вещи. Качество влияет на стоимость ремонта.',
    }
  },

  'strategy.upkeep': () => {
    const first = territoryUpkeepPerDay(1)
    const second = territoryUpkeepPerDay(2)
    return {
      given: ['бригада держит два района'],
      steps: [
        { text: 'первый район', value: `${first} ₽/сутки` },
        { text: 'второй район', value: `${second} ₽/сутки` },
        { text: 'вместе', value: `${first + second} ₽/сутки` },
        { text: 'в месяц', value: `${(first + second) * 30} ₽` },
      ],
      result: `${first + second} ₽ в сутки за оба района`,
      meaning: `Долг ${B.strategy.territory.upkeepDebtBonusOff} ₽ гасит бонус, ${B.strategy.territory.upkeepDebtRelease} ₽ — отбирает район. То есть расширение упирается в содержание, а не в силу.`,
    }
  },

  'strategy.claim': () => {
    const fee = B.strategy.territory.claimFee
    const cost = B.strategy.authority.claimCost
    const gain = B.strategy.authority.territoryWon
    return {
      given: ['заявка на район и победа в бою'],
      steps: [
        { text: 'взнос из общака (не возвращается)', value: `−${fee} ₽` },
        { text: 'авторитет за заявку', value: `−${cost}` },
        { text: 'авторитет за победу', value: `+${gain}` },
        { text: 'итог по авторитету', value: String(gain - cost) },
      ],
      result: `каждый захват стоит ${cost - gain} авторитета сверх победы`,
      meaning: 'Одними победами город не удержать: авторитет приходится добирать работой и удержанием районов.',
    }
  },
}
