// =============================================================
// Единая лента эфира: общий чат, бригада, личные сообщения и
// уведомления «Системы» — одной лентой, как в «Королях».
//
// Правка заказчика (октябрь 2026): «при нажатии на ник — обращение,
// ЛС, бригадный чат; общие — серым, ЛС и бригада — своими цветами;
// и на компьютере, и на телефоне». Каждый канал — свой запрос, живые
// реплики приходят по одному сокету и раскладываются по каналам.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { chatApi, type ChatChannel, type ChatFeed, type ChatLine } from '../api/chat.api'
import { charactersApi } from '../api/characters.api'
import { ApiError } from '../api/client'
import { onChatConnect, subscribeChat } from './chat-socket'

/** Куда пишет игрок. Район остался только на странице «Радио». */
export type EtherMode = 'GLOBAL' | 'CLAN' | 'PRIVATE'

const byTime = (a: ChatLine, b: ChatLine) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

function merge(messages: ChatLine[], line: ChatLine): ChatLine[] {
  if (messages.some(m => m.id === line.id)) return messages
  return [...messages, line].sort(byTime).slice(-50)
}

const feedKey = (channel: ChatChannel) => ['chat', channel, ''] as const

function useFeed(channel: ChatChannel, enabled: boolean) {
  return useQuery<ChatFeed>({
    queryKey: feedKey(channel),
    queryFn: () => chatApi.feed(channel),
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    // Страховка, если сокет молча отвалился.
    refetchInterval: 15_000,
    staleTime: 5_000,
  })
}

export interface Ether {
  messages: ChatLine[]
  me: { id: string; nickname: string } | null
  hasClan: boolean
  maxBody: number
  loading: boolean
  notice: string
  clearNotice: () => void
  send: (mode: EtherMode, body: string, to?: string) => Promise<boolean>
}

export function useEther(): Ether {
  const qc = useQueryClient()
  const [notice, setNotice] = useState('')
  const { data: char } = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), retry: false })
  const hasClan = !!char?.clan

  const global = useFeed('GLOBAL', true)
  const privateFeed = useFeed('PRIVATE', !!char)
  const clan = useFeed('CLAN', hasClan)
  const notices = useQuery({
    queryKey: ['chat', 'notices'], queryFn: chatApi.notices, retry: false,
    refetchInterval: 8_000, staleTime: 4_000,
  })

  useEffect(() => onChatConnect(() => { void qc.invalidateQueries({ queryKey: ['chat'] }) }), [qc])

  useEffect(() => subscribeChat(line => {
    if (line.channel === 'DISTRICT') return
    qc.setQueryData<ChatFeed>(feedKey(line.channel), prev => prev && { ...prev, messages: merge(prev.messages, line) })
  }), [qc])

  const send = useCallback(async (mode: EtherMode, body: string, to?: string) => {
    const text = body.trim()
    if (!text) return false
    try {
      const line = await chatApi.send(mode, text, undefined, mode === 'PRIVATE' ? to : undefined)
      qc.setQueryData<ChatFeed>(feedKey(mode), prev => prev && { ...prev, messages: merge(prev.messages, line) })
      setNotice('')
      return true
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'Сообщение не ушло.')
      return false
    }
  }, [qc])

  const messages = useMemo(() => {
    const system: ChatLine[] = (notices.data?.items ?? []).map(n => ({
      id: 'notice-' + n.id, channel: 'GLOBAL', scope: '', authorId: '', nickname: 'Система', level: 0,
      body: n.text, createdAt: n.createdAt, system: true,
    }))
    return [
      ...(global.data?.messages ?? []),
      ...(hasClan ? clan.data?.messages ?? [] : []),
      ...(privateFeed.data?.messages ?? []),
      ...system,
    ].sort(byTime).slice(-80)
  }, [global.data, clan.data, privateFeed.data, notices.data, hasClan])

  return {
    messages,
    me: char ? { id: char.id, nickname: char.nickname } : null,
    hasClan,
    maxBody: global.data?.limits?.maxBody ?? 400,
    loading: global.isLoading,
    notice,
    clearNotice: () => setNotice(''),
    send,
  }
}

/** Обращаются ли в строке к игроку: ник в тексте или личное ему. */
export function mentionsMe(line: ChatLine, me: { id: string; nickname: string } | null): boolean {
  if (!me || line.system || line.authorId === me.id) return false
  if (line.channel === 'PRIVATE') return true
  return line.body.toLocaleLowerCase('ru').includes(me.nickname.toLocaleLowerCase('ru'))
}
