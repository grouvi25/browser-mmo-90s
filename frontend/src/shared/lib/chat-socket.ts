// =============================================================
// Одно соединение с сокетом на всю вкладку.
//
// Чат живёт сразу в трёх местах — полоса внизу города, шторка боя и
// страница «Радио», — и открывать под каждое своё соединение нельзя:
// сервер считает по ним присутствие, и один игрок насчитал бы себя
// трижды. Поэтому соединение одно, а подписчики складываются.
// =============================================================
import { io, type Socket } from 'socket.io-client'
import type { ChatLine } from '../api/chat.api'

const BASE = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_BASE_URL || ''

let socket: Socket | null = null
let refCount = 0

function connect(): Socket | null {
  if (socket) return socket
  // Без токена сервер разорвёт рукопожатие, а клиент будет ломиться
  // заново по кругу. Гостю эфир и не нужен — просто не подключаемся.
  if (!localStorage.getItem('mmo_token')) return null
  socket = io(BASE || undefined, {
    // Токен читаем при каждом подключении, а не один раз при загрузке:
    // после перелогина в той же вкладке он другой.
    auth: () => ({ token: localStorage.getItem('mmo_token') ?? '' }),
    transports: ['websocket', 'polling'],
    autoConnect: true,
  })
  return socket
}

/**
 * Подписка на реплики канала. Возвращает отписку; когда отписался
 * последний, соединение закрывается — сервер снимает игрока с эфира.
 */
export function subscribeChat(onMessage: (line: ChatLine) => void): () => void {
  const active = connect()
  // Соединения нет — лента живёт одним запросом истории. Это рабочий
  // режим, а не сбой: сообщения приходят с задержкой, но приходят.
  if (!active) return () => undefined

  refCount++
  active.on('chat:message', onMessage)

  return () => {
    active.off('chat:message', onMessage)
    refCount = Math.max(0, refCount - 1)
    if (refCount === 0) {
      active.disconnect()
      socket = null
    }
  }
}

/** Переключить комнату района. Молча ничего не делает без соединения. */
export function joinDistrict(district: string): void {
  socket?.emit('chat:district', district)
}
