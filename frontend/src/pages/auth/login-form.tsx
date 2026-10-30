// Форма входа — общая для отдельной страницы и главной (28.10: вход прямо
// на главной, рядом с рассказом об игре).
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { loginDestination } from '../../shared/lib/login-redirect'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
import { ApiError } from '../../shared/api/client'

export function LoginForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.login || !form.password) {
      setError('Заполните все поля')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(form)
      signIn(res.token, res.userId, res.login)
      navigate(loginDestination(location.search), { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? 'Неверный логин или пароль' : err.message)
      } else {
        setError('Ошибка подключения к серверу')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label className="form-label" htmlFor="login-login">Ник</label>
        <input id="login-login" className="form-input" type="text" placeholder="Ваш ник" title="Старые аккаунты входят и по прежнему логину или почте" autoComplete="username"
          value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} autoFocus={autoFocus} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="login-password">Пароль</label>
        <input id="login-password" className="form-input" type="password" placeholder="Пароль" autoComplete="current-password"
          value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        <Link className="auth-forgot" to="/forgot-password">Забыли пароль?</Link>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
        {loading ? <><span className="spinner" />Вход...</> : 'Войти в игру'}
      </button>
    </form>
  )
}
