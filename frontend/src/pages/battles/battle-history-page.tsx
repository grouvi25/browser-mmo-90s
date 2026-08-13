import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Swords, Trophy, Skull, Minus } from 'lucide-react'
import { battlesApi } from '../../shared/api/battles.api'

function ResultBadge({ result }: { result: 'win' | 'lose' | 'draw' }) {
  if (result === 'win')  return <span style={{ color: 'var(--success)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 3 }}><Trophy size={11} />Победа</span>
  if (result === 'lose') return <span style={{ color: 'var(--danger)',  fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 3 }}><Skull  size={11} />Поражение</span>
  return <span style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}><Minus size={11} />Ничья</span>
}

function formatDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function BattleHistoryPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['battles', 'history', page],
    queryFn: () => battlesApi.getBattleHistory(page, 20),
  })

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            История боёв
          </span>
          {data && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Всего: {data.total}
            </span>
          )}
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!data || data.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 12px', color: 'var(--text-dim)', fontSize: 11 }}>
              Боёв ещё не было. <a href="#" onClick={e => { e.preventDefault(); navigate('/pvp') }}>В бой →</a>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип</th>
                    <th>Противник</th>
                    <th>Итог</th>
                    <th className="num">Раундов</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {formatDate(b.finishedAt)}
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {b.type === 'PVE_BOT' ? (
                          <span className="tag">PvE</span>
                        ) : (
                          <span className="tag tag-weapon">PvP</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontWeight: 'bold', fontSize: 11 }}>{b.opponent}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 4 }}>Ур.{b.opponentLevel}</span>
                      </td>
                      <td><ResultBadge result={b.result} /></td>
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{b.rounds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Пагинация */}
              {data.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', alignSelf: 'center' }}>
                    {page} / {data.pages}
                  </span>
                  <button className="btn btn-sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>→</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
