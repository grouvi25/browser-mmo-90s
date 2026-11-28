/**
 * Existing catalog, upgrades, rolls, rating and stored chronicles keep their
 * original units. This conversion is a data boundary, not a combat modifier.
 */
// Дима 27.11: «резку 0,35 убрать, чтобы был полноценный урон». Атака и броня
// игроков теперь переходят в HP один к одному (было 35/100).
const CATALOG_HP_NUMERATOR = 100
const CATALOG_HP_DENOMINATOR = 100

/**
 * 28.11: чтобы бои не стали втрое короче, всё, что раньше измерялось в HP,
 * выросло в 100/35 раза: здоровье, лечение, еда, собаки и помощники, ответка.
 * Числа в справочнике (база здоровья, «+HP» вещей, «лечит» в баре) остаются
 * прежними, в игре они умножаются здесь, в одном месте.
 */
export const HP_SCALE = 100 / 35
export function hpUnits(value: number): number {
  return Math.round(value * HP_SCALE)
}
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

/** Pet and helper attacks arrive in HP (already scaled by HP_SCALE); armor uses the catalog scale. */
export function companionDamageHp(damage: number, armor: number): number {
  if (![damage, armor].every(Number.isFinite)) return 0
  const [net, divisor] = difference(decimal(damage), asCatalogHp(armor))
  return Math.max(0, Number(net / divisor))
}
