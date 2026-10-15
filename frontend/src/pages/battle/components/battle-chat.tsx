// =============================================================
// Чат боевого экрана.
//
// Макет рисует его внизу: плашка сообщений 0…633 по ширине и список
// онлайна справа. Лента настоящая — общий канал эфира: в бою игрок не
// в районе, и разговаривать ему логично со всем городом.
//
// Чат всегда открыт и стоит своей полосой под сценой: заказчик просил
// статичный чат, а свёрнутая шторка в бою читалась как непонятная кнопка.
// =============================================================
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { chatTime, levelTone } from '../../../shared/lib/chat-format'
import { nickTone, useChat, useOnline } from '../../../shared/lib/use-chat'

/** Высота сцены боя. Постоянная: и со свёрнутым чатом, и с развёрнутым.
 *  Раньше открытый чат растягивал сцену до 1600, и вся вёрстка ужималась
 *  под окно — контент прыгал при каждом переключении. */
export const BATTLE_SCENE_H = 1312

/** Высота полосы чата под сценой, в настоящих пикселях. */
export const BATTLE_CHAT_H = 170

export function BattleChat() {
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
  }, [chat.messages])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (await chat.send(draft)) setDraft('')
  }

  return (
    <section className="bs-chat" style={{ height: BATTLE_CHAT_H }} aria-label="Общий чат города">
      <div className="bs-chat__title">Общий чат города — его видят все игроки, и в бою, и на улицах</div>
        <div className="bs-chat__body">
          <div className="bs-chat__side">
            <div className="bs-chat__feed" ref={feedRef} tabIndex={0} role="log" aria-label="Сообщения общего чата">
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

          <div className="bs-chat__online" tabIndex={0} role="region" aria-label="Игроки онлайн">
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
    </section>
  )
}
