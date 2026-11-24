// =============================================================
// Чат и онлайн для мобильной шторки. Источник тот же, что на большом
// экране: /api/chat плюс живые реплики сокетом. Отдельного мобильного
// канала нет — окна разные, эфир один.
// =============================================================
import { AmbushButton } from '../ambush/ambush-button'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import type { OnlinePlayer } from '../../shared/api/chat.api'
import { clansApi } from '../../shared/api/clans.api'
import { useOnline } from '../../shared/lib/use-chat'
import { useEther } from '../../shared/lib/use-ether'
import { EarlierButton, EtherComposer, EtherLine, OnlineRefresh, PrivateArrow, mentionPlayer, onMentionPlayer, onWritePrivately, useChatScroll, useComposer } from '../chat/ether'
import { levelTone } from '../../shared/lib/chat-format'
import { ResidentProfileDialog } from './resident-profile-dialog'

export function MobileChat() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'chat' | 'online'>('chat')
  const [selectedPlayer, setSelectedPlayer] = useState<OnlinePlayer | null>(null)

  // Та же лента, что на большом экране: общий, бригада, личные.
  const ether = useEther()
  const composer = useComposer(ether)
  const online = useOnline()
  // Стрелочка у ника во вкладке «Онлайн» открывает личку — переходим в чат.
  useEffect(() => onWritePrivately(() => setTab('chat')), [])
  useEffect(() => onMentionPlayer(() => setTab('chat')), [])
  // Лента открывается на последних сообщениях, а не на самых старых.
  const { boxRef, onScroll } = useChatScroll(ether.messages, tab === 'chat')

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
          <div className="m-chat__log" ref={boxRef} onScroll={onScroll} role="log" aria-label="Чат города" tabIndex={0}>
            <EarlierButton ether={ether} boxRef={boxRef} className="m-chat__row" />
            {ether.messages.map(m => <EtherLine key={m.id} line={m} ether={ether} composer={composer} className="m-chat__row" />)}
            {!ether.loading && !ether.messages.length && (
              <div className="m-chat__row">В эфире тихо. Скажите первое слово.</div>
            )}
          </div>
          <EtherComposer ether={ether} composer={composer} className="m-chat__form" />
        </>
      ) : (
        <div className="m-chat__online">
          <div className="m-chat__refresh"><OnlineRefresh /></div>
          {players.map(p => (
            <div key={p.characterId} className="m-chat__player-row">
              {!p.self && !p.resident && <PrivateArrow nick={p.nickname} />}
              {!p.self && <AmbushButton player={p} />}
              {!p.self && !p.resident && (
                <button type="button" className="m-chat__mention" aria-label={`Обратиться в чате: ${p.nickname}`}
                  title="Обратиться к игроку в чате" onClick={() => mentionPlayer(p.nickname)}>@</button>
              )}
              <button
                type="button"
                className={'m-chat__player' + (p.self ? ' is-self' : '')}
                onClick={() => p.resident ? setSelectedPlayer(p) : navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nickname)}`)}
              >
                <span>{p.clan?.iconVersion ? <img className="clan-icon" src={clansApi.iconUrl(p.clan.id, p.clan.iconVersion)} alt="" width={16} height={16} /> : null} {p.nickname}</span>
                <b className={`online-list__lvl online-list__lvl--${p.self ? 'o' : levelTone(p.level)}`}>{p.level}</b>
              </button>
            </div>
          ))}
          {!players.length && <div className="m-chat__row">В эфире пусто.</div>}
        </div>
      )}
      {selectedPlayer?.resident && <ResidentProfileDialog nickname={selectedPlayer.nickname} level={selectedPlayer.level}
        profile={selectedPlayer.resident} onClose={() => setSelectedPlayer(null)} />}
    </div>
  )
}
