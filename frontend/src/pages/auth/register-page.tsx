import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
import { ApiError } from '../../shared/api/client'
import { SmartCaptcha, useCaptchaKey } from '../../shared/ui/smart-captcha'

export function RegisterPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ login: '', email: '', password: '', password2: '' })
  // Согласие с политикой обработки персональных данных (152-ФЗ, правка
  // заказчика 21.10): без него сервер регистрацию не примет.
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Защита от ботов (28.10): капча, если включена на сервере, и поле-ловушка,
  // невидимое человеку, — автозаполнение ботов его заполняет.
  const captchaKey = useCaptchaKey()
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)
  const [trap, setTrap] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.login || !form.email || !form.password) {
      setError('Заполните все поля')
      return
    }
    if (form.password !== form.password2) {
      setError('Пароли не совпадают')
      return
    }
    if (form.password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }
    if (!agree) {
      setError('Нужно согласие с политикой обработки персональных данных')
      return
    }
    if (captchaKey && !captchaToken) {
      setError('Подтвердите, что вы не робот')
      return
    }
    setError('')
    setLoading(true)
    try {
      await authApi.register({ login: form.login, email: form.email, password: form.password, acceptPolicy: true, website: trap, captchaToken: captchaToken || undefined })
      // Auto-login after register
      const res = await authApi.login({ login: form.login, password: form.password })
      signIn(res.token, res.userId, res.login)
      navigate('/character/create')
    } catch (err) {
      // Токен капчи одноразовый: после отказа её надо пройти заново.
      setCaptchaReset(n => n + 1)
      if (err instanceof ApiError) {
        if (err.status === 409) setError('Логин или почта уже зарегистрированы (у Gmail точки и «+метка» в адресе не считаются)')
        else setError(err.message)
      } else {
        setError('Ошибка подключения к серверу')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-header">
          <div className="logo">КООПЕРАТИВ</div>
          <div className="subtitle">Создать новый аккаунт</div>
        </div>

        <div className="auth-body">
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Логин (латиница, цифры, _)</label>
              <input
                className="form-input"
                type="text"
                placeholder="Мой_логин123"
                value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="example@mail.ru"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Пароль</label>
              <input
                className="form-input"
                type="password"
                placeholder="Минимум 6 символов"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Повторите пароль</label>
              <input
                className="form-input"
                type="password"
                placeholder="Повторите пароль"
                value={form.password2}
                onChange={e => setForm(f => ({ ...f, password2: e.target.value }))}
              />
            </div>

            {/* Ловушка: человек поле не видит и не заполняет. */}
            <div className="auth-trap" aria-hidden="true">
              <label>Сайт<input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={e => setTrap(e.target.value)} /></label>
            </div>

            {captchaKey && <SmartCaptcha sitekey={captchaKey} onToken={setCaptchaToken} resetSignal={captchaReset} />}

            <label className="auth-consent">
              <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
              <span>Я согласен с <Link to="/politika" target="_blank" rel="noopener">политикой обработки персональных данных</Link> и даю согласие на обработку своих данных</span>
            </label>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
            >
              {loading ? <><span className="spinner" />Регистрация...</> : 'Зарегистрироваться'}
            </button>
          </form>
        </div>

        <div className="auth-footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </div>
      </div>
    </div>
  )
}
