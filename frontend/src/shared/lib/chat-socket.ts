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
/** Последний район: после переподключения сервер о нём не помнит. */
let lastDistrict: string | null = null
const reconnectListeners = new Set<() => void>()

function connect(): Socket | null {
  if (socket) return socket
  // Без токена сервер разорвёт рукопожатие, а клиент будет ломиться
  // заново по кругу. Гостю эфир и не нужен — просто не подключаемся.
  if (!localStorage.getItem('mmo_token')) return null
  socket = io(BASE || undefined, {
    // Токен читаем при каждом подключении, а не один раз при загрузке:
    // после перелогина в той же вкладке он другой.
    // socket.io-client ждёт функцию с колбэком. Раньше здесь стояла функция,
    // возвращающая объект: колбэк не вызывался, пакет подключения не
    // уходил, и через 45 с сервер рвал соединение — живого чата в браузере
    // не было вовсе, реплики доезжали только перезапросом ленты.
    auth: callback => callback({ token: localStorage.getItem('mmo_token') ?? '' }),
    transports: ['websocket', 'polling'],
    autoConnect: true,
  })
  // Рассинхрон чата (жалоба заказчика 17.10.2026): после обрыва соединения
  // клиент не возвращался в комнату района и не добирал то, что написали,
  // пока его не было. Теперь на каждом подключении — и то и другое.
  socket.on('connect', () => {
    if (lastDistrict) socket?.emit('chat:district', lastDistrict)
    reconnectListeners.forEach(listener => listener())
  })
  return socket
}

/**
 * Подписка на реплики канала. Возвращает отписку; когда отписался
 * последний, соединение закрывается — сервер снимает игрока с эфира.
 */
export function subscribeChat(
  onMessage: (line: ChatLine) => void,
  onDeleted?: (event: { id: string; channel: ChatLine['channel'] }) => void,
): () => void {
  const active = connect()
  // Соединения нет — лента живёт одним запросом истории. Это рабочий
  // режим, а не сбой: сообщения приходят с задержкой, но приходят.
  if (!active) return () => undefined

  refCount++
  active.on('chat:message', onMessage)
  // Модератор удалил реплику — убираем у всех, кто в эфире (28.10).
  if (onDeleted) active.on('chat:deleted', onDeleted)

  return () => {
    active.off('chat:message', onMessage)
    if (onDeleted) active.off('chat:deleted', onDeleted)
    refCount = Math.max(0, refCount - 1)
    if (refCount === 0) {
      active.disconnect()
      socket = null
    }
  }
}

/** Переключить комнату района. Молча ничего не делает без соединения. */
export function joinDistrict(district: string): void {
  lastDistrict = district
  socket?.emit('chat:district', district)
}

/** Вызвать при каждом (пере)подключении — чтобы дозагрузить пропущенное. */
export function onChatConnect(listener: () => void): () => void {
  reconnectListeners.add(listener)
  return () => { reconnectListeners.delete(listener) }
}
