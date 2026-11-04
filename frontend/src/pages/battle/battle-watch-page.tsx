// =============================================================
// Бой глазами зрителя (заказчик 4.11: «нужна кнопка Смотреть бой на чужих
// боях»). Поле то же, что у бойцов, но клетки не нажимаются; сервер отдаёт
// только публичное, без выбранных и ещё не сыгранных ходов.
// =============================================================
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { battlesApi, type BattleWatchView } from '../../shared/api/battles.api'
import { ApiError } from '../../shared/api/client'
import { BattleJournal } from '../../widgets/battle-journal/battle-journal'
import { BattleGrid, companionFigures } from './battle-page'
import { PersistedBattleChronicle } from './components/battle-chronicle'
import './battle-watch.css'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secondsLeft(deadline?: number) {
  if (!deadline) return null
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

function Fighter({ fighter, live }: {
  fighter: BattleWatchView['fighters'][number]
  live?: NonNullable<BattleWatchView['live']>['participants'][number]
}) {
  const hp = live?.hpCurrent ?? fighter.hpCurrent
  const hpMax = live?.hpMax ?? fighter.hpMax
  const out = live ? !live.isAlive || live.isSurrendered : hp <= 0
  return (
    <li className={'bwatch-fighter' + (out ? ' is-out' : '')}>
      <span className="bwatch-fighter__who">
        <Link to={`/u/${encodeURIComponent(fighter.name)}`}>{fighter.name}</Link> <i>{fighter.level} ур.</i>
      </span>
      <b className="bwatch-fighter__num">{live?.isSurrendered ? 'сдался' : `${hp} / ${hpMax}`}</b>
      <span className="bwatch-fighter__hp"><i style={{ transform: `scaleX(${hpMax ? Math.max(0, hp / hpMax) : 0})` }} /></span>
      {(fighter.primaryHand || fighter.secondaryHand) && (
        <small className="bwatch-fighter__gear">{[fighter.primaryHand, fighter.secondaryHand].filter(Boolean).join(' и ')}</small>
      )}
    </li>
  )
}

export function BattleWatchPage() {
  const { id = '' } = useParams<{ id: string }>()
  const valid = UUID_RE.test(id)
  const [logOpen, setLogOpen] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(timer) }, [])

  const query = useQuery({
    queryKey: ['battle', id, 'watch'],
    queryFn: () => battlesApi.watchBattle(id),
    enabled: valid,
    retry: false,
    refetchInterval: q => q.state.data?.battle.status === 'ACTIVE' ? 3000 : false,
  })

  const back = <Link className="btn btn-sm" to="/pvp?tab=RUNNING">К списку боёв</Link>
  if (!valid) return <Navigate to="/pvp?tab=RUNNING" replace />
  if (query.isLoading) return <p className="bwatch-note" role="status">Загружаем бой…</p>
  if (query.isError || !query.data) {
    const text = query.error instanceof ApiError ? query.error.message : 'Бой не загрузился'
    return <div className="bwatch-note" role="alert"><p>{text}</p>
      <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Повторить</button> {back}</div>
  }

  const { battle, live, fighters, isMine } = query.data
  // Свой идущий бой смотрят с экрана бойца, там можно ходить.
  if (isMine && battle.status === 'ACTIVE') return <Navigate to={`/battle/${id}`} replace />

  const running = battle.status === 'ACTIVE'
  const parts = live?.participants ?? []
  const names = Object.fromEntries([
    ...fighters.map(f => [f.participantId, f.name]),
    ...parts.flatMap(p => [
      ...(p.helper ? [[`helper:${p.participantId}`, `${p.helper.name} (помощник)`]] : []),
      ...(p.dog ? [[`dog:${p.participantId}`, `${p.dog.name} (собака)`]] : []),
    ]),
  ])
  const round = live?.roundNumber ?? battle.roundCount
  const clock = running ? secondsLeft(live?.roundDeadline) : null
  const winners = fighters.filter(f => f.side === battle.winnerSide).map(f => f.name)

  return (
    <section className="bwatch">
      <header className="bwatch-head">
        <b>{running ? 'Бой идёт' : 'Бой окончен'}</b>
        <span>Раунд {round} / {battle.maxRounds}</span>
        {clock && <span>до конца хода {clock}</span>}
        {!running && <span>{winners.length ? `Победа: ${winners.join(', ')}` : 'Ничья'}</span>}
        {back}
      </header>

      {live && (
        <div className="bwatch-field battle-field-v3">
          <BattleGrid readOnly playerName="" enemyName="" playerDefeated={false} enemyDefeated={false}
            playerHit={false} enemyHit={false} playerAttack={false} enemyAttack={false} lastEvent={null}
            playerSide={1} participants={[...parts, ...companionFigures(parts)]}
            arena={live.arena} obstacles={live.obstacles} names={names} />
        </div>
      )}

      <div className="bwatch-sides">
        {[1, 2].map(side => (
          <ul key={side} className={`bwatch-side bwatch-side--${side}`} aria-label={`Сторона ${side}`}>
            {fighters.filter(f => f.side === side).map(f => (
              <Fighter key={f.participantId} fighter={f} live={parts.find(p => p.participantId === f.participantId)} />
            ))}
          </ul>
        ))}
      </div>

      <div className="bwatch-log">
        {logOpen
          ? <>
            <button type="button" className="btn btn-sm" onClick={() => setLogOpen(false)}>Свернуть журнал</button>
            <BattleJournal battleId={id} refreshKey={round} />
          </>
          : <PersistedBattleChronicle battleId={id} refreshKey={round} playerSide={1} finished={!running} onOpenLog={() => setLogOpen(true)} />}
      </div>
    </section>
  )
}
