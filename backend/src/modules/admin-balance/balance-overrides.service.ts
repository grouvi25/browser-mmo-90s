// =============================================================
// ПРАВКА КОЭФФИЦИЕНТОВ БЕЗ ДЕПЛОЯ
//
// BalanceConfig лежит в коде, и это правильно: числа проходят ревью
// вместе с формулами. Но подвинуть зарплату на пять процентов, собрав
// релиз, — цена, из-за которой баланс не правят вовсе.
//
// Как это работает. Формулы читают конфиг СССЫЛКОЙ на объект
// (`const T = BalanceConfig.strategy.territory`), а не копией числа —
// проверено по всем девятнадцати файлам формул. Значит достаточно
// подменить поле внутри объекта, и правку увидят все, кто его читает,
// без единой строчки изменений в формулах.
//
// Что при этом важно:
//
//  * в базе хранится только РАЗНИЦА с кодом. Пустая таблица — игра
//    работает ровно как написано, и «вернуть исходное» это удаление
//    строки, а не запись старого числа;
//  * процессов два — сервер и воркер. Правка в одном не видна другому,
//    поэтому об изменении сообщается через Redis, и оба перечитывают;
//  * тип значения обязан совпасть с тем, что стоит в коде: подменить
//    число строкой или снести объект целиком нельзя.
// =============================================================
import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { getRedis, getRedisSub } from '../../shared/db/redis'
import { logger } from '../../shared/logger/logger'

/** Канал, по которому процессы узнают о правке. */
const CHANNEL = 'balance:overrides:changed'

/** Снимок значений по умолчанию — то, что стояло в коде при старте.
    Снимается один раз до всякой правки: иначе «исходное» уехало бы
    вместе с первым же переопределением. */
const DEFAULTS = new Map<string, unknown>()

type Mutable = Record<string, unknown>

/** Разбирает путь вида `economy.work.salaryCapMultiplier`. */
function resolve(path: string): { holder: Mutable; key: string } | null {
  const parts = path.split('.')
  if (parts.length < 2) return null
  let holder = BalanceConfig as unknown as Mutable
  for (const part of parts.slice(0, -1)) {
    const next = holder[part]
    if (next === null || typeof next !== 'object') return null
    holder = next as Mutable
  }
  const key = parts[parts.length - 1]
  return key in holder ? { holder, key } : null
}

/** Значение из кода — до любых правок. */
export function defaultValue(path: string): unknown {
  if (DEFAULTS.has(path)) return DEFAULTS.get(path)
  const target = resolve(path)
  return target ? target.holder[target.key] : undefined
}

export function currentValue(path: string): unknown {
  const target = resolve(path)
  return target ? target.holder[target.key] : undefined
}

/**
 * Границы, в которых число вообще имеет смысл.
 *
 * Совпадения типа мало: `hitChance.max = 0` делает бой невозможным, а
 * `salaryCapMultiplier = 1e9` печатает деньги — и то и другое пройдёт как
 * «это число». Поэтому у каждого параметра есть коридор, и он выводится
 * из значения в КОДЕ, а не из текущего: иначе правки накапливались бы,
 * каждый раз раздвигая границу от уже сдвинутого значения.
 */
export function limitsFor(path: string): { min: number; max: number } | null {
  const base = defaultValue(path)
  if (typeof base !== 'number') return null

  // Доли и вероятности живут в 0…1, и вылезать за единицу им нельзя:
  // шанс 150% это не «много», а сломанная формула.
  const looksLikeShare = base > 0 && base <= 1
    && /chance|share|rate|coeff|mult|ratio|penalty|resist|reduction|bonus|pressure|step|floor|growth|gini|efficiency|tax|fee/i.test(path)
  if (looksLikeShare) return { min: 0, max: 1 }

  // Остальное — двадцатикратный коридор вокруг кода. Этого хватает на
  // любую осмысленную настройку и мало для «случайно дописал нулей».
  const span = Math.max(Math.abs(base) * 20, 20)
  return { min: base < 0 ? -span : 0, max: span }
}

/** Существует ли такой путь, совпадает ли тип и не выходит ли за границы. */
export function validatePath(path: string, value: unknown): string | null {
  const target = resolve(path)
  if (!target) return `Пути «${path}» в конфигурации нет`

  const existing = defaultValue(path)
  const sameType = typeof existing === typeof value
    && Array.isArray(existing) === Array.isArray(value)
  if (!sameType) {
    return `Тип не совпадает: в коде ${Array.isArray(existing) ? 'список' : typeof existing}, а прислали ${Array.isArray(value) ? 'список' : typeof value}`
  }
  // Объекты и таблицы правятся целиком и редко; число, доля или строка —
  // обычный случай. Пустой объект вместо таблицы порогов — почти всегда
  // ошибка, а не намерение.
  if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
    if (Object.keys(value as object).length === 0) return 'Пустой объект стёр бы таблицу целиком'
  }
  if (typeof existing === 'number') {
    const next = value as number
    if (!Number.isFinite(next)) return 'Не число'

    const limits = limitsFor(path)
    if (limits && (next < limits.min || next > limits.max)) {
      return `Значение вне допустимого коридора ${limits.min}…${limits.max} (в коде ${existing})`
    }
    // Ноль в знаменателе и нулевые потолки ломают формулы молча: результат
    // становится бесконечностью или NaN, и находится это уже по жалобам.
    if (next === 0 && existing !== 0 && /divider|max|cap|limit|threshold|per|k$/i.test(path)) {
      return 'Ноль здесь обнулит или сломает формулу — если это осознанно, правьте в коде с ревью'
    }
  }
  return null
}

/** Кладёт значение в живой конфиг. */
function apply(path: string, value: unknown): void {
  const target = resolve(path)
  if (!target) return
  if (!DEFAULTS.has(path)) DEFAULTS.set(path, target.holder[target.key])
  target.holder[target.key] = value
}

/** Возвращает значение из кода. */
function revert(path: string): void {
  const target = resolve(path)
  if (!target || !DEFAULTS.has(path)) return
  target.holder[target.key] = DEFAULTS.get(path)
}

/**
 * Перечитывает переопределения из базы и накладывает на конфиг.
 *
 * Снимает и те, что исчезли из базы: иначе снятая правка продолжала бы
 * работать до перезапуска процесса.
 */
export async function reloadOverrides(): Promise<number> {
  const rows = await prisma.balanceOverride.findMany()
  const live = new Set(rows.map(row => row.path))

  for (const path of DEFAULTS.keys()) {
    if (!live.has(path)) revert(path)
  }
  for (const row of rows) {
    apply(row.path, row.valueJson)
  }
  return rows.length
}

/** Сообщает другим процессам, что конфиг изменился. */
async function announce(): Promise<void> {
  try {
    await getRedis().publish(CHANNEL, String(Date.now()))
  } catch (err) {
    // Публикация не должна валить саму правку: в худшем случае второй
    // процесс подхватит её при следующем старте.
    logger.error({ err }, '[Balance] Не удалось разослать уведомление о правке')
  }
}

/**
 * Подписка на правки. Вызывается и сервером, и воркером: у них разные
 * процессы и, значит, разные копии BalanceConfig в памяти.
 */
export async function watchOverrides(): Promise<void> {
  await reloadOverrides()
  const sub = getRedisSub()
  await sub.subscribe(CHANNEL)
  sub.on('message', (channel: string, _message: string) => {
    if (channel !== CHANNEL) return
    void reloadOverrides()
      .then(count => logger.info({ count }, '[Balance] Переопределения перечитаны'))
      .catch(err => logger.error({ err }, '[Balance] Не удалось перечитать переопределения'))
  })
}

export interface OverrideRow {
  path: string
  value: unknown
  previous: unknown
  reason: string
  adminId: string
  updatedAt: Date
}

export async function listOverrides(): Promise<OverrideRow[]> {
  const rows = await prisma.balanceOverride.findMany({ orderBy: { updatedAt: 'desc' } })
  return rows.map(row => ({
    path: row.path,
    value: row.valueJson,
    previous: row.previousJson,
    reason: row.reason,
    adminId: row.adminId,
    updatedAt: row.updatedAt,
  }))
}

/** Ставит переопределение. Возвращает то, что было, — для журнала. */
export async function setOverride(
  path: string, value: unknown, reason: string, adminId: string,
): Promise<{ previous: unknown }> {
  const previous = currentValue(path)
  await prisma.balanceOverride.upsert({
    where: { path },
    create: {
      path,
      valueJson: value as object,
      previousJson: (defaultValue(path) ?? null) as object,
      reason, adminId,
    },
    update: { valueJson: value as object, reason, adminId, updatedAt: new Date() },
  })
  apply(path, value)
  await announce()
  return { previous }
}

/** Снимает переопределение: значение возвращается к тому, что в коде. */
export async function clearOverride(path: string): Promise<void> {
  await prisma.balanceOverride.deleteMany({ where: { path } })
  revert(path)
  await announce()
}
