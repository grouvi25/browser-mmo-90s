// =============================================================
// Чат боевого экрана.
//
// Макет рисует его внизу: плашка сообщений 0…633 по ширине и список
// онлайна справа. Лента настоящая — общий канал эфира: в бою игрок не
// в районе, и разговаривать ему логично со всем городом.
//
// Чат по умолчанию свёрнут: сцена от этого короче, а значит крупнее —
// поле, панели бойцов и журнал получают всё освободившееся место.
// Развёрнутый чат НИЧЕГО не двигает: сцена остаётся той же высоты, а
// панель всплывает от нижнего края поверх журнала, как шторка.
// =============================================================
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { chatTime, levelTone } from '../../../shared/lib/chat-format'
import { nickTone, useChat, useOnline } from '../../../shared/lib/use-chat'

/** Высота сцены боя. Постоянная: и со свёрнутым чатом, и с развёрнутым.
 *  Раньше открытый чат растягивал сцену до 1600, и вся вёрстка ужималась
 *  под окно — контент прыгал при каждом переключении. */
export const BATTLE_SCENE_H = 1312

export function BattleChat({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [draft, setDraft] = useState('')
  // В бою игрок не в районе, поэтому здесь общий канал: во время
  // схватки нужен весь город, а не соседи по кварталу.
  const chat = useChat('GLOBAL')
  const online = useOnline()
  const feedRef = useRef<HTMLDivElement>(null)

  // Лента прокручивается к последней реплике — иначе новое сообщение
  // приходит за нижний край и его не видно, пока не долистаешь.
  useEffect(() => {
    const box = feedRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [chat.messages, open])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (await chat.send(draft)) setDraft('')
  }

  return (
    <section className={`bs-chat${open ? ' is-open' : ''}`} aria-label="Чат">
      <button
        type="button"
        className="bs-chat__toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? 'Свернуть чат' : 'Чат'}
      </button>

      {open && (
        <div className="bs-chat__body">
          <div className="bs-chat__side">
            <div className="bs-chat__feed" ref={feedRef}>
              {chat.messages.map(message => (
                <p key={message.id} className="bs-chat__row">
                  <span className="bs-chat__time">[{chatTime(message.createdAt)}]</span>{' '}
                  <span className={`bs-chat__nick city-chat__nick--${nickTone(message.nickname)}`}>
                    {message.nickname}:
                  </span>{' '}
                  {message.body}
                </p>
              ))}
              {!chat.loading && !chat.messages.length && (
                <p className="bs-chat__row">В эфире тихо.</p>
              )}
            </div>

            <form className="bs-chat__form" onSubmit={send}>
              <input
                value={draft}
                onChange={e => { setDraft(e.target.value); if (chat.notice) chat.clearNotice() }}
                placeholder={chat.notice || 'Написать в общий чат…'}
                maxLength={chat.maxBody}
                spellCheck={false}
                aria-label="Написать в общий чат"
              />
            </form>
          </div>

          <div className="bs-chat__online">
            <div className="bs-chat__online-title">Игроки онлайн: {online.length}</div>
            <ul>
              {online.map(player => (
                <li key={player.characterId}>
                  <span>{player.nickname}</span>
                  <b className={`online-lvl online-lvl--${levelTone(player.level)}`}>{player.level}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
