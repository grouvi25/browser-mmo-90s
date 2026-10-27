// Яндекс SmartCaptcha на регистрации и восстановлении пароля (28.10: защита
// от массовых регистраций; ТЗ разрешает капчу только на этих двух экранах).
// Ключ берётся с сервера: пока его нет в окружении, виджет не рисуется и
// токен не нужен — регистрация работает как раньше.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

type SmartCaptchaApi = {
  render: (el: HTMLElement, opts: { sitekey: string; hl?: string; callback?: (token: string) => void }) => number
  reset: (widgetId?: number) => void
  destroy: (widgetId?: number) => void
}
declare global { interface Window { smartCaptcha?: SmartCaptchaApi } }

const SCRIPT = 'https://smartcaptcha.yandexcloud.net/captcha.js'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.smartCaptcha) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script')
      tag.src = SCRIPT
      tag.defer = true
      tag.onload = () => resolve()
      tag.onerror = () => { scriptPromise = null; reject(new Error('captcha script failed')) }
      document.head.appendChild(tag)
    })
  }
  return scriptPromise
}

/** Ключ капчи с сервера: null — капча выключена. */
export function useCaptchaKey(): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    api.get<{ captchaClientKey: string | null }>('/api/auth/config', { noAuth: true })
      .then(cfg => { if (alive) setKey(cfg.captchaClientKey) })
      .catch(() => { if (alive) setKey(null) })
    return () => { alive = false }
  }, [])
  return key
}

/** Виджет «Я не робот». resetSignal меняется — виджет сбрасывается (после
 *  неудачной отправки токен одноразовый и второй раз не пройдёт). */
export function SmartCaptcha({ sitekey, onToken, resetSignal }: { sitekey: string; onToken: (token: string) => void; resetSignal?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadScript().then(() => {
      if (!alive || !box.current || !window.smartCaptcha) return
      widget.current = window.smartCaptcha.render(box.current, { sitekey, hl: 'ru', callback: onToken })
    }).catch(() => setFailed(true))
    return () => {
      alive = false
      if (widget.current != null) window.smartCaptcha?.destroy(widget.current)
      widget.current = null
    }
  // onToken — колбэк формы; пересоздавать виджет на каждый рендер незачем.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitekey])

  useEffect(() => {
    if (resetSignal && widget.current != null) { window.smartCaptcha?.reset(widget.current); onToken('') }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  return (
    <div className="form-group auth-captcha">
      <div ref={box} style={{ minHeight: 100 }} />
      {failed && <div className="alert alert-error">Не загрузилась проверка «не робот». Обновите страницу.</div>}
    </div>
  )
}
