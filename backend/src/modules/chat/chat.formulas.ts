// =============================================================
// Правила эфира.
//
// Всё, что можно проверить без базы и без Redis, живёт здесь: длина
// реплики, разбор адреса канала, пороги антифлуда. Так правила видно
// одним файлом, и их можно проверить тестом, не поднимая ничего.
// =============================================================
import type { ChatChannel } from '@prisma/client'

/** Длиннее в базу и не влезет: колонка объявлена VARCHAR(400). */
export const MAX_BODY = 400

/**
 * Районы города — те же шесть, что нарисованы в макете верхнего меню.
 * Список закрытый намеренно: иначе адрес комнаты приходит от клиента
 * и любой заводит себе приватный эфир, которого в игре нет.
 */
export const DISTRICTS = ['center', 'market', 'industrial', 'garages', 'suburb', 'station'] as const
export type District = (typeof DISTRICTS)[number]

/**
 * Антифлуд. Три разных порога, потому что и злоупотребления разные:
 * пауза ловит зажатый Enter, окно — размеренную долбёжку в обход паузы,
 * повтор — копипасту одного и того же объявления.
 *
 * Числа стоят щадящие: это разговорный чат, а не рация диспетчера.
 * Живой человек в них не упирается, автокликер упирается сразу.
 */
export const FLOOD = {
  /** Минимальная пауза между двумя репликами, мс. */
  minGapMs: 1_500,
  /** Сколько реплик разрешено в окне. */
  windowLimit: 12,
  /** Длина окна, с. */
  windowSec: 60,
  /** Столько держим отпечаток последней реплики, с — для ловли повтора. */
  repeatSec: 30,
}

/** Почему реплику не приняли. Разбирается на текст уже в маршруте. */
export type Rejection =
  | { kind: 'empty' }
  | { kind: 'too-long'; max: number }
  | { kind: 'too-fast'; waitMs: number }
  | { kind: 'too-many'; limit: number; windowSec: number }
  | { kind: 'repeat' }

/**
 * Управляющие символы, которые надо вырезать: весь диапазон C0 и DEL,
 * кроме табуляции и перевода строки. С клавиатуры их не набрать — они
 * приходят вставкой и ломают вёрстку ленты.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/**
 * Приводит реплику к тому виду, в котором её увидят: без крайних
 * пробелов, без управляющих символов и без лестницы переводов строки.
 * Возвращает null, если после чистки ничего не осталось.
 */
export function normalizeBody(raw: string): string | null {
  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    // Больше одного пустого ряда подряд — это уже растягивание ленты,
    // чтобы вытеснить чужие реплики за край окна.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{4,}/g, '   ')
    .trim()
  return cleaned.length ? cleaned : null
}

/** Адрес комнаты внутри канала: район, клан или пусто для общего. */
export function scopeFor(
  channel: ChatChannel,
  raw: string | undefined,
  clanId: string | null,
): string | null {
  if (channel === 'GLOBAL') return ''
  if (channel === 'DISTRICT') {
    const key = (raw ?? '').toLowerCase()
    return (DISTRICTS as readonly string[]).includes(key) ? key : null
  }
  // Клан не спрашиваем у клиента: комната всегда своя, чужую не открыть.
  return clanId
}

/** Ключи Redis под антифлуд — рядом с порогами, чтобы не разъезжались. */
export const floodKeys = {
  last: (charId: string) => `chat:last:${charId}`,
  window: (charId: string) => `chat:win:${charId}`,
  repeat: (charId: string) => `chat:rep:${charId}`,
}

/**
 * Имя комнаты сокета. Общая для сервера и маршрутов функция нужна,
 * чтобы подписка и рассылка не разъехались по написанию: комнаты в
 * socket.io — просто строки, опечатку в них никто не поймает.
 */
export function chatRoom(channel: ChatChannel, scope: string): string {
  return channel === 'GLOBAL' ? 'chat:GLOBAL' : `chat:${channel}:${scope}`
}
