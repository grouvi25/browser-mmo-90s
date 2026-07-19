import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
import { ApiError } from '../../shared/api/client'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
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
      navigate('/profile')
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
    <div className="auth-page">
      <div className="auth-box">
        <div className="auth-header">
          <div className="logo">БРАТВА 90-Х</div>
          <div className="subtitle">Браузерная MMO-RPG в тематике России 90-х</div>
        </div>

        <div className="auth-body">
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Логин</label>
              <input
                className="form-input"
                type="text"
                placeholder="Ваш логин"
                value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Пароль</label>
              <input
                className="form-input"
                type="password"
                placeholder="Пароль"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
            >
              {loading ? <><span className="spinner" />Вход...</> : 'Войти в игру'}
            </button>
          </form>
        </div>

        <div className="auth-footer">
          Нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
        </div>
      </div>
    </div>
  )
}
