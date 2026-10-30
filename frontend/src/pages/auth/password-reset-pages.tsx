// Восстановление пароля (просьба игроков 26–27.10: «нет возможности
// восстановить пароль при входе с нового устройства»). Две страницы в
// оформлении входа: заявка по логину или почте и новый пароль по ссылке.
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../shared/api/auth.api'
import { ApiError } from '../../shared/api/client'
import { SmartCaptcha, useCaptchaKey } from '../../shared/ui/smart-captcha'

function AuthShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-header">
          <div className="logo">КООПЕРАТИВ</div>
          <div className="subtitle">Восстановление пароля</div>
        </div>
        <div className="auth-body">{children}</div>
        <div className="auth-footer">{footer ?? <Link to="/login">Вернуться ко входу</Link>}</div>
      </div>
    </div>
  )
}

export function ForgotPasswordPage() {
  const [login, setLogin] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const captchaKey = useCaptchaKey()
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!login.trim()) { setError('Укажите логин или почту'); return }
    if (captchaKey && !captchaToken) { setError('Подтвердите, что вы не робот'); return }
    setError(''); setLoading(true)
    try {
      await authApi.forgotPassword(login.trim(), captchaToken || undefined)
      setSent(true)
    } catch (err) {
      setCaptchaReset(n => n + 1)
      setError(err instanceof ApiError && err.status === 429 ? 'Слишком много заявок — попробуйте через 15 минут' : err instanceof ApiError ? err.message : 'Ошибка подключения к серверу')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="alert alert-success">
          Если такой игрок есть, на почту, указанную при регистрации, придёт письмо со ссылкой на новый
          пароль. Ссылка действует час. Письма нет — загляните в «Спам».
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <form onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label className="form-label" htmlFor="forgot-login">Ник или почта</label>
          <input id="forgot-login" className="form-input" type="text" autoComplete="username"
            placeholder="Ник или почта, указанная при регистрации" value={login}
            onChange={e => setLogin(e.target.value)} autoFocus />
        </div>
        {captchaKey && <SmartCaptcha sitekey={captchaKey} onToken={setCaptchaToken} resetSignal={captchaReset} />}
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <><span className="spinner" />Отправляем…</> : 'Получить ссылку'}
        </button>
      </form>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [doneLogin, setDoneLogin] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) { setError('Пароль — не короче 6 символов'); return }
    if (password !== repeat) { setError('Пароли не совпадают'); return }
    setError(''); setLoading(true)
    try {
      const result = await authApi.resetPassword(token, password)
      setDoneLogin(result.login)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка подключения к серверу')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthShell footer={<Link to="/forgot-password">Запросить ссылку</Link>}>
        <div className="alert alert-error">В ссылке нет кода. Откройте её целиком или запросите новую.</div>
      </AuthShell>
    )
  }

  if (doneLogin) {
    return (
      <AuthShell footer={null}>
        <div className="alert alert-success">Пароль сменён. Имя для входа: <b>{doneLogin}</b> — подойдёт и ник персонажа.</div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/login', { replace: true })}>
          Войти в игру
        </button>
      </AuthShell>
    )
  }

  return (
    <AuthShell footer={<Link to="/forgot-password">Запросить новую ссылку</Link>}>
      <form onSubmit={submit}>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-group">
          <label className="form-label" htmlFor="reset-password">Новый пароль</label>
          <input id="reset-password" className="form-input" type="password" autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="reset-repeat">Ещё раз</label>
          <input id="reset-repeat" className="form-input" type="password" autoComplete="new-password"
            value={repeat} onChange={e => setRepeat(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? <><span className="spinner" />Сохраняем…</> : 'Сохранить пароль'}
        </button>
      </form>
    </AuthShell>
  )
}
