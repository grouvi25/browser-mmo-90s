import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import {
  STAT_FULL, STAT_DESCRIPTIONS,
  type CharacterStats
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { useState } from 'react'
import {
  Dumbbell, Wind, Activity, Target, Droplet, Clover, Flame, Crown,
  Heart, Scale, Zap, BarChart2,
} from 'lucide-react'

const STAT_KEYS = ['str', 'agi', 'rea', 'acc', 'end', 'luck', 'agr', 'auth'] as const

// Lucide иконки для каждой характеристики
const STAT_ICON_MAP: Record<string, React.ReactNode> = {
  str:  <Dumbbell size={20} />,
  agi:  <Wind     size={20} />,
  rea:  <Activity size={20} />,
  acc:  <Target   size={20} />,
  end:  <Droplet  size={20} />,
  luck: <Clover   size={20} />,
  agr:  <Flame    size={20} />,
  auth: <Crown    size={20} />,
}

export function StatsPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: char, isLoading } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const distributeMut = useMutation({
    mutationFn: (stat: string) =>
      api.post<{ message: string; stats: CharacterStats }>('/api/characters/stats/distribute', { stat, amount: 1 }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', data.message)
    },
    onError: (err) => {
      showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
    },
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>
  if (!char || !char.stats) return <div className="alert alert-error">Персонаж не найден</div>

  const s = char.stats
  const points = s.pointsAvailable

  return (
    <div style={{ maxWidth: 600 }}>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="panel panel-gold">
        <div className="panel-header">
          <span className="panel-title">
            <BarChart2 size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Характеристики — {char.nickname}
          </span>
          <span style={{ fontSize: 12.75, color: 'var(--text-dim)' }}>
            Боевой уровень: {char.battleLevel}
          </span>
        </div>
        <div className="panel-body">
          {points > 0 ? (
            <div className="alert alert-warning mb12">
              Доступно <strong>{points}</strong> очк{points === 1 ? 'о' : 'а'} для распределения!
              Нажми «+» рядом с нужной характеристикой.
            </div>
          ) : (
            <div className="alert alert-info mb12" style={{ fontSize: 12.75 }}>
              Очки характеристик начисляются за повышение боевого уровня (+1 за уровень).
              Архетип «Студент» даёт +2 очка при создании персонажа.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {STAT_KEYS.map(key => {
              const val = (s as unknown as Record<string, number>)[key] ?? 0
              const isMax = val >= 20
              return (
                <div key={key} style={{
                  background: 'var(--bg-panel2)',
                  border: '1px solid var(--border)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <div style={{ fontSize: 22, color: 'var(--text-dim)', lineHeight: 1 }}>
                    {STAT_ICON_MAP[key]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13.75, fontWeight: 'bold', color: 'var(--text-title)' }}>
                        {STAT_FULL[key]}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'var(--gold)', fontWeight: 'bold' }}>
                          {val}
                        </span>
                        {points > 0 && !isMax && (
                          <button
                            className="btn btn-sm btn-success"
                            style={{ padding: '2px 8px', minWidth: 28 }}
                            disabled={distributeMut.isPending}
                            onClick={() => distributeMut.mutate(key)}
                            title={`+1 ${STAT_FULL[key]}`}
                          >
                            +
                          </button>
                        )}
                        {isMax && (
                          <span style={{ fontSize: 12, color: 'var(--gold)', opacity: 0.7 }}>МАКС</span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                      {STAT_DESCRIPTIONS[key]}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* HP & derived stats */}
          <div style={{ marginTop: 16, padding: 10, background: 'var(--bg-panel2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13.25, fontWeight: 'bold', color: 'var(--text-bright)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={12} /> Производные параметры
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12.75 }}>
              <div>
                <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Heart size={11} /> HP
                </div>
                <div style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                  {char.hpCurrent} / {char.hpMax}
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>60 + ВЫН×6 + Ур.×2</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Scale size={11} /> Перенос веса
                </div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                  {20 + s.str * 6} кг
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>20 + СИЛ×6</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Zap size={11} /> Инициатива
                </div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                  ~{(s.rea * 1.2 + s.agi * 0.6).toFixed(1)}
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>РЕА×1.2 + ЛВК×0.6</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
