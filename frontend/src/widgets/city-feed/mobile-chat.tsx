// =============================================================
// Чат и онлайн для мобильной шторки. Источник тот же, что на большом
// экране: /api/chat плюс живые реплики сокетом. Отдельного мобильного
// канала нет — окна разные, эфир один.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { clansApi } from '../../shared/api/clans.api'
import { useOnline } from '../../shared/lib/use-chat'
import { useEther } from '../../shared/lib/use-ether'
import { EtherComposer, EtherLine, useComposer } from '../chat/ether'
import { levelTone } from '../../shared/lib/chat-format'

export function MobileChat() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'chat' | 'online'>('chat')

  // Та же лента, что на большом экране: общий, бригада, личные.
  const ether = useEther()
  const composer = useComposer(ether)
  const online = useOnline()
  // Лента открывается на последних сообщениях, а не на самых старых.
  const logRef = useRef<HTMLDivElement>(null)
  const lastId = ether.messages[ether.messages.length - 1]?.id
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId, tab])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const players = online
    .map(p => ({ ...p, self: p.characterId === char?.id }))
    .sort((a, b) => Number(b.self) - Number(a.self))

  return (
    <div className="m-chat">
      <div className="m-chat__tabs">
        <button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>
          Чат
        </button>
        <button type="button" className={tab === 'online' ? 'is-active' : ''} onClick={() => setTab('online')}>
          Онлайн: {players.length}
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="m-chat__log" ref={logRef}>
            {ether.messages.map(m => <EtherLine key={m.id} line={m} ether={ether} composer={composer} className="m-chat__row" />)}
            {!ether.loading && !ether.messages.length && (
              <div className="m-chat__row">В эфире тихо. Скажите первое слово.</div>
            )}
          </div>
          <EtherComposer ether={ether} composer={composer} className="m-chat__form" />
        </>
      ) : (
        <div className="m-chat__online">
          {players.map(p => (
            <button
              key={p.characterId}
              type="button"
              className={'m-chat__player' + (p.self ? ' is-self' : '')}
              onClick={() => navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nickname)}`)}
            >
              <span>{p.clan?.iconVersion ? <img className="clan-icon" src={clansApi.iconUrl(p.clan.id, p.clan.iconVersion)} alt="" width={16} height={16} /> : null} {p.nickname}</span>
              <b className={`online-list__lvl online-list__lvl--${p.self ? 'o' : levelTone(p.level)}`}>{p.level}</b>
            </button>
          ))}
          {!players.length && <div className="m-chat__row">В эфире пусто.</div>}
        </div>
      )}
    </div>
  )
}
