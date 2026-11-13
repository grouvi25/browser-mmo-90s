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
import { ArrowRight, Copy, Flag, Link2, Package, RefreshCw, RotateCcw, Shield, Sword, Zap } from 'lucide-react'
import { battlesApi, type BattleJournalPage, type JournalKind } from '../../shared/api/battles.api'
import { pageNumbers } from './page-numbers'
import './battle-journal.css'

const ICON: Record<JournalKind, typeof Sword> = {
  hit: Sword, crit: Zap, pierce: Zap, dodge: ArrowRight, block: Shield,
  move: ArrowRight, item: Package, weapon: RefreshCw, surrender: Flag,
}

// Время по Москве, как в чате (№37).
function time(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
}

/** Строка журнала текстом — как на экране, но без значков. */
function plainLine(line: BattleJournalPage['items'][number]) {
  return `[${time(line.at)}] Р${line.round} ${line.actor}${line.target ? ` → ${line.target}` : ''}: ${line.text}`
}

async function writeClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return } catch { /* старый браузер или нет разрешения */ }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const done = document.execCommand('copy')
  area.remove()
  if (!done) throw new Error('copy failed')
}

/**
 * Весь журнал боя в буфер (обращение №70: «нельзя скопировать лог, а так можно
 * изучить позже или скинуть в поддержку»). Собираются все страницы, строки
 * идут по порядку боя, сверху номер боя — по нему поддержка найдёт бой.
 */
function CopyJournal({ battleId, first }: { battleId: string; first: BattleJournalPage }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle')
  const copy = async () => {
    setState('busy')
    try {
      const pages = [first]
      for (let n = 1; n <= first.pages; n++) if (n !== first.page) pages.push(await battlesApi.getJournal(battleId, n))
      pages.sort((a, b) => a.page - b.page)
      const lines = pages.flatMap(p => p.items).reverse().map(plainLine)
      const head = [`Бой ${battleId}`, watchUrl(battleId)]
      if (first.battle.status === 'FINISHED') head.push(`Бой окончен${first.battle.winner ? `: победил ${first.battle.winner}` : ''} · раундов ${first.battle.rounds}`)
      await writeClipboard([...head, ...lines].join('\n'))
      setState('done')
    } catch { setState('fail') }
    window.setTimeout(() => setState('idle'), 2500)
  }
  return (
    <button type="button" className={`bj-copy is-${state}`} disabled={state === 'busy'} onClick={() => void copy()}>
      <Copy size={12} aria-hidden="true" /> {state === 'busy' ? 'Собираю…' : state === 'done' ? 'Скопировано' : state === 'fail' ? 'Не получилось' : 'Скопировать журнал'}
    </button>
  )
}

const watchUrl = (battleId: string) => `${window.location.origin}/battle/${battleId}/watch`

/** Ссылка на бой (№107): поддержка открывает бой целиком, а не выдержку из журнала. */
function CopyLink({ battleId }: { battleId: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle')
  const copy = async () => {
    try { await writeClipboard(watchUrl(battleId)); setState('done') } catch { setState('fail') }
    window.setTimeout(() => setState('idle'), 2500)
  }
  return (
    <button type="button" className={`bj-copy bj-copy--link is-${state}`} onClick={() => void copy()}>
      <Link2 size={12} aria-hidden="true" /> {state === 'done' ? 'Ссылка скопирована' : state === 'fail' ? 'Не получилось' : 'Ссылка на бой'}
    </button>
  )
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
  if (!data || (data.total === 0 && data.battle.status !== 'FINISHED')) return <p className="bj-note">Событий пока нет.</p>

  return (
    <div className="bj">
      {data.battle.status === 'FINISHED' && (
        <p className="bj-result">
          Бой окончен{data.battle.winner ? <>: победил <b>{data.battle.winner}</b></> : ''} · раундов {data.battle.rounds}
        </p>
      )}
      {data.battle.status === 'FINISHED' && !!data.battle.fighters?.length && (() => {
        const fighters = data.battle.fighters
        const fallen = fighters.filter(f => !f.alive && !f.surrendered)
        const gave = fighters.filter(f => f.surrendered)
        const exp = fighters.filter(f => f.exp > 0)
        return <ul className="bj-summary">
          {fallen.length > 0 && <li>Погибли: {fallen.map(f => f.name).join(', ')}</li>}
          {gave.length > 0 && <li>Сдались: {gave.map(f => f.name).join(', ')}</li>}
          <li>Опыт: {exp.length ? exp.map(f => `${f.name} +${f.exp.toLocaleString('ru-RU')}`).join(', ') : 'никто не получил'}</li>
        </ul>
      })()}
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
      <div className="bj-foot">
        {data.pages > 1 && (
          <nav className="bj-pages" aria-label="Страницы журнала">
            {pageNumbers(data.page, data.pages).map((n, i) => n === null
              ? <span key={`gap-${i}`} className="bj-gap">…</span>
              : <button key={n} type="button" aria-current={n === data.page ? 'page' : undefined}
                  className={n === data.page ? 'is-active' : ''} onClick={() => setPage(n)}>{n}</button>)}
          </nav>
        )}
        {data.total > 0 && <div className="bj-actions"><CopyLink battleId={battleId} /><CopyJournal battleId={battleId} first={data} /></div>}
      </div>
    </div>
  )
}
