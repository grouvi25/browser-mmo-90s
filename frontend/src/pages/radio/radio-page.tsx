// =============================================================
// «Радио» — полная комната эфира.
//
// Полоса внизу города показывает только свой район и только последние
// строки: там на неё отведено пять рядов макета. Здесь тот же эфир во
// весь вьюпорт, с переключением каналов и списком тех, кто на связи.
// Данные общие — хук useChat один на все окна, поэтому история в
// городе и здесь всегда одна и та же.
// =============================================================
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { districtKey } from '../../widgets/city-nav/city-nav'
import { chatTime, levelTone } from '../../shared/lib/chat-format'
import { nickTone, useChat, useOnline } from '../../shared/lib/use-chat'
import type { ChatChannel } from '../../shared/api/chat.api'
import { AnnouncementsFeed } from './announcements-feed'
import './radio.css'

const DISTRICT_NAMES: Record<string, string> = {
  center: 'Центр', market: 'Рынок', industrial: 'Промзона',
  garages: 'Гаражи', suburb: 'Спальный район', station: 'Вокзал',
}

export function RadioPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // Четвёртая вкладка — не канал эфира, а доска объявлений, поэтому
  // состояние одно на оба вида: они занимают одно и то же место.
  const [tab, setTab] = useState<ChatChannel | 'BOARD'>('GLOBAL')
  const channel: ChatChannel = tab === 'BOARD' ? 'GLOBAL' : tab
  const [draft, setDraft] = useState('')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  // Район берём из последнего городского адреса — но на самой странице
  // радио адрес уже /radio, и districtKey вернёт «центр». Это верно:
  // из радиорубки слышен тот район, где стоит игрок, а стоит он в центре.
  const district = districtKey(location.pathname) || 'center'
  const chat = useChat(channel, channel === 'DISTRICT' ? district : undefined)
  const online = useOnline()

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (await chat.send(draft)) setDraft('')
  }

  const tabs: { key: ChatChannel | 'BOARD'; label: string; hint: string }[] = [
    { key: 'GLOBAL', label: 'Общая волна', hint: 'Слышно всему городу' },
    { key: 'DISTRICT', label: DISTRICT_NAMES[district] ?? 'Район', hint: 'Только свой район' },
    { key: 'CLAN', label: 'Бригада', hint: 'Только своим' },
    { key: 'BOARD', label: 'Объявления', hint: 'Что говорит город' },
  ]

  return (
    <div className="radio">
      <header className="radio__head">
        <h1>Радио</h1>
        <span>Эфир города</span>
        <button type="button" className="radio__back" onClick={() => navigate('/')}>← в город</button>
      </header>

      <nav className="radio__tabs" aria-label="Каналы эфира">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => setTab(item.key)}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="radio__body">
        <section className="radio__feed" aria-label={tab === 'BOARD' ? 'Объявления' : 'Лента эфира'}>
          {tab === 'BOARD' ? (
            <AnnouncementsFeed empty="Город пока молчит." />
          ) : (
            <>
              {chat.messages.map(message => (
                <p key={message.id} className="radio__row">
                  <span className="radio__time">[{chatTime(message.createdAt)}]</span>{' '}
                  <span
                    className={`radio__nick city-chat__nick--${nickTone(message.nickname)}`}
                    onClick={() => navigate(`/u/${encodeURIComponent(message.nickname)}`)}
                  >
                    {message.nickname}:
                  </span>{' '}
                  {message.body}
                </p>
              ))}

              {!chat.loading && !chat.messages.length && (
                <p className="radio__empty">
                  {channel === 'CLAN'
                    ? 'Своей волны нет: вы не состоите в бригаде.'
                    : 'На этой волне тихо. Скажите первое слово.'}
                </p>
              )}
            </>
          )}
        </section>

        <aside className="radio__online" aria-label="Кто в эфире">
          <h2>В эфире: {online.length}</h2>
          <ul>
            {online.map(player => {
              const self = player.characterId === char?.id
              return (
                <li key={player.characterId} className={self ? 'is-self' : ''}>
                  <button
                    type="button"
                    onClick={() => navigate(self ? '/profile' : `/u/${encodeURIComponent(player.nickname)}`)}
                  >
                    <span>{player.nickname}</span>
                    <b className={`online-lvl online-lvl--${self ? 'o' : levelTone(player.level)}`}>
                      {player.level}
                    </b>
                  </button>
                </li>
              )
            })}
            {!online.length && <li className="radio__empty">Пока никого.</li>}
          </ul>
        </aside>
      </div>

      {/* На доске объявлений поле ввода не нужно: туда пишет город,
          а не игрок. */}
      {tab !== 'BOARD' && (
        <form className="radio__form" onSubmit={send}>
          <input
            value={draft}
            onChange={e => { setDraft(e.target.value); if (chat.notice) chat.clearNotice() }}
            placeholder={chat.notice || 'Сказать в эфир…'}
            maxLength={chat.maxBody}
            spellCheck={false}
            aria-label="Сказать в эфир"
          />
          <button type="submit">Сказать</button>
        </form>
      )}
    </div>
  )
}
