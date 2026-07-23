import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Swords, Plus, RefreshCw, Clock } from 'lucide-react'
import { battlesApi, type OpenDuel } from '../../shared/api/battles.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ARCHETYPE_LABELS } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'

function formatAge(createdAt: string) {
  const sec = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (sec < 60) return `${sec} сек.`
  return `${Math.floor(sec / 60)} мин.`
}

export function PvpPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [levelMin, setLevelMin] = useState<number | ''>('')
  const [levelMax, setLevelMax] = useState<number | ''>('')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const { data: openDuels = [], isLoading: duelsLoading, refetch } = useQuery({
    queryKey: ['pvp', 'open'],
    queryFn: () => battlesApi.listOpenDuels(),
    refetchInterval: 5000,
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const createMut = useMutation({
    mutationFn: () => battlesApi.createPvpDuel(
      levelMin !== '' ? levelMin : undefined,
      levelMax !== '' ? levelMax : undefined,
    ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => { showMsg('error', err instanceof ApiError ? err.message : 'Ошибка') },
  })

  const acceptMut = useMutation({
    mutationFn: (battleId: string) => battlesApi.acceptDuel(battleId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      localStorage.setItem('mmo_current_battle', data.battleId)
      navigate(`/battle/${data.battleId}`)
    },
    onError: (err) => { showMsg('error', err instanceof ApiError ? err.message : 'Ошибка') },
  })

  const inBattle = char?.status === 'IN_BATTLE'
  const charLevel = char?.battleLevel ?? 1

  return (
    <div style={{ maxWidth: 700 }}>
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

      <div className="row" style={{ gap: 8 }}>
        {/* Создать дуэль */}
        <div className="panel" style={{ flex: '0 0 240px', borderColor: 'var(--green-dim)' }}>
          <div className="panel-header">
            <span className="panel-title">
              <Plus size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Создать вызов
            </span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Уровневый диапазон (необязательно):
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number" min={1} max={99}
                className="form-input" style={{ width: 60 }}
                placeholder="от"
                value={levelMin}
                onChange={e => setLevelMin(e.target.value ? Number(e.target.value) : '')}
              />
              <span style={{ color: 'var(--text-dim)' }}>—</span>
              <input
                type="number" min={1} max={99}
                className="form-input" style={{ width: 60 }}
                placeholder="до"
                value={levelMax}
                onChange={e => setLevelMax(e.target.value ? Number(e.target.value) : '')}
              />
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', fontStyle: 'italic' }}>
              По умолчанию: ±2 уровня от вас (Ур. {Math.max(1, charLevel - 2)}–{Math.min(99, charLevel + 2)})
            </div>
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

        {/* Список открытых дуэлей */}
        <div className="panel panel-gold" style={{ flex: 1 }}>
          <div className="panel-header">
            <span className="panel-title">
              <Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Открытые дуэли
            </span>
            <button className="btn btn-sm" onClick={() => refetch()} title="Обновить">
              <RefreshCw size={11} />
            </button>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            {duelsLoading ? (
              <div className="loading"><span className="spinner" />Загрузка...</div>
            ) : openDuels.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 12px', color: 'var(--text-dim)', fontSize: 11 }}>
                Нет открытых дуэлей. Создай первую!
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Игрок</th>
                    <th>Уровень</th>
                    <th>Диапазон</th>
                    <th>Ожидает</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {openDuels.map((duel: OpenDuel) => (
                    <tr key={duel.battleId} style={{ opacity: duel.canJoin ? 1 : 0.5 }}>
                      <td>
                        <span style={{ fontWeight: 'bold', color: 'var(--text-bright)' }}>
                          {duel.creator?.nickname ?? '?'}
                        </span>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                          {ARCHETYPE_LABELS[duel.creator?.archetype ?? ''] ?? ''}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                        {duel.creator?.level ?? '?'}
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                        {duel.levelMin}–{duel.levelMax}
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        <Clock size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                        {formatAge(duel.createdAt)}
                      </td>
                      <td>
                        {duel.canJoin ? (
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={acceptMut.isPending || inBattle}
                            onClick={() => acceptMut.mutate(duel.battleId)}
                          >
                            Принять
                          </button>
                        ) : (
                          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                            Нужен ур.{duel.levelMin}–{duel.levelMax}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
