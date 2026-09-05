// =============================================================
// Эфир для любого места, где он показывается.
//
// Полоса внизу города, шторка боя и страница «Радио» читают один и тот
// же канал одним хуком: лента приходит запросом, дальше живые реплики
// добираются сокетом. Иначе у трёх окон разъезжалась бы история.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { chatApi, type ChatChannel, type ChatFeed, type ChatLine } from '../api/chat.api'
import { ApiError } from '../api/client'
import { joinDistrict, subscribeChat } from './chat-socket'

/**
 * Цвет ника. В макете реплики разноцветные, но цвет там ничего не
 * значит — это оформление. Берём его от самого ника, чтобы за игроком
 * держался один и тот же оттенок во всех окнах и между заходами.
 */
export function nickTone(nick: string): 1 | 2 | 3 | 4 {
  let hash = 0
  for (let i = 0; i < nick.length; i++) hash = (hash * 31 + nick.charCodeAt(i)) % 997
  return ((hash % 4) + 1) as 1 | 2 | 3 | 4
}

export interface ChatState {
  messages: ChatLine[]
  /** Комната, которую выбрал сервер: для клана она приходит только так. */
  scope: string
  maxBody: number
  loading: boolean
  /** Почему последняя реплика не ушла. Подсказка, а не ошибка. */
  notice: string
  send: (body: string) => Promise<boolean>
  clearNotice: () => void
}

export function useChat(channel: ChatChannel, district?: string): ChatState {
  const qc = useQueryClient()
  const key = useMemo(() => ['chat', channel, district ?? ''], [channel, district])
  const [notice, setNotice] = useState('')

  const { data, isLoading } = useQuery<ChatFeed>({
    queryKey: key,
    queryFn: () => chatApi.feed(channel, district),
    retry: false,
    // Лента живёт сокетом; запрос нужен, чтобы поднять историю при
    // входе и восстановить её, если соединение обрывалось.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const scope = data?.scope ?? ''

  // Комната района меняется при ходьбе по городу — сообщаем серверу.
  useEffect(() => {
    if (channel === 'DISTRICT' && district) joinDistrict(district)
  }, [channel, district])

  useEffect(() => {
    return subscribeChat(line => {
      if (line.channel !== channel) return
      // Своя комната: для района сверяем ключ, для клана — тот, что
      // назвал сервер. Общий канал один, сверять нечего.
      if (channel !== 'GLOBAL' && line.scope !== scope) return
      qc.setQueryData<ChatFeed>(key, prev => {
        if (!prev) return prev
        // Своя же реплика приходит и ответом, и рассылкой — не двоим.
        if (prev.messages.some(m => m.id === line.id)) return prev
        return { ...prev, messages: [...prev.messages, line].slice(-50) }
      })
    })
  }, [qc, key, channel, scope])

  const send = useCallback(async (body: string) => {
    const text = body.trim()
    if (!text) return false
    try {
      const line = await chatApi.send(channel, text, district)
      qc.setQueryData<ChatFeed>(key, prev => {
        if (!prev) return prev
        if (prev.messages.some(m => m.id === line.id)) return prev
        return { ...prev, messages: [...prev.messages, line].slice(-50) }
      })
      setNotice('')
      return true
    } catch (error) {
      // 429 — это темп разговора, а не сбой: показываем подсказку и
      // оставляем набранное в поле, чтобы не перенабирать.
      setNotice(error instanceof ApiError ? error.message : 'Сообщение не ушло.')
      return false
    }
  }, [channel, district, key, qc])

  return {
    messages: data?.messages ?? [],
    scope,
    maxBody: data?.limits.maxBody ?? 400,
    loading: isLoading,
    notice,
    send,
    clearNotice: () => setNotice(''),
  }
}

/** Кто сейчас в эфире. Отдельно от ленты: список общий на всю игру. */
export function useOnline() {
  const { data } = useQuery({
    queryKey: ['chat', 'online'],
    queryFn: () => chatApi.online(),
    retry: false,
    refetchInterval: 30_000,
  })
  return data?.players ?? []
}
