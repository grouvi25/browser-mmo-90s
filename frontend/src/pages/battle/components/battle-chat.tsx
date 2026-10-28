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
import { useEffect, useRef } from 'react'

import { levelTone } from '../../../shared/lib/chat-format'
import { clansApi } from '../../../shared/api/clans.api'
import { useOnline } from '../../../shared/lib/use-chat'
import { useEther } from '../../../shared/lib/use-ether'
import { EtherComposer, EtherLine, PrivateArrow, useComposer } from '../../../widgets/chat/ether'

/** Высота сцены боя. Постоянная: и со свёрнутым чатом, и с развёрнутым.
 *  Раньше открытый чат растягивал сцену до 1600, и вся вёрстка ужималась
 *  под окно — контент прыгал при каждом переключении. */
export const BATTLE_SCENE_H = 1312

/** Высота полосы чата под сценой, в настоящих пикселях. */
export const BATTLE_CHAT_H = 170

export function BattleChat() {
  // Та же лента, что в городе: общий, бригада, личные.
  const ether = useEther()
  const composer = useComposer(ether)
  const online = useOnline()
  const feedRef = useRef<HTMLDivElement>(null)

  // Лента прокручивается к последней реплике — иначе новое сообщение
  // приходит за нижний край и его не видно, пока не долистаешь.
  useEffect(() => {
    const box = feedRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [ether.messages])

  return (
    <section className="bs-chat" style={{ height: BATTLE_CHAT_H }} aria-label="Чат города">
      <div className="bs-chat__title">Чат города: общий, бригада и личные сообщения</div>
        <div className="bs-chat__body">
          <div className="bs-chat__side">
            <div className="bs-chat__feed" ref={feedRef} tabIndex={0} role="log" aria-label="Сообщения общего чата">
              {ether.messages.map(m => <EtherLine key={m.id} line={m} ether={ether} composer={composer} className="bs-chat__row" />)}
              {!ether.loading && !ether.messages.length && (
                <p className="bs-chat__row">В эфире тихо.</p>
              )}
            </div>

            <EtherComposer ether={ether} composer={composer} className="bs-chat__form" />
          </div>

          <div className="bs-chat__online" tabIndex={0} role="region" aria-label="Игроки онлайн">
            <div className="bs-chat__online-title">Игроки онлайн: {online.length}</div>
            <ul>
              {online.map(player => (
                <li key={player.characterId}>
                  <span>{player.characterId !== ether.me?.id && <PrivateArrow nick={player.nickname} />}{player.clan?.iconVersion ? <img className="clan-icon" src={clansApi.iconUrl(player.clan.id, player.clan.iconVersion)} alt="" width={14} height={14} /> : null} {player.nickname}</span>
                  <b className={`online-lvl online-lvl--${levelTone(player.level)}`}>{player.level}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
    </section>
  )
}
