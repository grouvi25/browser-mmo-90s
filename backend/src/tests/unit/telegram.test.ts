// Повторы отправки в Telegram.
//
// Замерено на проде: холодное соединение до api.telegram.org рвётся
// примерно в каждой четвёртой попытке, а следующая проходит за сотню
// миллисекунд. Без повторов ночной алерт терялся бы с той же четвертной
// вероятностью — и узнать об этом было бы неоткуда.
//
// Здесь же закреплено обратное правило: ответ Telegram не повторяется.
// «chat not found» не пройдёт и с десятой попытки, а долбить им API —
// верный способ получить ограничение по частоте.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Модуль окружения проверяет весь конфиг при импорте и убивает процесс,
// если чего-то нет. Юнит-тесту нужны две переменные из него, а не живой
// сервер, поэтому подменяем целиком.
const envMock = { TELEGRAM_BOT_TOKEN: 'test-token' as string | undefined, TELEGRAM_CHAT_ID: '1' as string | undefined }
vi.mock('../../config/env', () => ({ env: envMock }))

// Redis нужен только дедупликации алертов; сама отправка о нём не знает.
vi.mock('../../shared/db/redis', () => ({ getRedis: () => ({}) }))

// Логгер тянет то же окружение. Проверяем поведение отправки, а не то,
// что она пишет в лог.
vi.mock('../../shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const ORIGINAL_FETCH = globalThis.fetch

describe('telegram sender', () => {
  beforeEach(() => {
    vi.resetModules()
    envMock.TELEGRAM_BOT_TOKEN = 'test-token'
    envMock.TELEGRAM_CHAT_ID = '1'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = ORIGINAL_FETCH
  })

  /** Пауза между попытками — настоящая, поэтому таймеры прокручиваем. */
  async function run(promise: Promise<unknown>) {
    await vi.runAllTimersAsync()
    return promise
  }

  it('повторяет сетевой сбой и доходит со второй попытки', async () => {
    const calls = vi.fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue({ ok: true } as Response)
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegram } = await import('../../modules/admin-balance/telegram.service')
    const result = await run(sendTelegram('проверка'))

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('сдаётся после трёх сетевых сбоев, а не висит бесконечно', async () => {
    const calls = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegram } = await import('../../modules/admin-balance/telegram.service')
    const result = await run(sendTelegram('проверка'))

    expect(result.ok).toBe(false)
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it('не повторяет отказ самого Telegram', async () => {
    const calls = vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'chat not found',
    } as unknown as Response)
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegram } = await import('../../modules/admin-balance/telegram.service')
    const result = await run(sendTelegram('проверка'))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('400')
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('без настроек молчит и в сеть не ходит', async () => {
    envMock.TELEGRAM_BOT_TOKEN = undefined
    const calls = vi.fn()
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegram } = await import('../../modules/admin-balance/telegram.service')
    const result = await sendTelegram('проверка')

    expect(result.ok).toBe(false)
    expect(calls).not.toHaveBeenCalled()
  })
})
