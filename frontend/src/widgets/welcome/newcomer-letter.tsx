import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/providers/auth-provider'
import { charactersApi } from '../../shared/api/characters.api'
import { tutorialKey, updateTutorial } from '../city-tutorial/use-city-tutorial'
import {
  NEWCOMER_LETTER_INTRO, NEWCOMER_LETTER_OUTRO, NEWCOMER_LETTER_POINTS, NEWCOMER_LETTER_TITLE,
  newcomerGreeting,
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

export function NewcomerLetterModal() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { userId } = useAuth()
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), retry: false })
  const okRef = useRef<HTMLButtonElement>(null)
  const dismiss = useMutation({
    mutationFn: () => updateTutorial('dismiss-letter'),
    onSuccess: value => qc.setQueryData(tutorialKey(userId), value),
  })

  useEffect(() => {
    okRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') okRef.current?.click() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return createPortal(
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="newcomer-title">
      <button type="button" className="welcome__scrim" aria-label="Закрыть" tabIndex={-1} disabled={dismiss.isPending} onClick={() => dismiss.mutate()} />
      <div className="welcome__box welcome__box--letter">
        <h2 id="newcomer-title">{NEWCOMER_LETTER_TITLE}</h2>
        <NewcomerLetterBody nick={me.data?.nickname} links={false} />
        <div className="welcome__actions">
          <button type="button" className="btn" disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(undefined, { onSuccess: () => navigate('/library') })}>В Библиотеку</button>
          <button ref={okRef} type="button" className="btn welcome__ok" disabled={dismiss.isPending}
            onClick={() => dismiss.mutate()}>Понял, Бывалый</button>
        </div>
        {dismiss.isError && <p role="alert">{dismiss.error.message}</p>}
      </div>
    </div>,
    document.body,
  )
}
