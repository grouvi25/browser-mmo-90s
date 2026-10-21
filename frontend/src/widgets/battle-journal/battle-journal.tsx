// =============================================================
// Журнал боя с сервера: по 10 строк, страницы 1-2-3…
//
// Правка заказчика (20.10.2026): «Лог журнала должен сохраняться. Пусть
// будет 10 строк, и их можно листать». Журнал берётся из сохранённых
// ходов боя, поэтому переживает перезагрузку и открывается из Истории
// боёв уже после боя. Во время боя обновляется по номеру раунда.
// =============================================================
import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight, Flag, Package, RefreshCw, RotateCcw, Shield, Sword, Zap } from 'lucide-react'
import { battlesApi, type JournalKind } from '../../shared/api/battles.api'
import { pageNumbers } from './page-numbers'
import './battle-journal.css'

const ICON: Record<JournalKind, typeof Sword> = {
  hit: Sword, crit: Zap, pierce: Zap, dodge: ArrowRight, block: Shield,
  move: ArrowRight, item: Package, weapon: RefreshCw, surrender: Flag,
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function BattleJournal({ battleId, refreshKey = 0 }: { battleId: string; refreshKey?: number }) {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['battle', battleId, 'journal', page, refreshKey],
    queryFn: () => battlesApi.getJournal(battleId, page),
    placeholderData: keepPreviousData,
  })
  // Новый раунд — новые строки сверху: возвращаемся на первую страницу.
  useEffect(() => { setPage(1) }, [refreshKey])

  if (query.isLoading) return <p className="bj-note" role="status">Загрузка журнала…</p>
  if (query.isError) {
    return <p className="bj-note" role="alert">
      Журнал не загрузился. <button type="button" className="bj-retry" onClick={() => void query.refetch()}><RotateCcw size={12} /> Повторить</button>
    </p>
  }
  const data = query.data
  if (!data || data.total === 0) return <p className="bj-note">Событий пока нет.</p>

  return (
    <div className="bj">
      {data.battle.status === 'FINISHED' && (
        <p className="bj-result">
          Бой окончен{data.battle.winner ? <>: победил <b>{data.battle.winner}</b></> : ''} · раундов {data.battle.rounds}
        </p>
      )}
      <ol className="bj-lines">
        {data.items.map(line => {
          const Icon = ICON[line.kind]
          return (
            <li key={line.id} className={`bj-line bj-line--${line.kind} bj-side-${line.side === 2 ? 2 : 1}`}>
              <span className="bj-time">[{time(line.at)}]</span>
              <span className="bj-round">Р{line.round}</span>
              <span className="bj-text">
                <b className="bj-actor">{line.actor}</b>
                {line.target && <> → <b className="bj-target">{line.target}</b></>}
                {': '}<Icon size={12} aria-hidden="true" className="bj-icon" /> {line.text}
              </span>
            </li>
          )
        })}
      </ol>
      {data.pages > 1 && (
        <nav className="bj-pages" aria-label="Страницы журнала">
          {pageNumbers(data.page, data.pages).map((n, i) => n === null
            ? <span key={`gap-${i}`} className="bj-gap">…</span>
            : <button key={n} type="button" aria-current={n === data.page ? 'page' : undefined}
                className={n === data.page ? 'is-active' : ''} onClick={() => setPage(n)}>{n}</button>)}
        </nav>
      )}
    </div>
  )
}
