import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
import { ApiError } from '../../shared/api/client'

export function RegisterPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ login: '', email: '', password: '', password2: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    setError('')
    setLoading(true)
    try {
      await authApi.register({ login: form.login, email: form.email, password: form.password })
      // Auto-login after register
      const res = await authApi.login({ login: form.login, password: form.password })
      signIn(res.token, res.userId, res.login)
      navigate('/character/create')
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError('Логин или email уже зарегистрированы')
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
          <div className="logo">БРАТВА 90-Х</div>
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
