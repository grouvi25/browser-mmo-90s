// =============================================================
// Чат района и список онлайна.
//
// Лента приходит из /api/chat, живые реплики — сокетом, присутствие
// игроков и городских персонажей — из общего списка эфира.
// =============================================================
import { AmbushButton } from '../ambush/ambush-button'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import type { OnlinePlayer } from '../../shared/api/chat.api'
import { clansApi } from '../../shared/api/clans.api'
import { useOnline } from '../../shared/lib/use-chat'
import { useEther } from '../../shared/lib/use-ether'
import { EarlierButton, EtherComposer, EtherLine, OnlineRefresh, PrivateArrow, mentionPlayer, useChatScroll, useComposer } from '../chat/ether'
import { levelTone } from '../../shared/lib/chat-format'
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { useFitBlock } from '../../shared/lib/use-fit-block'
import { PLATES } from '../../shared/ui/sprite'
import { ResidentProfileDialog } from './resident-profile-dialog'

export interface ChatMessage {
  id: string
  time: string
  nick: string
  tone: 1 | 2 | 3 | 4
  text: string
  own?: boolean
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
          {/* На подложке запечены девять демонстрационных конвертов и фигур.
              Закрываем только их полоску чистой бумагой; реальные строки — ниже. */}
          <div className="online-list-paper" aria-hidden="true" style={{
            left: 1155, top: 729, width: 53, height: 161,
            backgroundImage: `url("${PLATES['online-list-paper']}")`,
          }} />
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

  const { boxRef, onScroll } = useChatScroll(ether.messages)

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
        <EarlierButton ether={ether} boxRef={boxRef} className="city-chat__row" />
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
/** Окно списка на нарисованной панели: от левого края строк до её рамки. */
const ONLINE_LIST_BOX = { w: 320, rows: 9 }

export function OnlineList() {
  const navigate = useNavigate()
  const [selectedPlayer, setSelectedPlayer] = useState<OnlinePlayer | null>(null)
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
  const players = online.map(p => ({
    ...p,
    tone: p.characterId === char?.id ? 'o' : levelTone(p.level),
    self: p.characterId === char?.id,
  }))
  players.sort((a, b) => Number(b.self) - Number(a.self))

  // Ник и уровень идут одной строкой: при подмене шрифта они больше
  // не расходятся и не налезают друг на друга, как при абсолютных позициях.
  useFitBlock(listRef, MENU.onlineList.w + 60, [players.length, char?.nickname])
  useFitBlock(titleRef, MENU.onlineTitle.w, [players.length])

  return (
    <>
      <div
        ref={titleRef}
        className="online-title"
        style={{ left: MENU.onlineTitle.x, top: MENU.onlineTitle.y, fontSize: MENU.onlineTitle.size }}
        title="Участники общего эфира"
      >
        Игроки онлайн: {players.length} <OnlineRefresh />
      </div>

      {/* Видно девять строк, остальные листаются (обращение №25: из 13 игроков
          было видно 9). Ширину ужимает внутренний блок, прокрутка стоит снаружи
          и потому не ездит вслед за самым длинным ником. */}
      <div
        className="online-list-scroll"
        tabIndex={0}
        role="group"
        aria-label="Игроки онлайн"
        style={{
          left: MENU.onlineList.x, top: MENU.onlineList.y,
          width: ONLINE_LIST_BOX.w, height: ONLINE_LIST_BOX.rows * MENU.onlineList.lineHeight,
        }}
      >
      <div
        ref={listRef}
        className="online-list"
        style={{ fontSize: MENU.onlineList.size, lineHeight: `${MENU.onlineList.lineHeight}px` }}
      >
        {players.map(p => (
          <div
            key={p.characterId}
            className={'online-list__row' + (p.self ? ' is-self' : '')}
            onClick={() => p.resident ? setSelectedPlayer(p) : navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nickname)}`)}
            title={p.self ? 'Это вы — открыть личное дело' : `Открыть профиль ${p.nickname}`}
          >
            {p.clan?.iconVersion ? <img className="clan-icon" src={clansApi.iconUrl(p.clan.id, p.clan.iconVersion)} alt="" title={`Бригада «${p.clan.name}»`} width={14} height={14} /> : null}
            {!p.self && !p.resident && <PrivateArrow nick={p.nickname} />}
            {!p.self && <AmbushButton player={p} />}
            {p.self
              ? <span className="online-list__nick">{p.nickname}</span>
              : <button type="button" className="online-list__nick" title={p.resident ? 'Открыть профиль' : 'Обратиться к игроку в чате'}
                  onClick={event => {
                    event.stopPropagation()
                    if (p.resident) setSelectedPlayer(p)
                    else mentionPlayer(p.nickname)
                  }}>{p.nickname}</button>}
            <span className={`online-lvl online-lvl--${p.tone}`}>{p.level}</span>
          </div>
        ))}
      </div>
      </div>
      {selectedPlayer?.resident && <ResidentProfileDialog nickname={selectedPlayer.nickname} level={selectedPlayer.level}
        profile={selectedPlayer.resident} onClose={() => setSelectedPlayer(null)} />}
    </>
  )
}
