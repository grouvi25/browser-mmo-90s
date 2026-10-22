import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Swords, Trophy, Skull, Minus } from 'lucide-react'
import { battlesApi } from '../../shared/api/battles.api'
import { BattleJournal } from '../../widgets/battle-journal/battle-journal'

function ResultBadge({ result }: { result: 'win' | 'lose' | 'draw' }) {
  if (result === 'win')  return <span style={{ color: 'var(--success)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 3 }}><Trophy size={11} />Победа</span>
  if (result === 'lose') return <span style={{ color: 'var(--danger)',  fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 3 }}><Skull  size={11} />Поражение</span>
  return <span style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}><Minus size={11} />Ничья</span>
}

function formatDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Поиск бойца (обещание игрокам 22.10): ник → его профиль и история боёв. */
function PlayerSearch({ onPick }: { onPick: (nickname: string) => void }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const found = useQuery({ queryKey: ['players', 'search', term], queryFn: () => battlesApi.searchPlayers(term), enabled: term.length >= 2 })
  return (
    <div className="panel">
      <div className="panel-body">
        <form className="player-search" onSubmit={e => { e.preventDefault(); setTerm(q.trim()) }}>
          <label>Найти бойца<input value={q} onChange={e => setQ(e.target.value)} placeholder="ник, от 2 букв" maxLength={30} /></label>
          <button className="btn" disabled={q.trim().length < 2}>Искать</button>
        </form>
        {found.data && (found.data.items.length === 0
          ? <p className="text-dim">Никого не нашли.</p>
          : <table className="data-table">
              <thead><tr><th>Боец</th><th className="num">Ур.</th><th>Бригада</th><th className="num">Бои / победы</th><th /></tr></thead>
              <tbody>{found.data.items.map(p => <tr key={p.nickname}>
                <td><Link to={`/u/${encodeURIComponent(p.nickname)}`}><b>{p.nickname}</b></Link></td>
                <td className="num">{p.level}</td>
                <td>{p.clan ?? '—'}</td>
                <td className="num">{p.battles} / {p.wins}</td>
                <td><button type="button" className="btn btn-sm" onClick={() => onPick(p.nickname)}>Его бои</button></td>
              </tr>)}</tbody>
            </table>)}
      </div>
    </div>
  )
}

export function BattleHistoryPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const who = params.get('who')
  const [page, setPage] = useState(1)
  // Журнал прошедшего боя раскрывается под его строкой.
  const [openLog, setOpenLog] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['battles', 'history', who ?? 'me', page],
    queryFn: () => who ? battlesApi.getHistoryOf(who, page, 20) : battlesApi.getBattleHistory(page, 20),
  })
  const pick = (nickname: string | null) => {
    setPage(1); setOpenLog(null)
    setParams(nickname ? { who: nickname } : {})
  }

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка...</div>

  return (
    <div style={{ maxWidth: 800 }}>
      <PlayerSearch onPick={pick} />
      {isError && <div className="alert alert-error mb8">Боец не найден. <button type="button" className="btn btn-sm" onClick={() => pick(null)}>Мои бои</button></div>}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">
            <Swords size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            {who ? <>Бои: {who} · <button type="button" className="btn btn-sm" onClick={() => pick(null)}>мои бои</button></> : 'История боёв'}
          </span>
          {data && (
            <span style={{ fontSize: 13.65, color: 'var(--text-dim)' }}>
              Всего: {data.total}
            </span>
          )}
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!data?.items?.length ? (
            <div style={{ textAlign: 'center', padding: '20px 12px', color: 'var(--text-dim)', fontSize: 13.9 }}>
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
                    <th aria-label="Журнал" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(b => (<Fragment key={b.id}>
                    <tr>
                      <td style={{ fontSize: 13.65, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                        {formatDate(b.finishedAt)}
                      </td>
                      <td style={{ fontSize: 13.65 }}>
                        {b.type === 'PVE_BOT' ? (
                          <span className="tag">PvE</span>
                        ) : (
                          <span className="tag tag-weapon">PvP</span>
                        )}
                      </td>
                      <td>
                        <span style={{ fontWeight: 'bold', fontSize: 13.9 }}>{b.opponent}</span>
                        <span style={{ fontSize: 13.49, color: 'var(--text-dim)', marginLeft: 4 }}>Ур.{b.opponentLevel}</span>
                      </td>
                      <td><ResultBadge result={b.result} /></td>
                      <td className="num" style={{ fontFamily: 'var(--font-mono)', fontSize: 13.9 }}>{b.rounds}</td>
                      <td>
                        <button type="button" className="btn btn-sm" aria-expanded={openLog === b.id}
                          onClick={() => setOpenLog(openLog === b.id ? null : b.id)}>
                          {openLog === b.id ? 'Скрыть' : 'Журнал'}
                        </button>
                      </td>
                    </tr>
                    {openLog === b.id && (
                      <tr className="history-journal-row">
                        <td colSpan={6}><BattleJournal battleId={b.id} /></td>
                      </tr>
                    )}
                  </Fragment>))}
                </tbody>
              </table>

              {/* Пагинация */}
              {data.pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
                  <span style={{ fontSize: 13.9, color: 'var(--text-dim)', alignSelf: 'center' }}>
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
