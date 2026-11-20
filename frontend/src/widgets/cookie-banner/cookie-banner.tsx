// Баннер cookie (Политика cookie, п. 5.2 и 6.5, редакция 08.11.2026): необходимые
// cookie работают всегда, аналитические cookie — только после
// «Принять». Выбор хранится в браузере; изменить его можно на странице /cookies.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import './cookie-banner.css'

const KEY = 'kooperativ_cookies'
// Старое согласие «all» охватывало только Яндекс Метрику и Top.Mail.Ru.
const ALL_ANALYTICS = 'all-v2'
export const COOKIE_CHOICE_EVENT = 'kooperativ:cookie-choice'
type Choice = 'all' | 'necessary'

export function cookieChoice(): Choice | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === ALL_ANALYTICS ? 'all' : value === 'necessary' ? value : null
  } catch { return null }
}

export function setCookieChoice(choice: Choice | null) {
  let restartPage = false
  try {
    const previous = localStorage.getItem(KEY)
    if (choice) localStorage.setItem(KEY, choice === 'all' ? ALL_ANALYTICS : choice)
    else localStorage.removeItem(KEY)
    restartPage = choice !== 'all' && (previous === 'all' || previous === ALL_ANALYTICS)
  } catch { /* приватный режим */ }
  if (restartPage) {
    window.location.reload()
    return
  }
  if (choice === 'all') {
    const w = window as typeof window & {
      __kooperativMetrika?: () => void
      __kooperativTopMail?: () => void
      __kooperativTop100?: () => void
    }
    w.__kooperativMetrika?.()
    w.__kooperativTopMail?.()
    w.__kooperativTop100?.()
  }
  window.dispatchEvent(new Event(COOKIE_CHOICE_EVENT))
}

export function CookieBanner() {
  // Под автотестом баннер не показываем: Метрика там всё равно не грузится,
  // а плашка внизу перекрывала бы кнопки сценариев.
  const [open, setOpen] = useState(() => !navigator.webdriver && cookieChoice() === null)
  useEffect(() => {
    const sync = () => setOpen(!navigator.webdriver && cookieChoice() === null)
    window.addEventListener(COOKIE_CHOICE_EVENT, sync)
    return () => window.removeEventListener(COOKIE_CHOICE_EVENT, sync)
  }, [])
  if (!open) return null
  return createPortal(
    <div className="cookie-banner" role="region" aria-label="Cookie">
      <p>
        Мы используем необходимые cookie, без них игра не работает, а с вашего согласия также аналитические cookie
        Яндекс Метрики, Top.Mail.Ru и Рамблер/Топ-100 для статистики посещаемости. <Link to="/cookies">Подробнее</Link>
      </p>
      <div className="cookie-banner__acts">
        <button type="button" className="cookie-banner__btn" onClick={() => setCookieChoice('necessary')}>Только необходимые</button>
        <button type="button" className="cookie-banner__btn is-main" onClick={() => setCookieChoice('all')}>Принять все</button>
      </div>
    </div>,
    document.body,
  )
}

/** На странице /cookies: показать текущий выбор и дать его сменить. */
export function CookieChoiceControl() {
  const [choice, setChoice] = useState(cookieChoice)
  useEffect(() => {
    const sync = () => setChoice(cookieChoice())
    window.addEventListener(COOKIE_CHOICE_EVENT, sync)
    return () => window.removeEventListener(COOKIE_CHOICE_EVENT, sync)
  }, [])
  return (
    <p className="cookie-choice">
      Ваш выбор: <b>{choice === 'all' ? 'все cookie, включая аналитические' : choice === 'necessary' ? 'только необходимые' : 'ещё не сделан'}</b>.{' '}
      <button type="button" className="cookie-banner__btn" onClick={() => setCookieChoice(null)}>Изменить выбор</button>
    </p>
  )
}
