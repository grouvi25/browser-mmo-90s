// Окно «введите текст» внутри игры вместо window.prompt (18.11): в программе для ПК
// (Electron) prompt не поддерживается вовсе и молча ничего не делает, поэтому жалоба
// в чате, имя комплекта и причина отказа там не работали. Своё окно одинаково и в
// браузере, и в программе, и в Android-приложении.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import './ask-text.css'

interface Request {
  message: string
  value: string
  maxLength?: number
  resolve: (value: string | null) => void
}

let show: ((request: Request) => void) | null = null

/** Как window.prompt: строка после «Готово», null после «Отмена» или Esc. */
export function askText(message: string, value = '', opts: { maxLength?: number } = {}): Promise<string | null> {
  return new Promise(resolve => {
    if (!show) { resolve(null); return }
    show({ message, value, maxLength: opts.maxLength, resolve })
  })
}

export function AskTextHost() {
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    show = next => {
      setRequest(current => { current?.resolve(null); return next })
      setValue(next.value)
    }
    return () => { show = null }
  }, [])

  useEffect(() => {
    if (!request) return
    input.current?.focus()
    input.current?.select()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const close = (result: string | null) => {
    request?.resolve(result)
    setRequest(null)
  }
  const submit = (event: FormEvent) => { event.preventDefault(); close(value) }

  if (!request) return null
  return createPortal(
    <div className="ask-text" onMouseDown={event => { if (event.target === event.currentTarget) close(null) }}>
      <form className="ask-text__box" role="dialog" aria-modal="true" aria-labelledby="ask-text-message" onSubmit={submit}>
        <label id="ask-text-message" htmlFor="ask-text-input">{request.message}</label>
        <input id="ask-text-input" ref={input} value={value} maxLength={request.maxLength}
          onChange={event => setValue(event.target.value)} autoComplete="off" />
        <div className="ask-text__acts">
          <button type="button" className="ask-text__btn" onClick={() => close(null)}>Отмена</button>
          <button type="submit" className="ask-text__btn is-main">Готово</button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
