// =============================================================
// Строка эфира и поле ввода — общие для города, телефона и боя.
//
// Правка заказчика: клик по нику — обращение к игроку; можно писать
// лично и в бригаду; общие сообщения серые, личные и бригадные — своими
// цветами; смайлики. Одна разметка на все три окна, иначе они
// разъедутся при первой же доработке.
// =============================================================
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'

import type { ChatLine } from '../../shared/api/chat.api'
import { chatTime } from '../../shared/lib/chat-format'
import { canEditLine, mentionsMe, type Ether, type EtherMode } from '../../shared/lib/use-ether'
import { SMILES, SmileImage, smileToken, withSmiles } from '../../shared/ui/smiles'

export const EMOJIS = [
  '😀', '😂', '😉', '😎', '😡', '😢', '😱', '🤔', '😏', '🙄',
  '👍', '👎', '👊', '🤝', '👋', '🙏', '💪', '🔥', '💰', '💵',
  '🍺', '🚬', '🔫', '🔪', '💣', '🚓', '🏆', '❤️', '💔', '⭐',
]

const MODE_LABEL: Record<EtherMode, string> = { GLOBAL: 'Всем', CLAN: 'Бригаде', PRIVATE: 'Лично' }

/**
 * Написать лично из любого места, не только из строки чата (заказчик 28.10:
 * «справа, где ники, стрелочки, как в апехе» — раньше личку можно было
 * открыть только тому, кто сам что-то написал). Список онлайн и поле ввода —
 * разные компоненты, поэтому адресат передаётся событием окна.
 */
const PRIVATE_EVENT = 'ether:private'
export function writePrivately(nick: string) {
  window.dispatchEvent(new CustomEvent<string>(PRIVATE_EVENT, { detail: nick }))
}
export function onWritePrivately(handler: (nick: string) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail)
  window.addEventListener(PRIVATE_EVENT, listener)
  return () => window.removeEventListener(PRIVATE_EVENT, listener)
}

/** Стрелочка у ника в списке онлайн: сразу личка этому игроку. */
export function PrivateArrow({ nick }: { nick: string }) {
  return (
    <button type="button" className="ether-arrow" aria-label={`Написать лично ${nick}`} title={`Написать лично ${nick}`}
      onClick={event => { event.stopPropagation(); writePrivately(nick) }}>
      &#10148;
    </button>
  )
}

/** Клик по нику в списке онлайна: обращение в чате, как клик по нику в строке ленты. */
const MENTION_EVENT = 'ether:mention'
export function mentionPlayer(nick: string) {
  window.dispatchEvent(new CustomEvent<string>(MENTION_EVENT, { detail: nick }))
}
export function onMentionPlayer(handler: (nick: string) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail)
  window.addEventListener(MENTION_EVENT, listener)
  return () => window.removeEventListener(MENTION_EVENT, listener)
}

/** Обновить список онлайна, не дожидаясь очередного опроса. */
export function OnlineRefresh() {
  const qc = useQueryClient()
  const busy = useIsFetching({ queryKey: ['chat', 'online'] }) > 0
  return (
    <button type="button" className="online-refresh" aria-label="Обновить список игроков" title="Обновить список игроков"
      aria-busy={busy} disabled={busy} onClick={() => { void qc.invalidateQueries({ queryKey: ['chat', 'online'] }) }}>
      &#8635;
    </button>
  )
}

/** Состояние поля ввода: куда пишем, кому и что. */
export function useComposer(ether: Ether) {
  const [mode, setMode] = useState<EtherMode>('GLOBAL')
  const [target, setTarget] = useState('')
  const [draft, setDraft] = useState('')
  // Правка своей реплики (№57): поле ввода переходит в режим правки.
  const [editing, setEditing] = useState<ChatLine | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Кого уже позвали в этом сообщении: в нике бывает пробел, по одному тексту
  // начало строки на обращения не разобрать.
  const called = useRef<string[]>([])

  /** Клик по нику: обращение в общем канале (ники копятся в начале строки), адресат — в личном. */
  const onNick = (nick: string) => {
    // В личке ник добавляется к адресатам: можно написать сразу нескольким (№26).
    setTarget(prev => mode === 'PRIVATE' ? addRecipient(prev, nick) : nick)
    if (mode !== 'PRIVATE') {
      const known = called.current
      setDraft(d => {
        let head = 0
        for (const name of known) if (d.startsWith(`${name}, `, head)) head += name.length + 2
        return d.slice(0, head).includes(`${nick}, `) ? d : `${d.slice(0, head)}${nick}, ${d.slice(head)}`
      })
      if (!known.includes(nick)) called.current = [...known, nick]
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

  useEffect(() => onWritePrivately(replyPrivately), [])
  useEffect(() => onMentionPlayer(onNick), [mode])

  const startEdit = (line: ChatLine) => {
    setEditing(line)
    setDraft(line.body)
    inputRef.current?.focus()
  }
  const cancelEdit = () => { setEditing(null); setDraft('') }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (editing) {
      if (draft.trim() === editing.body || await ether.edit(editing.id, draft)) cancelEdit()
      return
    }
    if (await ether.send(mode, draft, target)) { setDraft(''); called.current = [] }
  }

  // Бригаду могли покинуть — тогда и писать в неё не из чего.
  const effectiveMode: EtherMode = mode === 'CLAN' && !ether.hasClan ? 'GLOBAL' : mode

  return { mode: effectiveMode, setMode, target, setTarget, draft, setDraft, inputRef, onNick, replyPrivately, submit, editing, startEdit, cancelEdit }
}

export type Composer = ReturnType<typeof useComposer>

/** Адресаты лички хранятся строкой через запятую, как их ждёт сервер. */
export const PRIVATE_MAX_RECIPIENTS = 5
export const recipientsOf = (target: string) => target.split(',').map(nick => nick.trim()).filter(Boolean)
export function addRecipient(target: string, nick: string): string {
  const list = recipientsOf(target)
  if (list.some(name => name.toLowerCase() === nick.toLowerCase()) || list.length >= PRIVATE_MAX_RECIPIENTS) return list.join(', ')
  return [...list, nick].join(', ')
}
const removeRecipient = (target: string, nick: string) => recipientsOf(target).filter(name => name !== nick).join(', ')

/** Одна строка ленты: время, метка канала, ник (клик — обращение) и текст. */
export function EtherLine({ line, ether, composer, className = '' }: {
  line: ChatLine; ether: Ether; composer: Composer; className?: string
}) {
  if (line.system) {
    return <div className={`ether-line ether-line--system ${className}`}>
      <span className="city-chat__time" title="Время московское">[{chatTime(line.createdAt)}]</span> {line.body}
    </div>
  }
  const mine = line.authorId === ether.me?.id
  const kind = line.channel === 'PRIVATE' ? 'private' : line.channel === 'CLAN' ? 'clan' : 'global'
  const mention = mentionsMe(line, ether.me)
  // В личном «чужой» — тот, с кем переписка: ему и отвечаем.
  const partner = line.channel === 'PRIVATE' && mine ? line.recipientNickname ?? '' : line.nickname
  return (
    <div className={`ether-line ether-line--${kind}${mention ? ' is-mention' : ''} ${className}`}>
      <span className="city-chat__time" title="Время московское">[{chatTime(line.createdAt)}]</span>{' '}
      {kind === 'clan' && <span className="ether-tag">[Бригада]</span>}
      {kind === 'private' && (
        <button type="button" className="ether-tag ether-tag--btn" title="Ответить лично"
          onClick={() => composer.replyPrivately(partner)}>
          {mine ? `[ЛС → ${line.recipientNickname ?? '?'}]` : '[ЛС]'}
        </button>
      )}{' '}
      <button type="button" className="ether-nick"
        title="Обратиться к игроку" onClick={() => composer.onNick(line.nickname)}>
        {line.nickname}:
      </button>{' '}
      <span className="ether-body">{withSmiles(line.body)}</span>
      {line.editedAt && <span className="ether-edited" title="Автор поправил сообщение"> (изм.)</span>}
      {canEditLine(line, ether.me?.id) && (
        <button type="button" className="ether-edit" aria-label="Поправить сообщение" title="Поправить сообщение"
          onClick={() => composer.startEdit(line)}>
          ✎
        </button>
      )}
      {!mine && (
        <button type="button" className="ether-report" aria-label={`Пожаловаться на сообщение ${line.nickname}`} title="Пожаловаться"
          onClick={() => {
            const reason = window.prompt(`Жалоба на сообщение ${line.nickname}. За что? (можно оставить пустым)`, '')
            if (reason !== null) void ether.report(line.id, reason)
          }}>
          ⚑
        </button>
      )}
      {ether.canModerate && (
        <button type="button" className="ether-remove" aria-label="Удалить сообщение" title="Удалить сообщение"
          onClick={() => { if (window.confirm(`Удалить сообщение ${line.nickname}?`)) void ether.remove(line.id) }}>
          ×
        </button>
      )}
    </div>
  )
}

/** Поле ввода: канал, адресат лички, смайлики. */
export function EtherComposer({ ether, composer, className = '', style }: {
  ether: Ether; composer: Composer; className?: string; style?: CSSProperties
}) {
  const [emojiOpen, setEmojiOpen] = useState(false)
  const { mode, setMode, target, setTarget, draft, setDraft, inputRef, submit, editing, cancelEdit } = composer
  const modes: EtherMode[] = ether.hasClan ? ['GLOBAL', 'CLAN', 'PRIVATE'] : ['GLOBAL', 'PRIVATE']
  const placeholder = ether.notice
    || (editing ? 'Новый текст сообщения…' : mode === 'PRIVATE' ? (target ? `Лично ${target}…` : 'Нажмите на ник в чате, кому написать, можно на несколько')
      : mode === 'CLAN' ? 'Написать бригаде…' : 'Написать всем…')

  const insertEmoji = (emoji: string) => {
    // Код смайла отделяем пробелами, иначе «текст:pivo:» склеится в одно слово.
    setDraft(d => emoji.startsWith(':') ? `${d}${d && !d.endsWith(' ') ? ' ' : ''}${emoji} ` : d + emoji)
    setEmojiOpen(false)
    inputRef.current?.focus()
  }

  return (
    <form className={`ether-composer ether-composer--${mode.toLowerCase()}${editing ? ' is-editing' : ''} ${className}`} style={style} onSubmit={submit}
      onKeyDown={e => { if (editing && e.key === 'Escape') cancelEdit() }}>
      {editing
        ? <span className="ether-editing">
            Правка
            <button type="button" aria-label="Отменить правку" title="Отменить правку" onClick={cancelEdit}>×</button>
          </span>
        : <select className="ether-mode" value={mode} aria-label="Куда писать"
            onChange={e => setMode(e.target.value as EtherMode)}>
            {modes.map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>}
      {!editing && mode === 'PRIVATE' && target && (
        <span className="ether-target">
          →{recipientsOf(target).map(nick => (
            <span key={nick} className="ether-target__nick">
              <Link to={`/u/${encodeURIComponent(nick)}`} title="Профиль">{nick}</Link>
              <button type="button" aria-label={`Убрать адресата ${nick}`} onClick={() => setTarget(t => removeRecipient(t, nick))}>×</button>
            </span>
          ))}
        </span>
      )}
      <input
        ref={inputRef}
        className="ether-input"
        value={draft}
        onChange={e => { setDraft(e.target.value); if (ether.notice) ether.clearNotice() }}
        placeholder={placeholder}
        maxLength={ether.maxBody}
        spellCheck
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
      <button type="submit" className="ether-send" aria-label={editing ? 'Сохранить правку' : 'Отправить'}>{editing ? '✓' : '→'}</button>
    </form>
  )
}
