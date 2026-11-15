// Доска разработчиков: вебхук бота (кнопки и команды в группе) и закрытый
// адрес для нейронок. Ключ — заголовок X-Dev-Token = DEV_BOARD_TOKEN.
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env'
import { logger } from '../../shared/logger/logger'
import { AppError } from '../../shared/errors/app-error'
import { DevBoard, devBoardConfigured, devBoardWebhookSecret, devName } from './dev-board.service'

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Нет настроек или ключ не тот — адреса как будто нет. */
function guard(req: FastifyRequest, reply: FastifyReply): boolean {
  const key = req.headers['x-dev-token']
  if (!devBoardConfigured() || typeof key !== 'string' || !same(key, env.DEV_BOARD_TOKEN!)) {
    void reply.code(404).send({ message: 'Not found' })
    return false
  }
  return true
}

const Who = z.string().trim().min(1).max(60)
const IdParam = z.coerce.number().int().positive()

type TgUser = { username?: string; first_name?: string }
type TgUpdate = {
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number } } }
  message?: { chat: { id: number }; from?: TgUser; text?: string }
}

async function tgCall(method: string, body: Record<string, unknown>) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  }).catch(err => logger.warn({ err, method }, '[DevBoard] ответ в Telegram не ушёл'))
}

export async function devBoardRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Вебхук: кнопки и команды из группы ────────────────────
  fastify.post('/telegram', { config: { rateLimit: false } }, async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token']
    if (!devBoardConfigured() || typeof secret !== 'string' || !same(secret, devBoardWebhookSecret())) return reply.code(404).send()
    const update = req.body as TgUpdate
    const chatOk = (id?: number) => String(id) === String(env.DEV_BOARD_CHAT_ID)
    try {
      const cb = update.callback_query
      if (cb && chatOk(cb.message?.chat.id)) {
        const [action, raw] = (cb.data ?? '').split(':')
        const id = Number(raw)
        const who = devName(cb.from)
        let answer = ''
        try {
          if (action === 'take') { await DevBoard.take(id, who); answer = 'Взял' }
          else if (action === 'done') { await DevBoard.done(id, who); answer = 'Готово' }
          else if (action === 'free') { await DevBoard.free(id); answer = 'Свободно' }
        } catch (err) {
          answer = err instanceof AppError ? err.message : 'Не получилось'
        }
        await tgCall('answerCallbackQuery', { callback_query_id: cb.id, text: answer })
      }
      const msg = update.message
      if (msg?.text && chatOk(msg.chat.id)) {
        // В группе команда может прийти как /task@kooperativAlertsBot.
        const [command, ...rest] = msg.text.trim().split(/\s+/)
        const name = command.split('@')[0].toLowerCase()
        if (name === '/task') {
          const title = rest.join(' ')
          if (title) await DevBoard.addTask(title, devName(msg.from))
          else await tgCall('sendMessage', { chat_id: env.DEV_BOARD_CHAT_ID, text: 'Напишите так: /task что сделать' })
        } else if (name === '/board') {
          await tgCall('sendMessage', { chat_id: env.DEV_BOARD_CHAT_ID, text: await DevBoard.boardText(), parse_mode: 'HTML', disable_web_page_preview: true })
        }
      }
    } catch (err) {
      logger.warn({ err }, '[DevBoard] вебхук')
    }
    return reply.send({ ok: true })
  })

  // ── Для нейронок ───────────────────────────────────────────
  fastify.get('/', { config: { rateLimit: false } }, async (req, reply) => {
    if (!guard(req, reply)) return
    return reply.send(await DevBoard.list())
  })

  fastify.get<{ Params: { number: string } }>('/tickets/:number', async (req, reply) => {
    if (!guard(req, reply)) return
    return reply.send(await DevBoard.ticket(IdParam.parse(req.params.number)))
  })

  for (const action of ['take', 'done', 'free'] as const) {
    fastify.post<{ Params: { id: string } }>(`/:id/${action}`, async (req, reply) => {
      if (!guard(req, reply)) return
      const id = IdParam.parse(req.params.id)
      const who = Who.parse((req.body as { who?: string } | undefined)?.who ?? 'нейронка')
      const item = action === 'take' ? await DevBoard.take(id, who) : action === 'done' ? await DevBoard.done(id, who) : await DevBoard.free(id)
      return reply.send(item)
    })
  }

  fastify.post('/tasks', async (req, reply) => {
    if (!guard(req, reply)) return
    const body = z.object({ title: z.string().min(1).max(300), note: z.string().max(2000).optional(), who: Who }).parse(req.body)
    return reply.send(await DevBoard.addTask(body.title, body.who, body.note))
  })

  fastify.post<{ Params: { number: string } }>('/tickets/:number/reply', async (req, reply) => {
    if (!guard(req, reply)) return
    const body = z.object({ text: z.string().min(1).max(4000), close: z.boolean().default(false), who: Who }).parse(req.body)
    return reply.send(await DevBoard.reply(IdParam.parse(req.params.number), body.text, body.close, body.who))
  })
}
