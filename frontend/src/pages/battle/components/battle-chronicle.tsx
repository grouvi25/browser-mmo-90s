// The compact feed uses the same persisted journal as the full log. Reloads,
// automatic rounds and the other player's moves must not disappear from it.
import { useEffect, useRef } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { battlesApi } from '../../../shared/api/battles.api'

interface BattleChronicleProps {
  battleId: string
  refreshKey: number
  playerSide?: number
  onOpenLog: () => void
}

export function PersistedBattleChronicle({ battleId, refreshKey, playerSide, onOpenLog }: BattleChronicleProps) {
  const tail = useRef<HTMLOListElement>(null)
  const query = useQuery({
    queryKey: ['battle', battleId, 'chronicle', refreshKey],
    queryFn: () => battlesApi.getJournal(battleId),
    placeholderData: keepPreviousData,
    refetchInterval: 3000,
  })
  const lines = [...(query.data?.items ?? [])].reverse()
  const lastId = lines[lines.length - 1]?.id
  useEffect(() => { tail.current?.scrollTo({ top: tail.current.scrollHeight }) }, [lastId])

  return <section className="battle-chronicle" aria-label="Хроника боя">
    <header><b>Хроника</b><button type="button" onClick={onOpenLog}>весь лог</button></header>
    {query.isError ? <p className="battle-chronicle__empty" role="alert">
      Журнал не загрузился. <button type="button" onClick={() => void query.refetch()}>Повторить</button>
    </p> : query.isLoading ? <p className="battle-chronicle__empty" role="status">Загрузка хроники…</p>
      : lines.length === 0 ? <p className="battle-chronicle__empty">Бой только начался — событий пока нет.</p>
        : <ol ref={tail}>
          {lines.map(line => <li key={line.id} className={line.side === playerSide ? 'is-mine' : 'is-theirs'}
            title={`Раунд ${line.round}. ${line.actor}${line.target ? ` → ${line.target}` : ''}: ${line.text}`}>
            <i className="battle-chronicle__clock">[{new Date(line.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}]</i>
            <b>{line.actor}</b>
            <span className={`battle-chronicle__label is-${line.kind}`}>{line.text}</span>
          </li>)}
        </ol>}
  </section>
}

// Хроника под полем. Поле держит пропорцию 3280:1798 и на широком экране
// упирается в ширину колонки — снизу остаётся пустая полоса бумаги.
// Туда и кладём последние события: игрок видит, чем кончился прошлый ход,
// не открывая лог.
import { EventIcon, getEvent, type RoundRecord } from './battle-events'

interface PreviewChronicleProps {
  rounds: RoundRecord[]
  playerName: string
  enemyName: string
  helperName?: string
  onOpenLog: () => void
}

export function BattleChronicle({ rounds, playerName, enemyName, helperName, onOpenLog }: PreviewChronicleProps) {
  const tail = useRef<HTMLOListElement>(null)
  const lines = rounds.flatMap(round => round.events.map((event, index) => ({
    key: `${round.round}-${index}`, round: round.round, event, at: round.at,
  })))
  // Время в начале строки — как набрано в макете: «[16:31] …».
  const clock = (at?: number) => {
    if (!at) return null
    const d = new Date(at)
    return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`
  }
  // Прокручиваем к свежему: список растёт вниз, как в мессенджере.
  useEffect(() => { tail.current?.scrollTo({ top: tail.current.scrollHeight }) }, [lines.length])

  return <section className="battle-chronicle" aria-label="Хроника боя">
    <header>
      <b>Хроника</b>
      <button type="button" onClick={onOpenLog}>весь лог</button>
    </header>
    {lines.length === 0
      ? <p className="battle-chronicle__empty">Бой только начался — событий пока нет.</p>
      : <ol ref={tail}>
        {lines.map(line => {
          const view = getEvent(line.event)
          // Помощник играет за свою сторону и подписан своим именем.
          const helper = line.event.actor === 'helper'
          const mine = line.event.actor === 'player' || helper
          return <li key={line.key} className={mine ? 'is-mine' : 'is-theirs'}>
            <i className="battle-chronicle__clock">{clock(line.at) ?? line.round}</i>
            <span className="battle-chronicle__icon" style={{ color: view.color }}><EventIcon type={view.type} size={10} /></span>
            <b>{helper ? helperName ?? 'Помощник' : mine ? playerName : enemyName}</b>
            {/* Цвет берём из таблицы стилей, а не из события: те тона
                рассчитаны на тёмную плашку и на бумаге не читаются. */}
            <span className={`battle-chronicle__label is-${view.type}`}>{view.label}</span>
            {line.event.finalDamage > 0 && <em>−{line.event.finalDamage}</em>}
            {line.event.intercepted && <span className="battle-chronicle__label">принял {helperName ?? 'помощник'}</span>}
          </li>
        })}
      </ol>}
  </section>
}
