/**
 * Вкладка «Метрика» в админке (пользователь 18.11): кто, откуда и как пришёл в игру,
 * что сделал и вернулся ли. Источник при регистрации — acquisition.ts, дни в игре —
 * user_active_days, остальное из боёв, смен и платежей.
 */
import { prisma } from '../../shared/db/prisma'
import { moscowDay, sourceLabel, TRACKING_SINCE } from './acquisition'

const DAY_MS = 86_400_000

interface CohortRow {
  id: string
  registered_at: Date
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  first_referrer: string | null
  landing_path: string | null
  last_user_agent: string | null
  referrer_nick: string | null
  character_id: string | null
  nickname: string | null
  battle_level: number | null
  last_active_at: Date | null
  battles: number
  shifts: number
  paid_kopecks: number
  days: string[] | null
}

/** Откуда сейчас играет: по последнему входу. */
export function platformOf(userAgent: string | null): string {
  const ua = userAgent ?? ''
  if (!ua) return 'нет данных'
  if (/KooperativDesktop/i.test(ua)) return 'Программа для ПК'
  if (/KooperativApp|; wv\)/i.test(ua)) return 'Android-приложение'
  if (/iPhone|iPad|Android|Mobile/i.test(ua)) return 'Телефон, браузер'
  return 'Компьютер, браузер'
}

const pct = (part: number, base: number) => (base ? Math.round((part / base) * 1000) / 10 : null)

function countBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, number>()
  for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + 1)
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

export async function metricsReport(days = 30, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS)
  const today = moscowDay(now)
  const firstDay = moscowDay(since)

  const cohort = await prisma.$queryRaw<CohortRow[]>`
    SELECT u.id, u.registered_at, u.utm_source, u.utm_medium, u.utm_campaign, u.utm_content,
           u.first_referrer, u.landing_path, u.last_user_agent, rc.nickname AS referrer_nick,
           c.id AS character_id, c.nickname, c.battle_level, c.last_active_at,
           (SELECT count(*)::int FROM battle_participants p WHERE p.character_id = c.id) AS battles,
           (SELECT count(*)::int FROM work_shifts w WHERE w.character_id = c.id) AS shifts,
           (SELECT coalesce(sum(pm.amount_kopecks), 0)::int FROM payments pm WHERE pm.character_id = c.id AND pm.status = 'CONFIRMED') AS paid_kopecks,
           (SELECT array_agg(to_char(d.day, 'YYYY-MM-DD') ORDER BY d.day) FROM user_active_days d WHERE d.user_id = u.id) AS days
    FROM users u
    LEFT JOIN characters c ON c.user_id = u.id
    LEFT JOIN characters rc ON rc.id = u.referrer_character_id
    WHERE u.registered_at >= ${since}
    ORDER BY u.registered_at DESC`

  const series = await prisma.$queryRaw<{ day: string; regs: number; active: number; fresh: number }[]>`
    SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
           (SELECT count(*)::int FROM users u WHERE ((u.registered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date = g.day) AS regs,
           (SELECT count(*)::int FROM user_active_days a WHERE a.day = g.day) AS active,
           (SELECT count(*)::int FROM user_active_days a JOIN users u ON u.id = a.user_id
              WHERE a.day = g.day AND ((u.registered_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date = g.day) AS fresh
    FROM generate_series(${firstDay}::date, ${today}::date, interval '1 day') AS g(day)
    ORDER BY g.day`

  const [dau, wau, mau, totalUsers, totalCharacters] = await Promise.all([
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM user_active_days WHERE day = ${today}::date`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT user_id)::int AS n FROM user_active_days WHERE day > ${today}::date - 7`,
    prisma.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT user_id)::int AS n FROM user_active_days WHERE day > ${today}::date - 30`,
    prisma.user.count(),
    prisma.character.count(),
  ])

  // Удержание: вернулся на N-й день или позже — среди тех, у кого этот день уже наступил.
  const returnedAfter = (row: CohortRow, n: number) => {
    const reg = moscowDay(row.registered_at)
    const mark = new Date(Date.parse(reg) + n * DAY_MS).toISOString().slice(0, 10)
    return { eligible: mark <= today, returned: (row.days ?? []).some(day => day >= mark) }
  }
  const retention = (rows: CohortRow[]) => Object.fromEntries([1, 3, 7, 30].map(n => {
    const marks = rows.map(row => returnedAfter(row, n)).filter(r => r.eligible)
    return [`d${n}`, { base: marks.length, returned: marks.filter(r => r.returned).length, pct: pct(marks.filter(r => r.returned).length, marks.length) }]
  }))

  const label = (row: CohortRow) => !row.utm_source && !row.first_referrer && moscowDay(row.registered_at) < TRACKING_SINCE
    ? 'до начала учёта'
    : sourceLabel({ utmSource: row.utm_source, utmCampaign: row.utm_campaign, firstReferrer: row.first_referrer })

  const funnelOf = (rows: CohortRow[]) => {
    const n = rows.length
    const steps = [
      ['Зарегистрировались', n],
      ['Создали персонажа', rows.filter(r => r.character_id).length],
      ['Провели бой', rows.filter(r => r.battles > 0).length],
      ['Отработали смену', rows.filter(r => r.shifts > 0).length],
      ['Вернулись на другой день', rows.filter(r => returnedAfter(r, 1).returned).length],
      ['Дошли до 3 уровня', rows.filter(r => (r.battle_level ?? 0) >= 3).length],
      ['Платили', rows.filter(r => r.paid_kopecks > 0).length],
    ] as const
    return steps.map(([step, count]) => ({ step, count, pct: pct(count, n) }))
  }

  const groups = new Map<string, CohortRow[]>()
  for (const row of cohort) groups.set(label(row), [...(groups.get(label(row)) ?? []), row])
  const sources = [...groups.entries()].map(([source, rows]) => {
    const r = retention(rows)
    return {
      source,
      registered: rows.length,
      withCharacter: rows.filter(x => x.character_id).length,
      fought: rows.filter(x => x.battles > 0).length,
      worked: rows.filter(x => x.shifts > 0).length,
      d1: r.d1, d7: r.d7,
      paying: rows.filter(x => x.paid_kopecks > 0).length,
      revenueRub: Math.round(rows.reduce((sum, x) => sum + x.paid_kopecks, 0) / 100),
    }
  }).sort((a, b) => b.registered - a.registered)

  const campaigns = countBy(cohort.filter(r => r.utm_source), r => [r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content].filter(Boolean).join(' / '))

  return {
    days,
    totals: {
      users: totalUsers, characters: totalCharacters,
      dau: dau[0]?.n ?? 0, wau: wau[0]?.n ?? 0, mau: mau[0]?.n ?? 0,
      registered: cohort.length,
      revenueRub: Math.round(cohort.reduce((sum, r) => sum + r.paid_kopecks, 0) / 100),
    },
    trackingSince: TRACKING_SINCE,
    series,
    retention: retention(cohort),
    funnel: funnelOf(cohort),
    sources,
    campaigns,
    landings: countBy(cohort.filter(r => r.landing_path), r => r.landing_path!),
    referrers: countBy(cohort.filter(r => r.first_referrer), r => r.first_referrer!),
    platforms: countBy(cohort, r => platformOf(r.last_user_agent)),
    invitedBy: countBy(cohort.filter(r => r.referrer_nick), r => r.referrer_nick!),
    players: cohort.slice(0, 200).map(r => ({
      characterId: r.character_id,
      nickname: r.nickname ?? '(без персонажа)',
      registeredAt: r.registered_at,
      source: label(r),
      campaign: [r.utm_campaign, r.utm_content].filter(Boolean).join(' / ') || null,
      landing: r.landing_path,
      platform: platformOf(r.last_user_agent),
      invitedBy: r.referrer_nick,
      level: r.battle_level,
      battles: r.battles,
      shifts: r.shifts,
      daysActive: (r.days ?? []).length,
      lastSeen: r.last_active_at,
      paidRub: Math.round(r.paid_kopecks / 100),
    })),
  }
}

export type MetricsReport = Awaited<ReturnType<typeof metricsReport>>
