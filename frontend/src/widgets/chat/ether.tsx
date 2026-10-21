// =============================================================
// Строка эфира и поле ввода — общие для города, телефона и боя.
//
// Правка заказчика: клик по нику — обращение к игроку; можно писать
// лично и в бригаду; общие сообщения серые, личные и бригадные — своими
// цветами; смайлики. Одна разметка на все три окна, иначе они
// разъедутся при первой же доработке.
// =============================================================
import { useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import type { ChatLine } from '../../shared/api/chat.api'
import { chatTime } from '../../shared/lib/chat-format'
import { nickTone } from '../../shared/lib/use-chat'
import { mentionsMe, type Ether, type EtherMode } from '../../shared/lib/use-ether'
import { SMILES, SmileImage, smileToken, withSmiles } from '../../shared/ui/smiles'

export const EMOJIS = [
  '😀', '😂', '😉', '😎', '😡', '😢', '😱', '🤔', '😏', '🙄',
  '👍', '👎', '👊', '🤝', '👋', '🙏', '💪', '🔥', '💰', '💵',
  '🍺', '🚬', '🔫', '🔪', '💣', '🚓', '🏆', '❤️', '💔', '⭐',
]

const MODE_LABEL: Record<EtherMode, string> = { GLOBAL: 'Всем', CLAN: 'Бригаде', PRIVATE: 'Лично' }

/** Состояние поля ввода: куда пишем, кому и что. */
export function useComposer(ether: Ether) {
  const [mode, setMode] = useState<EtherMode>('GLOBAL')
  const [target, setTarget] = useState('')
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  /** Клик по нику: обращение в общем канале, адресат — в личном. */
  const onNick = (nick: string) => {
    setTarget(nick)
    if (mode !== 'PRIVATE') {
      const prefix = `${nick}, `
      setDraft(d => (d.startsWith(prefix) ? d : prefix + d.replace(/^[^,]{2,30}, /, '')))
    }
    inputRef.current?.focus()
  }

  /** Ответить лично автору строки. */
  const replyPrivately = (nick: string) => {
    setMode('PRIVATE')
    setTarget(nick)
    setDraft(d => d.replace(/^[^,]{2,30}, /, ''))
    inputRef.current?.focus()
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (await ether.send(mode, draft, target)) setDraft('')
  }

  // Бригаду могли покинуть — тогда и писать в неё не из чего.
  const effectiveMode: EtherMode = mode === 'CLAN' && !ether.hasClan ? 'GLOBAL' : mode

  return { mode: effectiveMode, setMode, target, setTarget, draft, setDraft, inputRef, onNick, replyPrivately, submit }
}

export type Composer = ReturnType<typeof useComposer>

/** Одна строка ленты: время, метка канала, ник (клик — обращение) и текст. */
export function EtherLine({ line, ether, composer, className = '' }: {
  line: ChatLine; ether: Ether; composer: Composer; className?: string
}) {
  if (line.system) {
    return <div className={`ether-line ether-line--system ${className}`}>
      <span className="city-chat__time">[{chatTime(line.createdAt)}]</span> {line.body}
    </div>
  }
  const mine = line.authorId === ether.me?.id
  const kind = line.channel === 'PRIVATE' ? 'private' : line.channel === 'CLAN' ? 'clan' : 'global'
  const mention = mentionsMe(line, ether.me)
  // В личном «чужой» — тот, с кем переписка: ему и отвечаем.
  const partner = line.channel === 'PRIVATE' && mine ? line.recipientNickname ?? '' : line.nickname
  return (
    <div className={`ether-line ether-line--${kind}${mention ? ' is-mention' : ''} ${className}`}>
      <span className="city-chat__time">[{chatTime(line.createdAt)}]</span>{' '}
      {kind === 'clan' && <span className="ether-tag">[Бригада]</span>}
      {kind === 'private' && (
        <button type="button" className="ether-tag ether-tag--btn" title="Ответить лично"
          onClick={() => composer.replyPrivately(partner)}>
          {mine ? `[ЛС → ${line.recipientNickname ?? '?'}]` : '[ЛС]'}
        </button>
      )}{' '}
      <button type="button" className={`ether-nick city-chat__nick--${nickTone(line.nickname)}`}
        title="Обратиться к игроку" onClick={() => composer.onNick(line.nickname)}>
        {line.nickname}:
      </button>{' '}
      <span className="ether-body">{withSmiles(line.body)}</span>
    </div>
  )
}

/** Поле ввода: канал, адресат лички, смайлики. */
export function EtherComposer({ ether, composer, className = '', style }: {
  ether: Ether; composer: Composer; className?: string; style?: CSSProperties
}) {
  const [emojiOpen, setEmojiOpen] = useState(false)
  const { mode, setMode, target, setTarget, draft, setDraft, inputRef, submit } = composer
  const modes: EtherMode[] = ether.hasClan ? ['GLOBAL', 'CLAN', 'PRIVATE'] : ['GLOBAL', 'PRIVATE']
  const placeholder = ether.notice
    || (mode === 'PRIVATE' ? (target ? `Лично ${target}…` : 'Нажмите на ник в чате, кому написать')
      : mode === 'CLAN' ? 'Написать бригаде…' : 'Написать всем…')

  const insertEmoji = (emoji: string) => {
    // Код смайла отделяем пробелами, иначе «текст:pivo:» склеится в одно слово.
    setDraft(d => emoji.startsWith(':') ? `${d}${d && !d.endsWith(' ') ? ' ' : ''}${emoji} ` : d + emoji)
    setEmojiOpen(false)
    inputRef.current?.focus()
  }

  return (
    <form className={`ether-composer ether-composer--${mode.toLowerCase()} ${className}`} style={style} onSubmit={submit}>
      <select className="ether-mode" value={mode} aria-label="Куда писать"
        onChange={e => setMode(e.target.value as EtherMode)}>
        {modes.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
      </select>
      {mode === 'PRIVATE' && target && (
        <span className="ether-target">
          → <Link to={`/u/${encodeURIComponent(target)}`} title="Профиль">{target}</Link>
          <button type="button" aria-label="Убрать адресата" onClick={() => setTarget('')}>×</button>
        </span>
      )}
      <input
        ref={inputRef}
        className="ether-input"
        value={draft}
        onChange={e => { setDraft(e.target.value); if (ether.notice) ether.clearNotice() }}
        placeholder={placeholder}
        maxLength={ether.maxBody}
        spellCheck={false}
        aria-label={placeholder}
      />
      <span className="ether-emoji">
        <button type="button" aria-label="Смайлики" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(o => !o)}>😊</button>
        {emojiOpen && (
          <span className="ether-emoji__grid" role="listbox" aria-label="Смайлики">
            {SMILES.map(s => (
              <button type="button" key={s.code} role="option" aria-selected={false} aria-label={s.name} title={s.name}
                className="ether-emoji__smile" onClick={() => insertEmoji(smileToken(s.code))}>
                <SmileImage code={s.code} className="smile smile--pick" />
              </button>
            ))}
            {EMOJIS.map(e => <button type="button" key={e} role="option" aria-selected={false} onClick={() => insertEmoji(e)}>{e}</button>)}
          </span>
        )}
      </span>
      <button type="submit" className="ether-send" aria-label="Отправить">→</button>
    </form>
  )
}
