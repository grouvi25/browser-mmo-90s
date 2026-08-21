import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Handshake, Swords } from 'lucide-react'
import { clansApi, type Clan } from '../../shared/api/clans.api'
import { Skeleton, Fault, Empty, Note } from './stage3-ui'
import { useMyClan } from './use-my-clan'

/** Цена на рынке зависит от отношения — держим таблицу рядом с кнопками. */
const PRICE_HINT: Record<string, string> = {
  SELF: 'свои −10%',
  ALLY: 'союзники −5%',
  NEUTRAL: 'нейтралы без изменений',
  ENEMY: 'враги +25%',
}

export function ClanRelationsSection() {
  const qc = useQueryClient()
  const { clan, can, isLoading, isError, refetch, hasClan } = useMyClan()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['clans'], queryFn: clansApi.list })

  const setRelation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: 'ALLIANCE' | 'HOSTILITY' }) => clansApi.relation(id, type),
    onSuccess: () => {
      setBad(false)
      setMsg('Отношение обновлено')
      void qc.invalidateQueries({ queryKey: ['clan'] })
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (isLoading) return <Skeleton rows={3} />
  if (isError) return <Fault retry={refetch} />
  if (!hasClan) return <Empty title="Вы не в бригаде" hint="Отношения устанавливает бригада, а не одиночка." />
  if (!clan) return <Skeleton rows={3} />

  const others = (list.data?.items ?? []).filter(other => other.id !== clan.id)
  const relationOf = (other: Clan) => clan.relationsFrom?.find(rel => rel.toClanId === other.id)

  return (
    <>
      <p className="s3-hint">
        Вражду можно объявить в одностороннем порядке, союз требует подтверждения второй стороны.
        Менять отношение можно раз в 24 часа. Наценка за вражду целиком уходит в налог —
        продавец получает обычную цену, поэтому «торговать враждой» бессмысленно.
      </p>

      <div className="relation-legend">
        {Object.entries(PRICE_HINT).map(([key, text]) => <span key={key}>{text}</span>)}
      </div>

      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      {others.length === 0 ? (
        <Empty title="Других бригад в городе нет" hint="Отношения появятся, когда кто-то ещё соберёт бригаду." />
      ) : (
        <div className="s3-scroll">
          <table className="s3-table">
            <thead>
              <tr><th>Бригада</th><th>Уровень</th><th>Отношение</th><th /></tr>
            </thead>
            <tbody>
              {others.map(other => {
                const relation = relationOf(other)
                const label = !relation ? 'нейтралитет'
                  : relation.type === 'HOSTILITY' ? 'вражда'
                  : relation.confirmed ? 'союз' : 'союз предложен'
                return (
                  <tr key={other.id}>
                    <td><b>[{other.tag}]</b> {other.name}</td>
                    <td>{other.level}</td>
                    <td className={relation?.type === 'HOSTILITY' ? 'bad' : relation?.confirmed ? 'ok' : 'muted'}>{label}</td>
                    <td className="relation-actions">
                      <button
                        onClick={() => setRelation.mutate({ id: other.id, type: 'ALLIANCE' })}
                        disabled={!can('RELATIONS') || setRelation.isPending}
                      >
                        <Handshake size={15} /> Союз
                      </button>
                      <button
                        className="danger"
                        onClick={() => setRelation.mutate({ id: other.id, type: 'HOSTILITY' })}
                        disabled={!can('RELATIONS') || setRelation.isPending}
                      >
                        <Swords size={15} /> Вражда
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!can('RELATIONS') && <p className="s3-hint">Ваша роль не может менять отношения бригады.</p>}
    </>
  )
}
