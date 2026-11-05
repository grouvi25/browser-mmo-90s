// =============================================================
// Эффекты настоек и свитков (таблица заказчика v2, решения #4229).
//
// Что делает вещь, лежит в её шаблоне (item_templates.use_effect), что сейчас
// действует на персонаже — в characters.active_effects. Настойки считаются
// минутами и работают вне боя, свитки — раундами и только в том бою, где их
// применили: «60 секунд» при ходе до минуты могут кончиться за один ход.
//
// Эффекты на одну и ту же характеристику не складываются, берётся сильнейший:
// иначе настойка, свиток и свиток старше вместе давали бы +50% точности.
// =============================================================

// nextHit — прибавка к следующему попаданию, reflect — доля полученного урона обратно.
export const EFFECT_STATS = ['armor', 'damage', 'accuracy', 'resist', 'crit', 'agi', 'end', 'nextHit', 'reflect'] as const
export type EffectStat = typeof EFFECT_STATS[number]
export type EffectBuff = { stat: EffectStat; value: number }

export interface UseEffect {
  buffs?: EffectBuff[]
  /** Действует столько минут, применяется и вне боя. */
  minutes?: number
  /** Действует столько раундов, применяется только в бою. */
  rounds?: number
  /** Лечит долю от максимума здоровья каждый раунд, в процентах. */
  regenPercent?: number
  /** Прямой урон врагу мимо брони. */
  directDamage?: number
}

export interface ActiveEffect {
  code: string
  name: string
  buffs: EffectBuff[]
  regenPercent?: number
  expiresAt?: string
  battleId?: string
  fromRound?: number
  untilRound?: number
  /** Свиток прорыва: сгорает, как только у бойца стало больше попаданий. */
  hitsAtStart?: number
}

export type BattleMoment = { battleId: string; round: number; hitsLanded?: number }
export type BuffTotals = Record<EffectStat, number>

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Шаблон правят в базе руками, поэтому чужеродное просто не считается эффектом. */
export function parseUseEffect(raw: unknown): UseEffect | null {
  if (!isObject(raw)) return null
  const buffs = Array.isArray(raw.buffs)
    ? raw.buffs.filter((b): b is EffectBuff => isObject(b) && EFFECT_STATS.includes(b.stat as EffectStat) && typeof b.value === 'number')
    : []
  const positive = (value: unknown) => (typeof value === 'number' && value > 0 ? value : undefined)
  const effect: UseEffect = {
    ...(buffs.length ? { buffs } : {}),
    ...(positive(raw.minutes) ? { minutes: positive(raw.minutes) } : {}),
    ...(positive(raw.rounds) ? { rounds: positive(raw.rounds) } : {}),
    ...(positive(raw.regenPercent) ? { regenPercent: positive(raw.regenPercent) } : {}),
    ...(positive(raw.directDamage) ? { directDamage: positive(raw.directDamage) } : {}),
  }
  const lasting = !!(effect.buffs || effect.regenPercent) && !!(effect.minutes || effect.rounds)
  return lasting || effect.directDamage ? effect : null
}

export function parseActiveEffects(raw: unknown): ActiveEffect[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is ActiveEffect => isObject(e) && typeof e.code === 'string' && Array.isArray(e.buffs))
}

/** Что действует сейчас. Без момента боя раундовые эффекты не считаются. */
export function liveEffects(effects: readonly ActiveEffect[], now: Date, battle?: BattleMoment): ActiveEffect[] {
  return effects.filter(effect => {
    if (effect.expiresAt) return new Date(effect.expiresAt).getTime() > now.getTime()
    if (!battle || effect.battleId !== battle.battleId || (effect.untilRound ?? 0) < battle.round) return false
    return effect.hitsAtStart === undefined || (battle.hitsLanded ?? 0) <= effect.hitsAtStart
  })
}

/** Записать применённое. Такой же эффект заменяется и начинается заново. */
export function withAppliedEffect(
  effects: readonly ActiveEffect[],
  item: { code: string; name: string },
  effect: UseEffect,
  now: Date,
  battle?: BattleMoment,
): ActiveEffect[] {
  const kept = liveEffects(effects, now, battle).filter(active => active.code !== item.code)
  if (!effect.buffs?.length && !effect.regenPercent) return kept
  const base = { code: item.code, name: item.name, buffs: effect.buffs ?? [], ...(effect.regenPercent ? { regenPercent: effect.regenPercent } : {}) }
  if (effect.minutes) return [...kept, { ...base, expiresAt: new Date(now.getTime() + effect.minutes * 60_000).toISOString() }]
  if (effect.rounds && battle) {
    const once = base.buffs.some(buff => buff.stat === 'nextHit') ? { hitsAtStart: battle.hitsLanded ?? 0 } : {}
    return [...kept, { ...base, ...once, battleId: battle.battleId, fromRound: battle.round, untilRound: battle.round + effect.rounds - 1 }]
  }
  return kept
}

export function buffTotals(effects: readonly ActiveEffect[]): BuffTotals {
  const totals: BuffTotals = { armor: 0, damage: 0, accuracy: 0, resist: 0, crit: 0, agi: 0, end: 0, nextHit: 0, reflect: 0 }
  for (const effect of effects) {
    for (const buff of effect.buffs) totals[buff.stat] = Math.max(totals[buff.stat], buff.value)
  }
  return totals
}

/** Ловкость и выносливость идут прямо в характеристики бойца. */
export function withEffectStats<T extends { agi: number; end: number }>(stats: T, buffs: BuffTotals): T {
  return { ...stats, agi: stats.agi + buffs.agi, end: stats.end + buffs.end }
}

/** Сколько лечит этот раунд. В раунд применения лечение уже было. */
export function regenPercentAt(effects: readonly ActiveEffect[], round: number): number {
  return effects.reduce((sum, effect) => sum + (effect.regenPercent && round > (effect.fromRound ?? round) ? effect.regenPercent : 0), 0)
}

const BUFF_TEXT: Record<EffectStat, (value: number) => string> = {
  armor: v => `броня +${Math.round(v * 100)}%`,
  damage: v => `урон +${Math.round(v * 100)}%`,
  accuracy: v => `точность +${Math.round(v * 100)}%`,
  resist: v => `сопротивление урону +${Math.round(v * 100)}%`,
  crit: v => `шанс крита +${Math.round(v * 100)}%`,
  agi: v => `ловкость +${v}`,
  end: v => `выносливость +${v}`,
  nextHit: v => `следующий удар +${Math.round(v * 100)}%`,
  reflect: v => `отражает ${Math.round(v * 100)}% урона`,
}

const roundsWord = (count: number) => {
  const tens = count % 100, ones = count % 10
  if (tens >= 11 && tens <= 14) return `${count} раундов`
  if (ones === 1) return `${count} раунд`
  if (ones >= 2 && ones <= 4) return `${count} раунда`
  return `${count} раундов`
}

/** Для журнала боя и ответа сервера. Тот же текст на экране вещи (api.types). */
export function effectText(effect: UseEffect): string {
  const parts = [
    ...(effect.buffs ?? []).map(buff => BUFF_TEXT[buff.stat](buff.value)),
    ...(effect.regenPercent ? [`здоровье +${effect.regenPercent}% за раунд`] : []),
    ...(effect.directDamage ? [`${effect.directDamage} урона врагу мимо брони`] : []),
  ]
  const time = effect.minutes ? `на ${effect.minutes} мин` : effect.rounds ? `на ${roundsWord(effect.rounds)}` : ''
  return [parts.join(', '), time].filter(Boolean).join(' ')
}
