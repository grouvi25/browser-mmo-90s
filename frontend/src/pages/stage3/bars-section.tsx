import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Beer } from 'lucide-react'
import { barsApi } from '../../shared/api/bars.api'
import { fmt, remaining, Skeleton, Fault, Empty, Note } from './stage3-ui'

export const INTOX_STATE: Record<string, string> = {
  SOBER: 'Трезв',
  TIPSY: 'Навеселе',
  DRUNK: 'Пьяный',
  WASTED: 'В хлам',
}

export function BarsSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const bars = useQuery({ queryKey: ['bars'], queryFn: barsApi.list })
  const status = useQuery({ queryKey: ['bars', 'status'], queryFn: barsApi.status, refetchInterval: 30000 })

  const buy = useMutation({
    mutationFn: barsApi.buy,
    onSuccess: () => {
      setBad(false)
      setMsg('Заказ принят')
      void qc.invalidateQueries({ queryKey: ['bars'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (bars.isLoading) return <Skeleton rows={4} />
  if (bars.isError) return <Fault retry={() => bars.refetch()} />

  const offers = bars.data?.items.flatMap(bar => bar.barOffers.map(offer => ({ bar, offer }))) ?? []

  return (
    <>
      <IntoxicationPanel status={status.data} />
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      {offers.length === 0 ? (
        <Empty title="В барах пусто" hint="Владельцы ещё не сварили ни одной позиции — бару нужно сырьё с ферм." />
      ) : (
        <section className="menu-list">
          {offers.map(({ bar, offer }) => (
            <article key={offer.id}>
              <div>
                <span className="bar-name">{bar.name}</span>
                <h2>{offer.name}</h2>
                <p>
                  {offer.hpRestore ? '+' + offer.hpRestore + ' HP' : ''}
                  {offer.accuracyBuff ? '+' + Math.round(offer.accuracyBuff * 100) / 100 + ' к точности' : ''}
                  {offer.damageBuff ? '+' + Math.round(offer.damageBuff * 100) + '% урона' : ''}
                  {offer.alcoholDegrees ? ' · ' + offer.alcoholDegrees + '°' : ''}
                  {offer.buffMinutes ? ' · ' + offer.buffMinutes + ' мин' : ''}
                </p>
              </div>
              <strong>{fmt(offer.price)} ₽</strong>
              <button disabled={buy.isPending} onClick={() => buy.mutate(offer.id)}>Заказать</button>
            </article>
          ))}
        </section>
      )}
    </>
  )
}

/** Градус, штрафы и запрет боя — одним блоком, всегда на виду. */
export function IntoxicationPanel({ status }: { status?: {
  level: number
  state: string
  accuracy: number
  incomingDamage: number
  outgoingDamage: number
  canBattle: boolean
  soberAt: string | null
  hangoverUntil: string | null
} }) {
  return (
    <section className="intox">
      <Beer />
      <div>
        <b>{status ? INTOX_STATE[status.state] ?? status.state : '…'}</b>
        <span>
          градус {Math.round(status?.level ?? 0)}
          {status?.accuracy ? ' · точность ' + status.accuracy : ''}
          {status?.incomingDamage ? ' · получаемый урон ' + Math.round(status.incomingDamage * 100) + '%' : ''}
          {' · в бой '}{status?.canBattle === false ? 'нельзя' : 'можно'}
          {status?.soberAt ? ' · трезвость через ' + remaining(status.soberAt) : ''}
          {status?.hangoverUntil ? ' · похмелье ещё ' + remaining(status.hangoverUntil) : ''}
        </span>
      </div>
      <div className="degree" role="img" aria-label={'Градус ' + Math.round(status?.level ?? 0)}>
        <i style={{ width: (status?.level ?? 0) + '%' }} />
      </div>
    </section>
  )
}
