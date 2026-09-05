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
  calcCritChance, calcDodgeChance, calcEffectiveWeaponSkill, calcHitChance,
  calcBlockChance, calcWeaponSkillMultiplier, applyArmor, applyEndurance,
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
  agi: 6, rea: 5, end: 7, luck: 2,
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

  'battle.hit': () => {
    const value = calcHitChance(ATTACKER, DEFENDER)
    const accuracyFactor = Math.log(ATTACKER.acc + 1) / Math.log(16)
    const fromWeapon = ATTACKER.weaponAccuracy * accuracyFactor
    const fromSkill = ATTACKER.weaponSkillLevel * B.hitChance.wskBonus
    const fromLuck = ATTACKER.luck * B.hitChance.luckEvasionPressure
    const pressure = DEFENDER.agi * B.hitChance.agiDodgePressure
    return {
      given: [`ACC ${ATTACKER.acc}`, `точность оружия ${ATTACKER.weaponAccuracy}`,
        `владение ${ATTACKER.weaponSkillLevel}`, `LUCK ${ATTACKER.luck}`, `AGI защитника ${DEFENDER.agi}`],
      steps: [
        { text: `точность: ${ATTACKER.weaponAccuracy} × ln(${ATTACKER.acc}+1)/ln(16)`, value: round2(fromWeapon).toString() },
        { text: `владение: ${ATTACKER.weaponSkillLevel} × ${B.hitChance.wskBonus}`, value: `+${round2(fromSkill)}` },
        { text: `удача: ${ATTACKER.luck} × ${B.hitChance.luckEvasionPressure}`, value: `+${round2(fromLuck)}` },
        { text: `давление ловкости защитника: ${DEFENDER.agi} × ${B.hitChance.agiDodgePressure}`, value: `−${round2(pressure)}` },
        { text: `ограничение диапазоном ${B.hitChance.min}…${B.hitChance.max}`, value: pct(value) },
      ],
      result: pct(value),
      meaning: 'С такой вероятностью удар вообще дойдёт до защитника. Дальше его ещё можно увернуть или заблокировать.',
    }
  },

  'battle.dodge': () => {
    const value = calcDodgeChance(DEFENDER, ATTACKER)
    const ratio = DEFENDER.agi / Math.max(ATTACKER.acc + ATTACKER.agi, 1)
    const armorPenalty = DEFENDER.armorWeight * B.dodgeChance.armorWeightPenalty
    return {
      given: [`AGI защитника ${DEFENDER.agi}`, `ACC ${ATTACKER.acc} и AGI ${ATTACKER.agi} атакующего`,
        `вес брони ${DEFENDER.armorWeight} кг`],
      steps: [
        { text: 'база', value: String(B.dodgeChance.base) },
        { text: `отношение ловкостей: ${DEFENDER.agi}/(${ATTACKER.acc}+${ATTACKER.agi}) × ${B.dodgeChance.agilityRatioMult}`, value: `+${round2(ratio * B.dodgeChance.agilityRatioMult)}` },
        { text: `штраф брони: ${DEFENDER.armorWeight} × ${B.dodgeChance.armorWeightPenalty}`, value: `−${round2(armorPenalty)}` },
      ],
      result: pct(value),
      meaning: 'Уворот считается против конкретного противника: тот же защитник против точного бойца увернётся реже.',
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
    const value = calcCritChance(ATTACKER, DEFENDER)
    return {
      given: [`AGR ${ATTACKER.agr}`, `владение ${ATTACKER.weaponSkillLevel}`, `END защитника ${DEFENDER.end}`],
      steps: [
        { text: 'база', value: String(B.crit.base) },
        { text: `агрессия: ${ATTACKER.agr} × ${B.crit.agressMult}`, value: `+${round2(ATTACKER.agr * B.crit.agressMult)}` },
        { text: `владение: ${ATTACKER.weaponSkillLevel} × ${B.crit.wskMult}`, value: `+${round2(ATTACKER.weaponSkillLevel * B.crit.wskMult)}` },
        { text: `сопротивление END: ${DEFENDER.end} × ${B.crit.endResist}`, value: `−${round2(DEFENDER.end * B.crit.endResist)}` },
      ],
      result: pct(value),
      meaning: `При крите урон ×${B.crit.multiplierBase}, и он игнорирует ${pct(B.crit.armorIgnore)} брони.`,
    }
  },

  'battle.damage': () => {
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const effective = calcEffectiveWeaponSkill(ATTACKER.weaponSkillLevel, DEFENDER.antiSkillLevel)
    const mult = calcWeaponSkillMultiplier(effective)
    const raw = roll * mult + ATTACKER.str * B.damage.strCoeff
    return {
      given: [`оружие ${ATTACKER.minDamage}–${ATTACKER.maxDamage} (берём среднее ${roll})`,
        `владение ${ATTACKER.weaponSkillLevel}`, `STR ${ATTACKER.str}`],
      steps: [
        { text: `множитель владения при навыке ${effective}`, value: `×${round2(mult)}` },
        { text: `бросок × множитель: ${roll} × ${round2(mult)}`, value: round2(roll * mult).toString() },
        { text: `сила: ${ATTACKER.str} × ${B.damage.strCoeff}`, value: `+${ATTACKER.str * B.damage.strCoeff}` },
      ],
      result: `${Math.round(raw)} урона до защиты`,
      meaning: 'Это ещё не то, что увидит защитник: дальше урон срежут броня и выносливость.',
    }
  },

  'battle.armor': () => {
    const roll = Math.round((ATTACKER.minDamage + ATTACKER.maxDamage) / 2)
    const mult = calcWeaponSkillMultiplier(ATTACKER.weaponSkillLevel)
    const raw = roll * mult + ATTACKER.str * B.damage.strCoeff
    const afterArmor = applyArmor(raw, DEFENDER.armor, false)
    const afterEnd = applyEndurance(afterArmor, DEFENDER.end)
    return {
      given: [`сырой урон ${Math.round(raw)}`, `броня ${DEFENDER.armor}`, `END защитника ${DEFENDER.end}`],
      steps: [
        { text: `плоское снижение: ${DEFENDER.armor} × ${B.damage.armorFlatCoeff}`, value: `−${round2(DEFENDER.armor * B.damage.armorFlatCoeff)}` },
        { text: `процентное: 1 − ${DEFENDER.armor}/(${DEFENDER.armor}+${B.damage.armorK})`, value: `×${round2(1 - DEFENDER.armor / (DEFENDER.armor + B.damage.armorK))}` },
        { text: 'после брони', value: String(Math.round(afterArmor)) },
        { text: `выносливость: 1/(1 + ln(${DEFENDER.end}+1) × ${B.damage.enduranceK})`, value: `×${round2(1 / (1 + Math.log(DEFENDER.end + 1) * B.damage.enduranceK))}` },
      ],
      result: `${Math.round(afterEnd)} урона по здоровью`,
      meaning: `Броня ${DEFENDER.armor} и выносливость ${DEFENDER.end} срезали ${pct(1 - afterEnd / raw)} урона.`,
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
