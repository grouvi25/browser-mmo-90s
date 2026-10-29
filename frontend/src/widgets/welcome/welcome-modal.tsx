// =============================================================
// Окно при входе в игру (просьба Дмитрия 29.10): «игра на стадии
// тестирования, тестируем формулы, механики, наполняем шмотом; любые
// вопросы — в поддержку или админу в ЛС».
//
// Показывается раз за сеанс вкладки. Текст правят в админке; правка
// поднимает версию — тогда окно покажется ещё раз даже в этом сеансе.
// Рисуется поверх сцены в body: внутри сцены оно бы масштабировалось.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { siteApi } from '../../shared/api/site.api'
import './welcome-modal.css'

const SEEN_KEY = 'mmo_welcome_seen'

function markSeen(version: number) {
  try { sessionStorage.setItem(SEEN_KEY, String(version)) } catch { /* приватный режим — просто закрываем */ }
}

function seenVersion(): number | null {
  try { const raw = sessionStorage.getItem(SEEN_KEY); return raw ? Number(raw) : null } catch { return null }
}

export function WelcomeModal() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['site', 'welcome'], queryFn: siteApi.welcome, staleTime: 10 * 60_000, retry: false })
  const welcome = q.data?.welcome
  const [closedVersion, setClosedVersion] = useState<number | null>(seenVersion)
  const okRef = useRef<HTMLButtonElement>(null)
  const open = !!welcome && closedVersion !== welcome.version

  const close = () => {
    if (!welcome) return
    markSeen(welcome.version)
    setClosedVersion(welcome.version)
  }

  useEffect(() => {
    if (!open || !welcome) return
    okRef.current?.focus()
    const version = welcome.version
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { markSeen(version); setClosedVersion(version) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, welcome])

  if (!open || !welcome) return null
  return createPortal(
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <button type="button" className="welcome__scrim" aria-label="Закрыть" tabIndex={-1} onClick={close} />
      <div className="welcome__box">
        <h2 id="welcome-title">{welcome.title}</h2>
        {welcome.text.split(/\n{2,}/).map((part, i) => <p key={i}>{part}</p>)}
        <div className="welcome__actions">
          <button type="button" className="btn" onClick={() => { close(); navigate('/support/new') }}>Написать в поддержку</button>
          <button ref={okRef} type="button" className="btn welcome__ok" onClick={close}>Понятно</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
