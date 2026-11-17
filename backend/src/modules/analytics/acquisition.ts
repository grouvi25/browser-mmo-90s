/**
 * Откуда приходят игроки и кто возвращается (Дима 17.11, перед стартом рекламы).
 *
 * При регистрации клиент присылает метки первой ссылки (utm_*) и сайт, с которого
 * пришли; они ложатся в users. Каждый день, когда игрок заходит в игру, отмечается
 * в user_active_days (раз в сутки, через Redis, чтобы не писать в базу на каждый запрос).
 * Отчёт для админки: источник → регистраций → вернулись на следующий день и через неделю.
 */
import { prisma } from '../../shared/db/prisma'
import { getRedis } from '../../shared/db/redis'

export interface Attribution {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  referrer?: string
  landing?: string
}

const MSK_OFFSET_MS = 3 * 3_600_000
const DAY_MS = 86_400_000

/** Календарный день по Москве: 'YYYY-MM-DD'. */
export function moscowDay(at: Date = new Date()): string {
  return new Date(at.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10)
}

function clean(value: string | undefined, max = 120): string | null {
  // Управляющие символы (переводы строк, табуляции) из меток выкидываем.
  const text = [...(value ?? '')].filter(ch => ch.charCodeAt(0) >= 32).join('').trim()
  return text ? text.slice(0, max) : null
}

/** Сайт-источник храним только доменом: полный адрес может нести чужие данные. */
export function referrerHost(raw: string | undefined): string | null {
  const text = clean(raw, 300)
  if (!text) return null
  try {
    const host = new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase()
    return host.replace(/^www\./, '').slice(0, 120) || null
  } catch {
    return null
  }
}

/** Поля для users из того, что прислал клиент. Мусор отбрасывается, регистрацию это не ломает. */
export function attributionFields(input: Attribution | undefined) {
  if (!input) return {}
  const landing = clean(input.landing, 200)
  return {
    utmSource: clean(input.utmSource),
    utmMedium: clean(input.utmMedium),
    utmCampaign: clean(input.utmCampaign),
    utmContent: clean(input.utmContent),
    utmTerm: clean(input.utmTerm),
    firstReferrer: referrerHost(input.referrer),
    landingPath: landing && landing.startsWith('/') ? landing.split('?')[0] : null,
  }
}

const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)yandex\.|(^|\.)ya\.ru$/, 'Яндекс'],
  [/(^|\.)google\./, 'Google'],
  [/(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/, 'ВКонтакте'],
  [/(^|\.)(t\.me|telegram\.org|web\.telegram\.org)$/, 'Telegram'],
  [/(^|\.)ok\.ru$/, 'Одноклассники'],
  [/(^|\.)dzen\.ru$/, 'Дзен'],
  [/(^|\.)(mail\.ru|go\.mail\.ru)$/, 'Mail.ru'],
  [/(^|\.)youtube\.com$/, 'YouTube'],
]

/** Понятное имя источника для отчёта. */
export function sourceLabel(user: { utmSource: string | null; utmCampaign?: string | null; firstReferrer: string | null }): string {
  if (user.utmSource) return user.utmCampaign ? `${user.utmSource} / ${user.utmCampaign}` : user.utmSource
  if (user.firstReferrer) {
    for (const [pattern, name] of KNOWN_HOSTS) if (pattern.test(user.firstReferrer)) return name
    return user.firstReferrer
  }
  return 'прямой заход'
}

/**
 * Отметить, что игрок сегодня заходил. Первый вызов за сутки пишет в базу,
 * остальные отсекаются ключом в Redis. Ошибки молча глотаются: это учёт, не игра.
 */
export async function markActiveDay(userId: string, now: Date = new Date()): Promise<void> {
  const day = moscowDay(now)
  const first = await getRedis().set(`active-day:${day}:${userId}`, '1', 'EX', 2 * 86_400, 'NX')
  if (first !== 'OK') return
  await prisma.$executeRaw`INSERT INTO user_active_days (user_id, day) VALUES (${userId}, ${day}::date) ON CONFLICT DO NOTHING`
}

/** Учёт источников включён с этого дня: у тех, кто зарегистрировался раньше, данных нет. */
export const TRACKING_SINCE = '2026-11-18'

export interface SourceRow {
  label: string
  registered: number
  /** Заходили хотя бы раз после дня регистрации. */
  returned: number
  /** Через неделю и позже — среди тех, у кого неделя уже прошла. */
  week: number
  weekBase: number
}

export interface RegistrationRow { characterId?: string; nickname: string; source: string; registeredAt: Date }

/** Отчёт за последние `days` дней по дням Москвы. */
export async function acquisitionReport(days = 30, now: Date = new Date()): Promise<{ rows: SourceRow[]; latest: RegistrationRow[] }> {
  const since = new Date(now.getTime() - days * DAY_MS)
  const users = await prisma.user.findMany({
    where: { registeredAt: { gte: since } },
    select: {
      id: true, registeredAt: true, utmSource: true, utmCampaign: true, firstReferrer: true,
      character: { select: { id: true, nickname: true } },
      activeDays: { select: { day: true } },
    },
    orderBy: { registeredAt: 'desc' },
  })
  const today = moscowDay(now)
  const byLabel = new Map<string, SourceRow>()
  for (const user of users) {
    const regDay = moscowDay(user.registeredAt)
    const label = !user.utmSource && !user.firstReferrer && regDay < TRACKING_SINCE
      ? 'до начала учёта'
      : sourceLabel(user)
    const row = byLabel.get(label) ?? { label, registered: 0, returned: 0, week: 0, weekBase: 0 }
    row.registered++
    const activeDays = user.activeDays.map(item => item.day.toISOString().slice(0, 10))
    if (activeDays.some(day => day > regDay)) row.returned++
    const weekDay = new Date(Date.parse(regDay) + 7 * DAY_MS).toISOString().slice(0, 10)
    if (weekDay <= today) {
      row.weekBase++
      if (activeDays.some(day => day >= weekDay)) row.week++
    }
    byLabel.set(label, row)
  }
  const rows = [...byLabel.values()].sort((a, b) => b.registered - a.registered)
  const latest = users.slice(0, 15).map(user => ({
    characterId: user.character?.id,
    nickname: user.character?.nickname ?? '(без персонажа)',
    source: sourceLabel(user),
    registeredAt: user.registeredAt,
  }))
  return { rows, latest }
}
