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
type StatKey = typeof STAT_KEYS[number]
type Draft = Partial<Record<StatKey, number>>

const RESPEC_PRICE = 5000
const MAX_STAT = 20

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

/** Производные параметры — формулы те же, что на сервере. */
function derived(s: Record<string, number>, level: number) {
  return { hp: 60 + s.end * 6 + level * 2, carry: 20 + s.str * 6, init: s.rea * 1.2 + s.agi * 0.6 }
}

function Delta({ now, next, digits = 0, unit = '' }: { now: number; next: number; digits?: number; unit?: string }) {
  const diff = next - now
  return <>{next.toFixed(digits)}{unit}{Math.abs(diff) > 1e-9 && <span className="stats-delta"> ({diff > 0 ? '+' : ''}{diff.toFixed(digits)})</span>}</>
}

/** Обещание игрокам 22.10: «+» и «−» только двигают черновик — видно, как
    меняются производные параметры, — а тратятся очки по «Подтвердить». */
export function StatsPage() {
  const qc = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [draft, setDraft] = useState<Draft>({})

  const { data: char, isLoading } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }
  const done = (data: { message: string }) => {
    setDraft({})
    void qc.invalidateQueries({ queryKey: ['character'] })
    showMsg('success', data.message)
  }
  const fail = (err: unknown) => showMsg('error', err instanceof ApiError ? err.message : 'Ошибка')
  type Reply = { message: string; stats: CharacterStats }

  const applyMut = useMutation({
    mutationFn: (deltas: Draft) => api.post<Reply>('/api/characters/stats/apply', { deltas }),
    onSuccess: done, onError: fail,
  })
  const respecMut = useMutation({
    mutationFn: () => api.post<Reply>('/api/characters/stats/respec', {}),
    onSuccess: done, onError: fail,
  })
  const buyMut = useMutation({
    mutationFn: () => api.post<Reply>('/api/characters/stats/respec/buy', {}),
    onSuccess: done, onError: fail,
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>
  if (!char || !char.stats) return <div className="alert alert-error">Персонаж не найден</div>

  const s = char.stats as unknown as Record<string, number>
  const used = Object.values(draft).reduce((sum, v) => sum + (v ?? 0), 0)
  const points = char.stats.pointsAvailable - used
  const next: Record<string, number> = Object.fromEntries(STAT_KEYS.map(k => [k, (s[k] ?? 0) + (draft[k] ?? 0)]))
  const before = derived(s, char.battleLevel)
  const after = derived(next, char.battleLevel)
  const scrolls = char.stats.respecScrolls ?? 0
  const busy = applyMut.isPending || respecMut.isPending || buyMut.isPending
  const bump = (key: StatKey, d: 1 | -1) => setDraft(prev => ({ ...prev, [key]: Math.max(0, (prev[key] ?? 0) + d) }))

  return (
    <div style={{ maxWidth: 640 }}>
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="panel panel-gold">
        <div className="panel-header">
          <span className="panel-title">
            <BarChart2 size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Характеристики — {char.nickname}
          </span>
          <span style={{ fontSize: 13.9, color: 'var(--text-dim)' }}>
            Боевой уровень: {char.battleLevel}
          </span>
        </div>
        <div className="panel-body">
          {/* Производные — сверху, чтобы при «+» и «−» были перед глазами. */}
          <div className="stats-derived">
            <div><span><Heart size={11} /> HP</span><b><Delta now={before.hp} next={after.hp} /></b><small>60 + ВЫН×6 + Ур.×2</small></div>
            <div><span><Scale size={11} /> Перенос веса</span><b><Delta now={before.carry} next={after.carry} unit=" кг" /></b><small>20 + СИЛ×6</small></div>
            <div><span><Zap size={11} /> Инициатива</span><b>~<Delta now={before.init} next={after.init} digits={1} /></b><small>РЕА×1.2 + ЛВК×0.6</small></div>
          </div>

          {char.stats.pointsAvailable > 0 ? (
            <div className="alert alert-warning mb12">
              Свободных очков: <strong>{points}</strong>{used > 0 && <> (в черновике {used})</>}.
              «+» и «−» ничего не тратят — очки вкладываются по кнопке «Подтвердить».
            </div>
          ) : (
            <div className="alert alert-info mb12" style={{ fontSize: 13.9 }}>
              Очки характеристик начисляются за повышение боевого уровня (+1 за уровень).
              Архетип «Студент» даёт +2 очка при создании персонажа.
            </div>
          )}

          <table className="data-table stats-table">
            <thead><tr><th>Характеристика</th><th>Что даёт</th><th>Значение</th><th aria-label="Изменить" /></tr></thead>
            <tbody>
              {STAT_KEYS.map(key => {
                const val = next[key]
                const add = draft[key] ?? 0
                return (
                  <tr key={key}>
                    <td><span className="stats-table__icon" aria-hidden="true">{STAT_ICON_MAP[key]}</span> <b>{STAT_FULL[key]}</b></td>
                    <td className="text-dim">{STAT_DESCRIPTIONS[key]}</td>
                    <td className="stats-table__value">{val}{add > 0 && <span className="stats-delta"> (+{add})</span>}</td>
                    <td className="stats-table__action">
                      <button className="btn btn-sm" disabled={add <= 0 || busy}
                        onClick={() => bump(key, -1)} title={`−1 ${STAT_FULL[key]}`} aria-label={`−1 ${STAT_FULL[key]}`}>−</button>
                      <button className="btn btn-sm btn-success" disabled={points <= 0 || val >= MAX_STAT || busy}
                        onClick={() => bump(key, 1)} title={`+1 ${STAT_FULL[key]}`} aria-label={`+1 ${STAT_FULL[key]}`}>+</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="stats-actions">
            <button className="btn" disabled={used === 0 || busy} onClick={() => setDraft({})}>Сбросить</button>
            <button className="btn btn-primary" disabled={used === 0 || busy} onClick={() => applyMut.mutate(draft)}>Подтвердить</button>
          </div>

          <div className="stats-respec">
            <b>Свитки перераспределения: {scrolls}</b>
            <p className="text-dim">Свиток возвращает все вложенные очки, характеристики — к стартовым. Два свитка выдаются бесплатно, следующие — {RESPEC_PRICE.toLocaleString('ru')} ₽.</p>
            <button className="btn" disabled={scrolls <= 0 || busy}
              onClick={() => { if (window.confirm('Вернуть все вложенные очки? Будет потрачен один свиток.')) respecMut.mutate() }}>Использовать свиток</button>
            <button className="btn" disabled={busy} onClick={() => buyMut.mutate()}>Купить свиток · {RESPEC_PRICE.toLocaleString('ru')} ₽</button>
          </div>
        </div>
      </div>
    </div>
  )
}
