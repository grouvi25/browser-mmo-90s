// =============================================================
// РАСШИФРОВКА АЛЕРТОВ
//
// Воркер экономики поднимает флаг кодом — «HIGH_MONEY_GINI». Код говорит
// администратору ровно ничего: что случилось, из-за кого, что смотреть и
// что с этим делать — всё оставалось в голове того, кто писал воркер.
//
// Здесь у каждого кода есть: человеческое название, объяснение, чем это
// грозит, порог с текущим значением и УЛИКИ — конкретные строки из базы,
// на которые надо смотреть. Плюс список действий: куда идти и что нажать.
//
// Улики собираются на месте, запросом к базе: показывать «расслоение выше
// нормы» и не показывать, у кого именно деньги, — это и есть информация
// ради информации.
// =============================================================
import { BalanceConfig as B } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { gini } from '../../workers/economy-metrics.formulas'
import type { EconomyMetricsSnapshot } from '../../workers/economy-metrics-daily.worker'

export type AlertSeverity = 'watch' | 'act'

/** Куда ведёт кнопка: вкладка админки и, если нужно, что там открыть. */
export interface AlertAction {
  label: string
  tab: string
  /** Что подсветить или открыть внутри вкладки. */
  focus?: string
}

export interface AlertEvidenceRow {
  label: string
  value: string
  /** Ссылка на игрока, если строка про конкретного человека. */
  characterId?: string
}

export interface AlertCard {
  code: string
  title: string
  severity: AlertSeverity
  /** Что произошло — фактом и числом. */
  what: string
  /** Чем это грозит игре. */
  why: string
  /** Порог, который пробит, и где он лежит. */
  threshold: { path: string; limit: string; actual: string }
  /** На что смотреть: конкретные строки из базы. */
  evidence: AlertEvidenceRow[]
  evidenceTitle: string
  /** Что можно сделать прямо сейчас. */
  actions: AlertAction[]
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`
const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`

/**
 * Собирает карточки по кодам из снимка.
 *
 * Каждая карточка тянет свои улики отдельно: их немного, и запрос идёт
 * только по тем алертам, что реально подняты.
 */
export async function describeAlerts(snapshot: EconomyMetricsSnapshot): Promise<AlertCard[]> {
  const cards: AlertCard[] = []
  for (const code of snapshot.alerts) {
    const card = await buildCard(code, snapshot)
    if (card) cards.push(card)
  }
  return cards
}

async function buildCard(code: string, snapshot: EconomyMetricsSnapshot): Promise<AlertCard | null> {
  const cfg = B.economy.alerts

  switch (code) {
    case 'HIGH_MONEY_GINI': {
      // Улика — сами богатые. Джини это одно число про всех, и по нему
      // нельзя понять, копится ли богатство честно или кто-то нашёл кран.
      const [top, all] = await Promise.all([
        prisma.character.findMany({
          select: { id: true, nickname: true, money: true, battleLevel: true },
          orderBy: { money: 'desc' },
          take: 10,
        }),
        prisma.character.findMany({ select: { money: true } }),
      ])
      const money = all.map(row => row.money).sort((a, b) => b - a)
      const total = money.reduce((sum, value) => sum + value, 0)
      const onePercent = Math.max(1, Math.round(money.length * 0.01))
      const topShare = total > 0 ? money.slice(0, onePercent).reduce((s, v) => s + v, 0) / total : 0
      const median = money.length ? money[Math.floor(money.length / 2)] : 0
      const richest = money[0] ?? 0

      return {
        code,
        title: 'Деньги скопились у немногих',
        severity: 'act',
        what: `Коэффициент Джини ${snapshot.gini.toFixed(2)} при пороге ${cfg.maxGini}. Верхний процент игроков держит ${pct(topShare)} всех денег, а у самого богатого ${rub(richest)} против медианных ${rub(median)} — разрыв в ${median > 0 ? Math.round(richest / median) : '∞'} раз.`,
        why: 'Новичок не догоняет: цены на рынке держат те, у кого деньги, и вход в игру дорожает для всех остальных. Обычно за этим стоит либо найденный игроками кран, либо перекос в одной из механик, либо сговор пары аккаунтов.',
        threshold: { path: 'economy.alerts.maxGini', limit: String(cfg.maxGini), actual: snapshot.gini.toFixed(2) },
        evidenceTitle: 'Богатейшие игроки — с них и начинать',
        evidence: top.map((row, index) => ({
          label: `${index + 1}. ${row.nickname} (ур. ${row.battleLevel})`,
          value: rub(row.money),
          characterId: row.id,
        })),
        actions: [
          { label: 'Открыть игрока и его цепочку операций', tab: 'players' },
          { label: 'Проверить сигналы антиабуза', tab: 'signals' },
          { label: 'Посмотреть порог и правки', tab: 'balance', focus: 'health.alerts' },
        ],
      }
    }

    case 'LOW_SINK_SHARE': {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const rows = await prisma.currencyLog.groupBy({
        by: ['reasonCode'],
        where: { createdAt: { gte: since }, amount: { gt: 0 } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 8,
      })
      return {
        code,
        title: 'Денег печатается больше, чем сгорает',
        severity: 'act',
        what: `Стоки съели ${pct(snapshot.sinkShare)} эмиссии при норме от ${pct(cfg.minSinkShare)}. За сутки вошло ${rub(snapshot.faucets)}, вышло ${rub(snapshot.sinks)}, чистая эмиссия ${rub(snapshot.netEmission)}.`,
        why: 'Это инфляция: цены на рынке игроков поползут вверх, а накопления обесценятся. Лечится либо сужением крана, либо расширением стока — ремонт, улучшения, налоги.',
        threshold: { path: 'economy.alerts.minSinkShare', limit: pct(cfg.minSinkShare), actual: pct(snapshot.sinkShare) },
        evidenceTitle: 'Откуда приходят деньги — самые крупные краны за сутки',
        evidence: rows.map(row => ({ label: row.reasonCode, value: rub(row._sum?.amount ?? 0) })),
        actions: [
          { label: 'Сузить кран: зарплата и госскупка', tab: 'balance', focus: 'work.salary' },
          { label: 'Расширить сток: ремонт и улучшения', tab: 'balance', focus: 'money.upgrades' },
          { label: 'Проверить на песочнице, что выйдет', tab: 'sandbox' },
        ],
      }
    }

    case 'HIGH_M2_GROWTH': {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const rows = await prisma.currencyLog.groupBy({
        by: ['reasonCode'],
        where: { createdAt: { gte: since } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 8,
      })
      return {
        code,
        title: 'Денежная масса растёт слишком быстро',
        severity: 'act',
        what: `За сутки денег у игроков стало больше на ${snapshot.m2Growth !== null ? pct(snapshot.m2Growth) : '—'} при пределе ${pct(cfg.maxDailyM2Growth)}. Сейчас на руках ${rub(snapshot.m2)}.`,
        why: 'Такой темп удваивает массу за две недели. Даже при здоровой доле стоков это обесценивает всё, что игроки уже накопили.',
        threshold: { path: 'economy.alerts.maxDailyM2Growth', limit: pct(cfg.maxDailyM2Growth), actual: snapshot.m2Growth !== null ? pct(snapshot.m2Growth) : '—' },
        evidenceTitle: 'Движение денег за сутки по причинам',
        evidence: rows.map(row => ({ label: row.reasonCode, value: rub(row._sum?.amount ?? 0) })),
        actions: [
          { label: 'Смотреть зарплату и её потолок', tab: 'balance', focus: 'work.salary' },
          { label: 'Смотреть госскупку', tab: 'balance', focus: 'money.government' },
          { label: 'Прогнать в песочнице', tab: 'sandbox' },
        ],
      }
    }

    case 'UPGRADE_SUCCESS_OUT_OF_RANGE': {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const rows = await prisma.upgradeLog.groupBy({
        by: ['result'],
        where: { createdAt: { gte: since } },
        _count: true,
      })
      const rate = snapshot.upgrades.successRate
      const tooHigh = rate > cfg.maxUpgradeSuccessRate
      return {
        code,
        title: tooHigh ? 'Улучшения удаются слишком часто' : 'Улучшения почти не удаются',
        severity: 'watch',
        what: `Успешны ${pct(rate)} попыток при норме ${pct(cfg.minUpgradeSuccessRate)}–${pct(cfg.maxUpgradeSuccessRate)}. Всего за сутки попыток: ${snapshot.upgrades.total}.`,
        why: tooHigh
          ? 'Улучшение задумано как риск и как главный добровольный сток денег. Если оно почти всегда удаётся, деньги перестают сгорать, а вещи быстро уходят в потолок.'
          : 'Игрок жжёт деньги впустую и перестаёт пробовать. Сток закрывается сам собой, а вместе с ним пропадает и смысл копить на улучшение.',
        threshold: {
          path: 'economy.upgrades.baseChance',
          limit: `${pct(cfg.minUpgradeSuccessRate)}–${pct(cfg.maxUpgradeSuccessRate)}`,
          actual: pct(rate),
        },
        evidenceTitle: 'Исходы попыток за сутки',
        evidence: rows.map(row => ({ label: row.result, value: String(row._count) })),
        actions: [
          { label: 'Открыть формулу улучшений', tab: 'balance', focus: 'money.upgrades' },
          { label: 'Проверить предметы и их цены', tab: 'items' },
        ],
      }
    }

    case 'SHIFT_READY_LAG_HIGH': {
      const stuck = await prisma.workShift.count({ where: { status: 'READY_TO_CLAIM' } })
      return {
        code,
        title: 'Смены закрываются с задержкой',
        severity: 'act',
        what: `Медианная задержка ${snapshot.shiftReadyLagMedianSeconds ?? '—'} с между концом смены и её обработкой. Сейчас ждут обработки ${stuck} смен.`,
        why: 'Это не про баланс, а про то, что воркер не успевает или упал. Игрок отработал смену и не получил зарплату — самая обидная поломка из возможных.',
        threshold: { path: '—', limit: '120 с', actual: `${snapshot.shiftReadyLagMedianSeconds ?? '—'} с` },
        evidenceTitle: 'Что проверить на сервере',
        evidence: [
          { label: 'Смен в очереди на выдачу', value: String(stuck) },
          { label: 'Проверить контейнер', value: 'mmo90s-worker-1' },
        ],
        actions: [
          { label: 'Посмотреть незакрытые смены', tab: 'overview' },
        ],
      }
    }

    default:
      return null
  }
}

/** Пересчитывает Джини прямо сейчас — для проверки после правки. */
export async function currentGini(): Promise<number> {
  const rows = await prisma.character.findMany({ select: { money: true } })
  return gini(rows.map(row => row.money))
}
