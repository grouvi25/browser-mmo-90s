// =============================================================
// Чат района и список онлайна.
//
// Данные настоящие: лента приходит из /api/chat, живые реплики —
// сокетом, присутствие — из общего списка эфира. Демонстрационные
// массивы, что стояли тут до появления модуля чата, убраны.
// =============================================================
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { districtKey } from '../city-nav/city-nav'
import { nickTone, useChat, useOnline } from '../../shared/lib/use-chat'
import { chatTime, levelTone } from '../../shared/lib/chat-format'
import { MENU, MENU_GAME_H, MENU_STAGE } from '../../shared/lib/layout-map'
import { useFitBlock } from '../../shared/lib/use-fit-block'
import { PLATES } from '../../shared/ui/sprite'

export interface ChatMessage {
  id: string
  time: string
  nick: string
  tone: 1 | 2 | 3 | 4
  text: string
  own?: boolean
}

export interface OnlinePlayer {
  nick: string
  level: number
  tone: 'r' | 'c' | 'o'
  self?: boolean
}

// ── Выдвижная полоса чата ────────────────────────────────────

const CHAT_OPEN_KEY = 'mmo_chat_open'

/** Высота язычка в координатах сцены. У свёрнутого чата он встаёт на
    679…705 — в свободное поле между нижним рядом комнат (кончается на 651)
    и краем сцены, поэтому свёрнутый чат не закрывает собой ничего. */
const CHAT_TAB_H = 26

/**
 * Чат и онлайн — одной выдвижной полосой поверх сцены.
 *
 * Раньше они занимали нижнюю пятую часть холста постоянно, и сцена
 * из-за них считалась по высоте 900 вместо 705 — то есть весь остальной
 * интерфейс рисовался мельче ради демонстрационной ленты.
 *
 * Полоса лежит НАД сценой и при развороте перекрывает низ вьюпорта, а не
 * раздвигает разметку: сцена остаётся той же высоты в обоих состояниях,
 * поэтому от открытия чата ничего не прыгает и не мельчает.
 *
 * Рисунок полосы — тот же вырез из общей подложки, что у шапки и
 * карточки (см. nav-cutout): внутри лежит полный холст 1550x900,
 * сдвинутый так, чтобы полоса чата встала в начало координат. Ни второй
 * картинки, ни второй вёрстки чата не появляется.
 */
export function CityChatDock() {
  const [open, setOpen] = useState(false)

  // По умолчанию свёрнут; открытый чат запоминается, чтобы не
  // раскрывать его заново на каждом переходе между разделами.
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(CHAT_OPEN_KEY) === '1')
    } catch {
      // приватный режим — остаёмся на свёрнутом по умолчанию
    }
  }, [])

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev
      try { localStorage.setItem(CHAT_OPEN_KEY, next ? '1' : '0') } catch { /* см. выше */ }
      return next
    })
  }, [])

  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  const panel = MENU.chatPanel

  return (
    <div
      className={'chat-dock' + (open ? ' is-open' : '')}
      style={{
        left: panel.x, top: MENU_GAME_H - panel.h,
        width: panel.w, height: panel.h,
        // Свёрнутая полоса уходит за нижний край сцены целиком — её
        // обрезает overflow сцены. Видимым остаётся только язычок: он
        // висит НАД полосой (bottom: 100%) и уезжает вместе с ней ровно
        // на её высоту, то есть встаёт впритык к нижнему краю.
        transform: open ? 'translateY(0)' : `translateY(${panel.h}px)`,
      }}
    >
      <button
        type="button"
        className="chat-dock__tab"
        style={{ height: CHAT_TAB_H }}
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Свернуть чат' : 'Развернуть чат района'}
      >
        {open ? '▼ свернуть чат' : '▲ чат района'}
      </button>

      {/* Скрытие свёрнутой полосы делает CSS через visibility: aria-hidden
          здесь ставить нельзя — внутри остаются поле ввода и кликабельные
          ники, а спрятанный от скринридера фокусируемый элемент это
          нарушение (axe: aria-hidden-focus). */}
      <div className="chat-dock__window" style={{ height: panel.h }}>
        <div
          className="chat-dock__inner"
          style={{
            width: MENU_STAGE.w, height: MENU_STAGE.h,
            transform: `translateY(${-panel.y}px)`,
          }}
        >
          <div className="stage__plate" style={{ backgroundImage: plate }} />
          <CityChat />
          <OnlineList />
        </div>
      </div>
    </div>
  )
}

// ── Чат ──────────────────────────────────────────────────────
export function CityChat() {
  const navigate = useNavigate()
  const location = useLocation()
  const [draft, setDraft] = useState('')

  // Полоса внизу — чат района, и район берётся из текущего адреса:
  // игрок ходит по городу, а окно чата остаётся тем же.
  const district = districtKey(location.pathname + location.search) || 'center'
  const chat = useChat('DISTRICT', district)

  const boxRef = useRef<HTMLDivElement>(null)
  useFitBlock(boxRef, MENU.chat.w, [chat.messages])

  const send = async (e: FormEvent) => {
    e.preventDefault()
    // Поле очищаем только если реплика ушла: при отказе антифлуда
    // набранное остаётся, чтобы не печатать заново.
    if (await chat.send(draft)) setDraft('')
  }

  const shown = chat.messages.slice(-MENU.chat.rows)

  return (
    <>
      <div
        ref={boxRef}
        className="city-chat"
        style={{
          left: MENU.chat.x, top: MENU.chat.y,
          fontSize: MENU.chat.size, lineHeight: `${MENU.chat.lineHeight}px`,
        }}
        title="Чат района"
      >
        {shown.map(m => (
          <div key={m.id} className="city-chat__row">
            <span className="city-chat__time">[{chatTime(m.createdAt)}]</span>{' '}
            <span
              className={`city-chat__nick city-chat__nick--${nickTone(m.nickname)}`}
              onClick={() => navigate(`/u/${encodeURIComponent(m.nickname)}`)}
            >
              {m.nickname}:
            </span>{' '}
            {m.body}
          </div>
        ))}
        {!chat.loading && !shown.length && (
          <div className="city-chat__row city-chat__empty">В районе тихо. Скажите первое слово.</div>
        )}
      </div>

      <form onSubmit={send}>
        <input
          className="chat-input"
          style={{
            left: MENU.chatInput.x, top: MENU.chatInput.y,
            width: MENU.chatInput.w, height: MENU.chatInput.h,
            fontSize: MENU.chat.size,
          }}
          value={draft}
          onChange={e => { setDraft(e.target.value); if (chat.notice) chat.clearNotice() }}
          placeholder={chat.notice || 'Написать в чат района…'}
          maxLength={chat.maxBody}
          spellCheck={false}
          aria-label="Написать в чат района"
        />
      </form>
    </>
  )
}

// ── Онлайн ───────────────────────────────────────────────────
export function OnlineList() {
  const navigate = useNavigate()
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const listRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  // Себя сервер тоже отдаёт в списке — он отмечает присутствие на любом
  // обращении к эфиру. Поднимаем свою строку наверх и красим отдельно.
  const online = useOnline()
  const players: OnlinePlayer[] = online.map(p => ({
    nick: p.nickname,
    level: p.level,
    tone: p.characterId === char?.id ? 'o' : levelTone(p.level),
    self: p.characterId === char?.id,
  }))
  players.sort((a, b) => Number(b.self ?? false) - Number(a.self ?? false))

  const shown = players.slice(0, 9)

  // Ник и уровень идут одной строкой: при подмене шрифта они больше
  // не расходятся и не налезают друг на друга, как при абсолютных позициях.
  useFitBlock(listRef, MENU.onlineList.w + 60, [shown.length, char?.nickname])
  useFitBlock(titleRef, MENU.onlineTitle.w, [players.length])

  return (
    <>
      <div
        ref={titleRef}
        className="online-title"
        style={{ left: MENU.onlineTitle.x, top: MENU.onlineTitle.y, fontSize: MENU.onlineTitle.size }}
        title="Присутствие подключается в Этапе 3 — список демонстрационный"
      >
        Игроки онлайн: {players.length}
      </div>

      <div
        ref={listRef}
        className="online-list"
        style={{
          left: MENU.onlineList.x, top: MENU.onlineList.y,
          fontSize: MENU.onlineList.size, lineHeight: `${MENU.onlineList.lineHeight}px`,
        }}
      >
        {shown.map(p => (
          <div
            key={p.nick}
            className={'online-list__row' + (p.self ? ' is-self' : '')}
            onClick={() => navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nick)}`)}
            title={p.self ? 'Это вы — открыть личное дело' : `Открыть профиль ${p.nick}`}
          >
            <span className="online-list__nick">{p.nick}</span>
            <span className={`online-lvl online-lvl--${p.tone}`}>{p.level}</span>
          </div>
        ))}
      </div>
    </>
  )
}
