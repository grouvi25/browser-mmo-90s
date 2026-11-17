// Откуда пришёл игрок (Дима 17.11, перед стартом рекламы). Метки первой ссылки
// (utm_*, yclid от Директа) и сайт-источник запоминаем при первом заходе и отдаём
// при регистрации. Заход «напрямую» не перекрывает пришедший по ссылке, а следующая
// ссылка с метками перекрывает прямой заход: из прямого захода нечего учитывать.
const KEY = 'koop_attr'
const COUNTER = 111441325

export interface Attribution {
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
  referrer?: string
  landing?: string
}

declare global { interface Window { ym?: (id: number, method: string, ...args: unknown[]) => void } }

function hasSource(a: Attribution | null): boolean {
  return !!(a && (a.utmSource || a.referrer))
}

export function captureAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const pick = (name: string) => params.get(name)?.trim().slice(0, 200) || undefined
    let referrer: string | undefined
    try {
      const host = document.referrer ? new URL(document.referrer).hostname : ''
      if (host && host !== window.location.hostname) referrer = host
    } catch { /* кривой referrer — без него */ }
    const current: Attribution = {
      utmSource: pick('utm_source') ?? (params.get('yclid') ? 'yandex_direct' : undefined),
      utmMedium: pick('utm_medium'),
      utmCampaign: pick('utm_campaign'),
      utmContent: pick('utm_content'),
      utmTerm: pick('utm_term'),
      referrer,
      landing: window.location.pathname,
    }
    const stored = readAttribution()
    if (!stored || (!hasSource(stored) && hasSource(current))) {
      localStorage.setItem(KEY, JSON.stringify(current))
    }
  } catch { /* приватный режим — просто без источника */ }
}

export function readAttribution(): Attribution | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as Attribution : undefined
  } catch {
    return undefined
  }
}

/** Цель в Яндекс.Метрике (в счётчике заводится цель «JavaScript-событие» с этим id). */
export function reachGoal(goal: 'registration'): void {
  try { window.ym?.(COUNTER, 'reachGoal', goal) } catch { /* счётчик заблокирован — не страшно */ }
}
