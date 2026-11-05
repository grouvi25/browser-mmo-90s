// Поле пароля с глазком (обращение №23): на телефоне опечатку в скрытом
// пароле не найти. Показ сбрасывается вместе с формой: состояние своё у поля.
import { useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false)
  const label = visible ? 'Скрыть пароль' : 'Показать пароль'
  return (
    <span className="pw-field">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-field__eye"
        aria-label={label}
        aria-pressed={visible}
        title={label}
        // Фокус остаётся в поле: на телефоне клавиатура не прячется от нажатия.
        onMouseDown={event => event.preventDefault()}
        onClick={() => setVisible(value => !value)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="M4 20 20 4" />}
        </svg>
      </button>
    </span>
  )
}
