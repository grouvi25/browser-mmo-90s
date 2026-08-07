import { writeFileSync } from 'node:fs'

export const PROFESSION_LEVEL_HOURS = [0, 20, 60, 120, 240, 480, 800, 1250, 1900, 2750, 3752] as const
export const PROFESSION_LEVEL_XP = PROFESSION_LEVEL_HOURS.map(hours => hours * 100)
export const MAX_PROFESSION_LEVEL = PROFESSION_LEVEL_HOURS.length - 1
export const KEY_CONTENT_LEVEL = 3

export type Profession = {
  code: string
  name: string
  objectCode: string
  shiftMinutes: number
}

export const PROFESSIONS: Profession[] = [
  { code: 'warehouse_worker', name: 'Складской рабочий', objectCode: 'obj_warehouse_station', shiftMinutes: 30 },
  { code: 'scrap_collector', name: 'Сборщик металлолома', objectCode: 'obj_scrapyard', shiftMinutes: 30 },
  { code: 'market_loader', name: 'Грузчик', objectCode: 'obj_market_loader', shiftMinutes: 45 },
  { code: 'mechanic', name: 'Механик', objectCode: 'obj_garage_workshop', shiftMinutes: 60 },
  { code: 'factory_worker', name: 'Рабочий завода', objectCode: 'obj_small_factory', shiftMinutes: 60 },
  { code: 'gunsmith', name: 'Оружейник', objectCode: 'obj_parts_factory', shiftMinutes: 90 },
]

type Scenario = {
  key: string
  title: string
  hoursPerDay: number
  focus: 'single' | 'balanced'
}

type Milestone = { level: number; hours: number; days: number; months: number; years: number }
type ScenarioResult = Scenario & {
  effectiveHoursPerProfessionPerDay: number
  milestones: Milestone[]
  keyContentDays: number
  maxLevelDays: number
  verdicts: { topSixToEightMonths: boolean; keyContentWithinTwoMonths: boolean }
}

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function round(value: number, digits = 2) {
  const power = 10 ** digits
  return Math.round(value * power) / power
}

export function daysForHours(targetHours: number, hoursPerDay: number, professionCount = 1) {
  if (!(targetHours >= 0) || !(hoursPerDay > 0) || !(professionCount >= 1)) throw new Error('Invalid progression inputs')
  return Math.ceil(targetHours / (hoursPerDay / professionCount))
}

export function simulateScenario(scenario: Scenario): ScenarioResult {
  const professionCount = scenario.focus === 'balanced' ? PROFESSIONS.length : 1
  const effectiveHours = scenario.hoursPerDay / professionCount
  const milestones = PROFESSION_LEVEL_HOURS.map((hours, level) => {
    const days = daysForHours(hours, scenario.hoursPerDay, professionCount)
    return { level, hours, days, months: round(days / 30.4375), years: round(days / 365.25) }
  })
  const keyContentDays = milestones[KEY_CONTENT_LEVEL].days
  const maxLevelDays = milestones[MAX_PROFESSION_LEVEL].days
  return {
    ...scenario,
    effectiveHoursPerProfessionPerDay: round(effectiveHours, 4),
    milestones,
    keyContentDays,
    maxLevelDays,
    verdicts: {
      topSixToEightMonths: scenario.focus === 'single' && scenario.hoursPerDay === 14
        ? maxLevelDays >= 183 && maxLevelDays <= 274
        : true,
      keyContentWithinTwoMonths: scenario.focus === 'single' && scenario.hoursPerDay === 2
        ? keyContentDays <= 61
        : true,
    },
  }
}

const hoursList = arg('hours', '2,4,8,14').split(',').map(Number).filter(value => value > 0)
const jsonPath = arg('json', '')
const textPath = arg('text', '')
const includeBalanced = !process.argv.includes('--single-only')

const scenarios: Scenario[] = hoursList.flatMap(hoursPerDay => [
  { key: `single-${hoursPerDay}h`, title: `Одна профессия, ${hoursPerDay} ч/день`, hoursPerDay, focus: 'single' as const },
  ...(includeBalanced ? [{ key: `balanced-${hoursPerDay}h`, title: `Все профессии поровну, ${hoursPerDay} ч/день`, hoursPerDay, focus: 'balanced' as const }] : []),
])
const results = scenarios.map(simulateScenario)
const baseline = results.find(result => result.key === 'single-14h')
const realistic = results.find(result => result.key === 'single-2h')

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    model: 'profession-hours-v1',
    xpPerActiveHour: 100,
    professions: PROFESSIONS,
    levelHours: PROFESSION_LEVEL_HOURS,
    levelXp: PROFESSION_LEVEL_XP,
    keyContentLevel: KEY_CONTENT_LEVEL,
  },
  results,
  acceptance: {
    baselineTopDays: baseline?.maxLevelDays,
    realisticTopDays: realistic?.maxLevelDays,
    realisticTopYears: realistic?.milestones[MAX_PROFESSION_LEVEL].years,
    realisticKeyContentDays: realistic?.keyContentDays,
    expectedBaselineDays: 268,
    baselineMatches: baseline?.maxLevelDays === 268,
    topNotFasterThanSixMonths: (baseline?.maxLevelDays ?? 0) >= 183,
    topNotSlowerThanNineMonths: (baseline?.maxLevelDays ?? Infinity) <= 274,
    keyContentByLevelThree: KEY_CONTENT_LEVEL <= 3,
    keyContentWithinTwoMonthsAtTwoHours: (realistic?.keyContentDays ?? Infinity) <= 61,
  },
}

const lines = [
  'СИМУЛЯТОР ПРОКАЧКИ ПРОФЕССИЙ',
  `Модель: отдельный уровень каждой профессии, ${report.meta.xpPerActiveHour} XP за активный час`,
  `Порог топа: ${PROFESSION_LEVEL_HOURS[MAX_PROFESSION_LEVEL]} часов`,
  '',
  ...results.map(result => {
    const l3 = result.milestones[KEY_CONTENT_LEVEL]
    const top = result.milestones[MAX_PROFESSION_LEVEL]
    return `${result.title}: ур.3 = ${l3.days} дн. (${l3.months} мес.), ур.10 = ${top.days} дн. (${top.months} мес. / ${top.years} лет)`
  }),
  '',
  `14 ч/день, одна профессия: ${report.acceptance.baselineTopDays} дней (ожидалось 268)`,
  `2 ч/день, одна профессия: ${report.acceptance.realisticTopDays} дней (${report.acceptance.realisticTopYears} лет)`,
  `Ключевой контент на ур.3 при 2 ч/день: ${report.acceptance.realisticKeyContentDays} дней`,
  '',
  `ACCEPTANCE: ${Object.values(report.acceptance).filter(value => typeof value === 'boolean').every(Boolean) ? 'PASS' : 'FAIL'}`,
]

const text = `${lines.join('\n')}\n`
console.log(text)
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (textPath) writeFileSync(textPath, text, 'utf8')

if (!Object.values(report.acceptance).filter(value => typeof value === 'boolean').every(Boolean)) process.exit(1)
