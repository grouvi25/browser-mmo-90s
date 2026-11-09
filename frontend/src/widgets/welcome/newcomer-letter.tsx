// Письмо Бывалого новичку (Дмитрий, 09.11.2026): окном сразу после создания
// персонажа и страницей /novichok. Ник подставляется вместо «приезжего».
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { charactersApi } from '../../shared/api/characters.api'
import {
  NEWCOMER_LETTER_INTRO, NEWCOMER_LETTER_OUTRO, NEWCOMER_LETTER_POINTS, NEWCOMER_LETTER_TITLE,
  NEWCOMER_LETTER_EVENT, clearNewcomerLetter, hasNewcomerLetter, newcomerGreeting,
} from '../../shared/lib/newcomer-letter'
import './welcome-modal.css'

/** Сам текст письма — общий для окна и страницы. */
export function NewcomerLetterBody({ nick, links = true }: { nick?: string | null; links?: boolean }) {
  return <div className="newcomer-letter">
    <p><b>{newcomerGreeting(nick)}</b></p>
    {NEWCOMER_LETTER_INTRO.map(text => <p key={text}>{text}</p>)}
    <ol>
      {NEWCOMER_LETTER_POINTS.map(point => <li key={point.title}>
        <b>{point.title}</b> {point.text}
        {point.list && <ul>{point.list.map(item => <li key={item}>{item}</li>)}</ul>}
        {links && point.link && <> <Link to={point.link.to}>{point.link.label} →</Link></>}
      </li>)}
    </ol>
    <p>{NEWCOMER_LETTER_OUTRO}</p>
  </div>
}

/** Окно с письмом: один раз после создания персонажа. */
export function NewcomerLetterModal() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(hasNewcomerLetter)
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), retry: false, enabled: open })
  const okRef = useRef<HTMLButtonElement>(null)
  const close = () => { clearNewcomerLetter(); setOpen(false) }

  useEffect(() => {
    const show = () => setOpen(true)
    window.addEventListener(NEWCOMER_LETTER_EVENT, show)
    return () => window.removeEventListener(NEWCOMER_LETTER_EVENT, show)
  }, [])

  useEffect(() => {
    if (!open) return
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { clearNewcomerLetter(); setOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="newcomer-title">
      <button type="button" className="welcome__scrim" aria-label="Закрыть" tabIndex={-1} onClick={close} />
      <div className="welcome__box welcome__box--letter">
        <h2 id="newcomer-title">{NEWCOMER_LETTER_TITLE}</h2>
        <NewcomerLetterBody nick={me.data?.nickname} links={false} />
        <div className="welcome__actions">
          <button type="button" className="btn" onClick={() => { close(); navigate('/library') }}>В Библиотеку</button>
          <button ref={okRef} type="button" className="btn welcome__ok" onClick={close}>Понял, Бывалый</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
