// =============================================================
// Чат района и список онлайна.
//
// Данные настоящие: лента приходит из /api/chat, живые реплики —
// сокетом, присутствие — из общего списка эфира. Демонстрационные
// массивы, что стояли тут до появления модуля чата, убраны.
// =============================================================
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { clansApi } from '../../shared/api/clans.api'
import { useOnline } from '../../shared/lib/use-chat'
import { useEther } from '../../shared/lib/use-ether'
import { EtherComposer, EtherLine, useComposer } from '../chat/ether'
import { levelTone } from '../../shared/lib/chat-format'
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
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
  clan?: { id: string; name: string; iconVersion: number } | null
}

// ── Выдвижная полоса чата ────────────────────────────────────



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
  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  const panel = MENU.chatPanel

  return (
    <div
      className="chat-dock is-open"
      style={{
        // Полоса стоит там, где её нарисовал художник, — ниже игровой
        // части. Свёрнутой она не прячется сдвигом: сцена становится
        // короче ровно на её высоту и обрезает полосу сама. Поэтому чат
        // и не налезает на интерфейс ни в одном из состояний.
        left: panel.x, top: panel.y,
        width: panel.w, height: panel.h,
      }}
    >
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
  // Одна лента: общий чат, бригада, личные и уведомления — как в «Королях».
  const ether = useEther()
  const composer = useComposer(ether)

  const boxRef = useRef<HTMLDivElement>(null)
  // К новому сообщению прокручиваем, только если игрок и так внизу.
  // Раньше прокрутка сбрасывалась при каждом опросе чата, и пролистать
  // назад было нельзя: через секунды выдёргивало вниз.
  const lastId = ether.messages[ether.messages.length - 1]?.id
  const stuckToBottom = useRef(true)
  useEffect(() => {
    const el = boxRef.current
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight
  }, [lastId])
  const onScroll = () => {
    const el = boxRef.current
    if (el) stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <>
      <div
        ref={boxRef}
        className="city-chat"
        onScroll={onScroll}
        // Чат прокручивается — значит, должен листаться и с клавиатуры.
        tabIndex={0}
        role="log"
        aria-label="Чат города"
        style={{
          left: MENU.chat.x, top: MENU.chat.y, width: MENU.chat.w, height: MENU.chat.h,
          fontSize: MENU.chat.size, lineHeight: `${MENU.chat.lineHeight}px`,
        }}
      >
        {ether.messages.map(m => <EtherLine key={m.id} line={m} ether={ether} composer={composer} className="city-chat__row" />)}
        {!ether.loading && !ether.messages.length && (
          <div className="city-chat__row city-chat__empty">В эфире тихо. Скажите первое слово.</div>
        )}
      </div>

      <EtherComposer ether={ether} composer={composer} className="ether-composer--city" style={{
        // Строка ввода стоит ровно в нарисованной рамке поля (правка заказчика
        // 21.10: «вкладка для переключения кривая, ровно сделать»): рамка на
        // подложке начинается на 12 px левее текстовой области и выше её на 3.
        left: MENU.chatInput.x - 11, top: MENU.chatInput.y - 2,
        width: MENU.chatInput.w + 11, height: MENU.chatInput.h + 2,
        fontSize: MENU.chat.size - 2,
      }} />
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
    clan: p.clan,
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
            {p.clan?.iconVersion ? <img className="clan-icon" src={clansApi.iconUrl(p.clan.id, p.clan.iconVersion)} alt="" title={`Бригада «${p.clan.name}»`} width={14} height={14} /> : null}
            <span className="online-list__nick">{p.nick}</span>
            <span className={`online-lvl online-lvl--${p.tone}`}>{p.level}</span>
          </div>
        ))}
      </div>
    </>
  )
}
