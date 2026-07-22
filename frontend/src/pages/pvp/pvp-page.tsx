import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Swords, Plus, ArrowRight } from 'lucide-react'
import { battlesApi } from '../../shared/api/battles.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'

export function PvpPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [battleIdInput, setBattleIdInput] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const createMut = useMutation({
    mutationFn: () => battlesApi.createPvpDuel(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      showMsg('success', `Дуэль создана! ID: ${data.battleId}`)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => {
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
    },
  })

  const acceptMut = useMutation({
    mutationFn: (id: string) => battlesApi.acceptDuel(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => {
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
    },
  })

  const inBattle = char?.status === 'IN_BATTLE'

  return (
    <div style={{ maxWidth: 600 }}>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      {inBattle && (
        <div className="alert alert-warning mb8">
          <Swords size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Вы уже в бою!{' '}
          <a href="#" onClick={e => { e.preventDefault(); const id = localStorage.getItem('mmo_current_battle'); if (id) navigate(`/battle/${id}`) }}>
            Вернуться →
          </a>
        </div>
      )}

      <div className="panel panel-gold">
        <div className="panel-header">
          <span className="panel-title">
            <Swords size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            ДУЭЛЬНЫЙ ЗАЛ
          </span>
          <span className="panel-subtitle">PvP 1vs1</span>
        </div>
        <div className="panel-body">
          <div className="alert alert-info mb12">
            Победа в PvP даёт больше опыта чем PvE. Проигрыш тоже даёт 20% опыта.
          </div>

          <div className="row">
            <div className="col panel" style={{ margin: 0, borderColor: 'var(--green-dim)' }}>
              <div className="panel-header">
                <span className="panel-title">
                  <Plus size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Создать дуэль
                </span>
              </div>
              <div className="panel-body">
                <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Создай вызов — другой игрок примет его по ID дуэли.
                </p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending || inBattle}
                >
                  {createMut.isPending
                    ? <><span className="spinner" />Создание...</>
                    : <><Plus size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Создать вызов</>}
                </button>
              </div>
            </div>

            <div className="col panel" style={{ margin: 0, borderColor: 'var(--red-dim)' }}>
              <div className="panel-header">
                <span className="panel-title">
                  <ArrowRight size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  Принять дуэль
                </span>
              </div>
              <div className="panel-body">
                <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Введи ID дуэли от соперника:
                </p>
                <input
                  className="form-input mb8"
                  placeholder="UUID дуэли..."
                  value={battleIdInput}
                  onChange={e => setBattleIdInput(e.target.value)}
                />
                <button
                  className="btn btn-danger btn-block"
                  onClick={() => acceptMut.mutate(battleIdInput.trim())}
                  disabled={!battleIdInput.trim() || acceptMut.isPending || inBattle}
                >
                  {acceptMut.isPending
                    ? <><span className="spinner" />Принятие...</>
                    : <><Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />Принять вызов</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
