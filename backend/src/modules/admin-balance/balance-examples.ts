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
import {
  calcCritChance, calcDodgeChance, calcEffectiveWeaponSkill,
  calcBlockChance, calcWeaponSkillMultiplier, calcArmorShare,
} from '../battles/battle.formulas'
import { calcFinalSalary, dailyShiftSalaryCoeff, objectLevelCoeff, workerEfficiency } from '../work/work.formulas'
import { calcUpgradeCost, calcUpgradeSuccessChance } from '../upgrades/upgrades.formulas'
import { calcListingFee, calcSaleTax, calcSellerPayout } from '../market/market.formulas'
import { territoryUpkeepPerDay } from '../territories/territories.formulas'

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
    const C = B.strike
    const value = calcDodgeChance(DEFENDER, ATTACKER)
    const edge = (DEFENDER.agi - ATTACKER.acc) / (DEFENDER.agi + ATTACKER.acc + C.statSoftener)
    const accuracy = ATTACKER.weaponAccuracy - C.baseWeaponAccuracy
    return {
      given: [`ловкость защитника ${DEFENDER.agi}`, `меткость атакующего ${ATTACKER.acc}`,
        `точность оружия ${ATTACKER.weaponAccuracy}`],
      steps: [
        { text: 'база', value: String(C.dodgeBase) },
        { text: `${C.dodgeSpread} × (${DEFENDER.agi} − ${ATTACKER.acc})/(${DEFENDER.agi} + ${ATTACKER.acc} + ${C.statSoftener})`, value: `${edge >= 0 ? '+' : '−'}${round2(Math.abs(C.dodgeSpread * edge))}` },
        { text: `точность оружия сверх ${C.baseWeaponAccuracy}`, value: `−${round2(accuracy)}` },
        { text: `ограничение ${C.dodgeMin}…${C.dodgeMax}`, value: pct(value) },
      ],
      result: pct(value),
      meaning: 'С такой вероятностью защитник увернётся, и урона не будет вовсе. Ловкость защитника против меткости атакующего.',
    }
  },

  'battle.block': () => {
    const value = calcBlockChance(DEFENDER, ATTACKER)
    const ratio = DEFENDER.rea / Math.max(ATTACKER.rea + DEFENDER.rea, 1)
    return {
      given: [`REA защитника ${DEFENDER.rea}`, `REA атакующего ${ATTACKER.rea}`],
      steps: [
        { text: 'база', value: String(B.blockChance.base) },
        { text: `отношение реакций: ${DEFENDER.rea}/(${ATTACKER.rea}+${DEFENDER.rea}) × ${B.blockChance.reactionRatioMult}`, value: `+${round2(ratio * B.blockChance.reactionRatioMult)}` },
        { text: 'успешный блок пропускает', value: pct(B.blockChance.blockReduction) },
      ],
      result: pct(value),
      meaning: `Блок не отменяет удар: сквозь него проходит ${pct(B.blockChance.blockReduction)} урона.`,
    }
  },

  'battle.crit': () => {
    const C = B.strike
    const value = calcCritChance(ATTACKER, DEFENDER)
    const edge = (ATTACKER.agr - DEFENDER.agr) / (ATTACKER.agr + DEFENDER.agr + C.statSoftener)
    return {
      given: [`агрессия атакующего ${ATTACKER.agr}`, `агрессия защитника ${DEFENDER.agr}`],
      steps: [
        { text: 'база', value: String(C.critBase) },
        { text: `${C.critSpread} × (${ATTACKER.agr} − ${DEFENDER.agr})/(${ATTACKER.agr} + ${DEFENDER.agr} + ${C.statSoftener})`, value: `${edge >= 0 ? '+' : '−'}${round2(Math.abs(C.critSpread * edge))}` },
        { text: `ограничение ${C.critMin}…${C.critMax}`, value: pct(value) },
      ],
      result: pct(value),
      meaning: `При крите урон ×${B.crit.multiplierBase}.`,
    }
  },

  'battle.damage': () => {
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const effective = calcEffectiveWeaponSkill(ATTACKER.weaponSkillLevel, DEFENDER.antiSkillLevel)
    const mult = calcWeaponSkillMultiplier(effective)
    const raw = roll * mult + ATTACKER.str * B.strike.strCoeff
    return {
      given: [`оружие ${ATTACKER.minDamage}–${ATTACKER.maxDamage} (берём среднее ${roll})`,
        `владение ${ATTACKER.weaponSkillLevel}`, `сила ${ATTACKER.str}`],
      steps: [
        { text: `множитель владения при навыке ${effective}`, value: `×${round2(mult)}` },
        { text: `оружие × множитель: ${roll} × ${round2(mult)}`, value: round2(roll * mult).toString() },
        { text: `сила: ${ATTACKER.str} × ${B.strike.strCoeff}`, value: `+${ATTACKER.str * B.strike.strCoeff}` },
      ],
      result: `${Math.round(raw)} урона до брони`,
      meaning: 'Это ещё не то, что увидит защитник: дальше урон срежет броня.',
    }
  },

  'battle.armor': () => {
    const C = B.strike
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const mult = calcWeaponSkillMultiplier(ATTACKER.weaponSkillLevel)
    const raw = roll * mult + ATTACKER.str * C.strCoeff
    const share = calcArmorShare(DEFENDER.armor, DEFENDER.end, DEFENDER.level)
    const k = C.armorK * Math.pow(C.armorKGrowth, DEFENDER.level - 1)
    const total = DEFENDER.armor + C.endArmor * DEFENDER.end
    return {
      given: [`урон до брони ${Math.round(raw)}`, `броня зоны ${DEFENDER.armor}`, `выносливость защитника ${DEFENDER.end}`, `уровень защитника ${DEFENDER.level}`],
      steps: [
        { text: `броня: ${DEFENDER.armor} + ${C.endArmor} × ${DEFENDER.end}`, value: String(round2(total)) },
        { text: `вес брони: ${C.armorK} × ${C.armorKGrowth}^(${DEFENDER.level} − 1)`, value: String(round2(k)) },
        { text: `проходит: ${round2(k)}/(${round2(k)} + ${round2(total)})`, value: `×${round2(share)}` },
        { text: `разброс ±${pct(C.spread)}`, value: 'взят средний' },
      ],
      result: `${Math.floor(raw * share)} урона по здоровью`,
      meaning: `Броня ${DEFENDER.armor} и выносливость ${DEFENDER.end} срезали ${pct(1 - share)} урона. На уровень выше та же броня держит слабее.`,
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
        { text: `комиссия за выставление: ${price} × ${B.economy.market.listingFeeRate}`, value: `−${fee} ₽` },
        { text: `налог с продажи: ${price} × ${B.economy.market.saleTaxRate}`, value: `−${tax} ₽` },
        { text: 'продавец получает', value: `${calcSellerPayout(price)} ₽` },
      ],
      result: `из ${price} ₽ экономика забирает ${fee + tax} ₽`,
      meaning: 'Комиссия сгорает даже если лот не продан — это плата за место на рынке, а не за сделку.',
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
    const priceBase = 2400, lost = 40
    const perPoint = priceBase / B.repair.baseCostDivider
    const common = Math.round(perPoint * lost * B.repair.qualityCoeff.COMMON)
    const rare = Math.round(perPoint * lost * B.repair.qualityCoeff.RARE)
    return {
      given: [`вещь за ${priceBase} ₽`, `потеряно ${lost} прочности`],
      steps: [
        { text: `цена единицы прочности: ${priceBase} / ${B.repair.baseCostDivider}`, value: `${round2(perPoint)} ₽` },
        { text: `обычное качество: ${lost} × ${round2(perPoint)} × ${B.repair.qualityCoeff.COMMON}`, value: `${common} ₽` },
        { text: `редкое качество: ×${B.repair.qualityCoeff.RARE}`, value: `${rare} ₽` },
      ],
      result: `${common}–${rare} ₽ за ремонт`,
      meaning: 'Редкая вещь и чинится дороже: качество умножает не только пользу, но и содержание.',
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
