/**
 * Existing catalog, upgrades, rolls, rating and stored chronicles keep their
 * original units. This conversion is a data boundary, not a combat modifier.
 */
// Дима 27.11: «резку 0,35 убрать, чтобы был полноценный урон». Атака и броня
// игроков теперь переходят в HP один к одному (было 35/100).
const CATALOG_HP_NUMERATOR = 100
const CATALOG_HP_DENOMINATOR = 100
// Урон собак и помощников и раньше был в HP, против него броня шла по 0,35.
// Оставляем так, иначе броня резала бы их втрое сильнее прежнего.
const COMPANION_ARMOR_NUMERATOR = 35n
const COMPANION_ARMOR_DENOMINATOR = 100n
type Fraction = readonly [bigint, bigint]

export function catalogPointsToHp(points: number): number {
  return points * CATALOG_HP_NUMERATOR / CATALOG_HP_DENOMINATOR
}

function decimal(value: number): Fraction {
  const [mantissa, exponent = '0'] = value.toString().split('e')
  const [whole, tail = ''] = mantissa.split('.')
  const places = tail.length - Number(exponent)
  const coefficient = BigInt(whole + tail)
  return places < 0
    ? [coefficient * 10n ** BigInt(-places), 1n]
    : [coefficient, 10n ** BigInt(places)]
}

function asCatalogHp(points: number): Fraction {
  const [n, d] = decimal(points)
  return [n * BigInt(CATALOG_HP_NUMERATOR), d * BigInt(CATALOG_HP_DENOMINATOR)]
}

function difference(left: Fraction, right: Fraction): Fraction {
  return [left[0] * right[1] - right[0] * left[1], left[1] * right[1]]
}

/** HP lost by the target. Only the final positive HP result is rounded down. */
export function attackDamageHp(attack: number, armor: number, spread: number, defense: number, minimum: number): number {
  if (attack <= armor || spread <= 0 || defense <= 0) return 0
  if (![attack, armor, spread, defense].every(Number.isFinite)) return 0
  const [net, divisor] = difference(asCatalogHp(attack), asCatalogHp(armor))
  const [spreadN, spreadD] = decimal(spread)
  const [defenseN, defenseD] = decimal(defense)
  return Math.max(minimum, Number(net * spreadN * defenseN / (divisor * spreadD * defenseD)))
}

/** Pet and helper attacks already arrive in HP. Only target armor uses the catalog scale. */
export function companionDamageHp(damage: number, armor: number): number {
  if (![damage, armor].every(Number.isFinite)) return 0
  const [armorN, armorD] = decimal(armor)
  const [net, divisor] = difference(decimal(damage), [armorN * COMPANION_ARMOR_NUMERATOR, armorD * COMPANION_ARMOR_DENOMINATOR])
  return Math.max(0, Number(net / divisor))
}
