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

  // Просьба 26.10: алерты и заказчику — получатели через запятую.
  it('шлёт каждому из списка; отказ одного не мешает остальным', async () => {
    envMock.TELEGRAM_CHAT_ID = '111, 222'
    const chats: string[] = []
    const calls = vi.fn(async (_url: string, init: { body: string }) => {
      const chat = (JSON.parse(init.body) as { chat_id: string }).chat_id
      chats.push(chat)
      return (chat === '222'
        ? { ok: false, status: 400, text: async () => 'chat not found' }
        : { ok: true }) as unknown as Response
    })
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegram, telegramChatIds } = await import('../../modules/admin-balance/telegram.service')
    expect(telegramChatIds()).toEqual(['111', '222'])
    const result = await run(sendTelegram('проверка'))

    expect(chats.sort()).toEqual(['111', '222'])
    expect(result.ok).toBe(true)
    expect(result.error).toContain('222')
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

  // Скриншот из обращения (просьба 10.11): поддержка видит его в боте.
  it('шлёт скриншот фотографией с текстом в подписи', async () => {
    const calls = vi.fn().mockResolvedValue({ ok: true } as Response)
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegramPhoto } = await import('../../modules/admin-balance/telegram.service')
    const result = await run(sendTelegramPhoto('Новое обращение', { mime: 'image/png', bytes: Buffer.from('png-bytes') }))

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveBeenCalledTimes(1)
    const [url, init] = calls.mock.calls[0] as [string, { body: FormData }]
    expect(url).toContain('/sendPhoto')
    expect(init.body.get('caption')).toBe('Новое обращение')
    expect(init.body.get('chat_id')).toBe('1')
    const file = init.body.get('photo') as File
    expect(file.name).toBe('screenshot.png')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('png-bytes')
  })

  it('если фото не принято, текст всё равно уходит сообщением', async () => {
    const calls = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'IMAGE_PROCESS_FAILED' } as unknown as Response)
      .mockResolvedValue({ ok: true } as Response)
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegramPhoto } = await import('../../modules/admin-balance/telegram.service')
    const result = await run(sendTelegramPhoto('Новое обращение', { mime: 'image/jpeg', bytes: Buffer.from('x') }))

    expect(result).toEqual({ ok: true })
    expect((calls.mock.calls[0] as [string])[0]).toContain('/sendPhoto')
    expect((calls.mock.calls[1] as [string])[0]).toContain('/sendMessage')
  })

  it('длинный текст не режется под подпись: сообщение целиком, фото следом', async () => {
    const calls = vi.fn().mockResolvedValue({ ok: true } as Response)
    globalThis.fetch = calls as unknown as typeof fetch

    const { sendTelegramPhoto } = await import('../../modules/admin-balance/telegram.service')
    const long = 'я'.repeat(1500)
    const result = await run(sendTelegramPhoto(long, { mime: 'image/webp', bytes: Buffer.from('x') }))

    expect(result).toEqual({ ok: true })
    const [first, second] = calls.mock.calls as [string, { body: string | FormData }][]
    expect(first[0]).toContain('/sendMessage')
    expect(JSON.parse(first[1].body as string).text).toBe(long)
    expect(second[0]).toContain('/sendPhoto')
    expect((second[1].body as FormData).get('caption')).toBeNull()
  })
})
