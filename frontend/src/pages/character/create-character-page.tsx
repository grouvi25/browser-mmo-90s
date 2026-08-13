import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { User, Check } from 'lucide-react'
import { charactersApi } from '../../shared/api/characters.api'
import { ARCHETYPE_LABELS, ARCHETYPE_BONUS } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

const ARCHETYPES = Object.keys(ARCHETYPE_LABELS)

export function CreateCharacterPage() {
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [archetype, setArchetype] = useState('ATHLETE')
  const [error, setError] = useState('')

  // Check if char already exists
  const { data: existingChar } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const { mutate, isPending } = useMutation({
    mutationFn: () => charactersApi.create({ nickname, archetype }),
    onSuccess: () => navigate('/profile'),
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 409) setError('Этот никнейм уже занят')
        else setError(err.message)
      }
    },
  })

  // Персонаж уже есть — уходим в профиль. Переход именно в эффекте:
  // навигация во время отрисовки — побочный эффект, а ранний выход до
  // остальных хуков ломал их порядок и валил компонент.
  useEffect(() => {
    if (existingChar) navigate('/profile', { replace: true })
  }, [existingChar, navigate])

  if (existingChar) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nickname.trim()) { setError('Введите никнейм'); return }
    if (nickname.length < 2) { setError('Никнейм минимум 2 символа'); return }
    setError('')
    mutate()
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <User size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            СОЗДАНИЕ ПЕРСОНАЖА
          </span>
        </div>
        <div className="panel-body">
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            Выбери архетип — он даёт стартовые бонусы. Архетип не закрывает другие пути развития.
          </div>

          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Никнейм персонажа</label>
              <input
                className="form-input"
                type="text"
                placeholder="Седой, Бригадир, Лёша..."
                value={nickname}
                maxLength={30}
                onChange={e => setNickname(e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Архетип</label>
              <div className="archetype-grid">
                {ARCHETYPES.map(arch => (
                  <button
                    key={arch}
                    type="button"
                    className={`arch-card${archetype === arch ? ' selected' : ''}`}
                    aria-pressed={archetype === arch}
                    onClick={() => setArchetype(arch)}
                  >
                    <span className="name">{ARCHETYPE_LABELS[arch]}</span>
                    <span className="bonus">{ARCHETYPE_BONUS[arch]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-header"><span className="panel-title">Стартовые условия</span></div>
              <div className="panel-body">
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>Архетип</td>
                      <td><strong>{ARCHETYPE_LABELS[archetype]}</strong></td>
                    </tr>
                    <tr>
                      <td>Бонус</td>
                      <td style={{ color: 'var(--success)' }}>{ARCHETYPE_BONUS[archetype]}</td>
                    </tr>
                    <tr>
                      <td>Стартовые деньги</td>
                      <td className="money">1 250</td>
                    </tr>
                    <tr>
                      <td>Боевой уровень</td>
                      <td>1</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block mt12"
              disabled={isPending}
            >
              {isPending
                ? <><span className="spinner" />Создание...</>
                : <><Check size={13} style={{ marginRight: 5, verticalAlign: 'middle' }} />Создать персонажа</>}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
