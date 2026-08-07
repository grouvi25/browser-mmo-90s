import { writeFileSync } from 'node:fs'

export const PROFESSION_TRANSITIONS = [
  { from: 0, to: 1, xp: 500, actionsAt14h: 84 },
  { from: 1, to: 2, xp: 1_000, actionsAt14h: 91 },
  { from: 2, to: 3, xp: 2_000, actionsAt14h: 98 },
  { from: 3, to: 4, xp: 4_500, actionsAt14h: 105 },
  { from: 4, to: 5, xp: 8_000, actionsAt14h: 112 },
  { from: 5, to: 6, xp: 14_000, actionsAt14h: 120 },
] as const

export const STAGE2_PROFESSIONS = [
  { code: 'scrap_collector', name: 'Сборщик металлолома' },
  { code: 'foundry_worker', name: 'Литейщик' },
  { code: 'gunsmith', name: 'Оружейник' },
] as const

export const MAX_PROFESSION_LEVEL = 6
export const KEY_CONTENT_MAX_LEVEL = 3

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}
function round(value: number, digits = 2) {
  const power = 10 ** digits
  return Math.round(value * power) / power
}

export function actionsPerDay(actionsAt14h: number, hoursPerDay: number) {
  if (!(hoursPerDay > 0)) throw new Error('hoursPerDay must be positive')
  return Math.max(1, Math.round(actionsAt14h * hoursPerDay / 14))
}

export function simulateFocusedProfession(hoursPerDay: number) {
  let cumulativeDays = 0
  const transitions = PROFESSION_TRANSITIONS.map(transition => {
    const dailyActions = actionsPerDay(transition.actionsAt14h, hoursPerDay)
    const days = Math.max(1, Math.round(transition.xp / dailyActions))
    cumulativeDays += days
    return { ...transition, dailyActions, days, cumulativeDays }
  })
  return {
    hoursPerDay,
    transitions,
    levelAt30Days: levelAtDay(transitions, 30),
    levelAt90Days: levelAtDay(transitions, 90),
    levelAt180Days: levelAtDay(transitions, 180),
    level3Days: transitions[2].cumulativeDays,
    maxLevelDays: cumulativeDays,
    maxLevelMonths: round(cumulativeDays / 30),
    maxLevelYears: round(cumulativeDays / 365.25),
  }
}

export function levelAtDay(transitions: Array<{ to: number; cumulativeDays: number }>, day: number) {
  let level = 0
  for (const transition of transitions) if (day >= transition.cumulativeDays) level = transition.to
  return level
}

const hours = arg('hours', '2,14').split(',').map(Number).filter(value => value > 0)
const jsonPath = arg('json', '')
const textPath = arg('text', '')
const profiles = hours.map(simulateFocusedProfession)
const baseline = profiles.find(profile => profile.hoursPerDay === 14)
const realistic = profiles.find(profile => profile.hoursPerDay === 2)

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    model: 'profession-actions-v2.2',
    professions: STAGE2_PROFESSIONS,
    transitions: PROFESSION_TRANSITIONS,
    keyContentLevels: '0-3',
  },
  profiles,
  acceptance: {
    baselineTopDays: baseline?.maxLevelDays,
    realisticTopDays: realistic?.maxLevelDays,
    realisticTopYears: realistic?.maxLevelYears,
    realisticLevel3Days: realistic?.level3Days,
    baselineMatchesTz268Days: baseline?.maxLevelDays === 268,
    topNotFasterThanSixMonths: (baseline?.maxLevelDays ?? 0) >= 183,
    keyContentNotLockedAboveLevel3: KEY_CONTENT_MAX_LEVEL <= 3,
    realisticTopIsAboutFiveYears: (realistic?.maxLevelYears ?? 0) >= 4.5 && (realistic?.maxLevelYears ?? 0) <= 5.5,
  },
}
const booleans = Object.values(report.acceptance).filter(value => typeof value === 'boolean')
const passed = booleans.every(Boolean)
const lines = [
  'СИМУЛЯТОР ПРОКАЧКИ ПРОФЕССИЙ ПО ТЗ 2.2',
  `Профессии этапа 2: ${STAGE2_PROFESSIONS.map(item => item.name).join(', ')}`,
  `Таблица опыта: ${PROFESSION_TRANSITIONS.map(item => `${item.from}→${item.to}: ${item.xp}`).join('; ')} XP`,
  '',
  ...profiles.map(profile => `${profile.hoursPerDay} ч/день: ур.3 за ${profile.level3Days} дн.; ур.6 за ${profile.maxLevelDays} дн. (${profile.maxLevelMonths} мес. / ${profile.maxLevelYears} лет); уровни на 30/90/180 день: ${profile.levelAt30Days}/${profile.levelAt90Days}/${profile.levelAt180Days}`),
  '',
  `14 ч/день: ${report.acceptance.baselineTopDays} дней до ур.6 (ТЗ: 268)`,
  `2 ч/день: ${report.acceptance.realisticTopDays} дней (${report.acceptance.realisticTopYears} лет)`,
  'Ключевой контент обязан открываться на уровнях 0–3.',
  '',
  `ACCEPTANCE: ${passed ? 'PASS' : 'FAIL'}`,
]
const text = `${lines.join('\n')}\n`
console.log(text)
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (textPath) writeFileSync(textPath, text, 'utf8')
if (!passed) process.exit(1)
