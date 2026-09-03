// Заявки и войны: кто на кого идёт, каким составом и когда бой.
//
// Гашение заявки здесь — только БЕЗ возврата взноса. Гашения с возвратом у
// админа нет и не будет: пока заявка висела, район был занят, а после
// возврата его мог занять другой клан — обратной операции не существует.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminRole } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table, ReasonForm, when, rub } from '../admin-ui'

export function ClaimsSection({ role }: { role: AdminRole | null }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'open' | 'all'>('open')
  const [rosterOf, setRosterOf] = useState<string | null>(null)
  const [expiring, setExpiring] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'claims', scope], queryFn: () => adminApi.claims(scope) })
  const roster = useQuery({
    queryKey: ['admin', 'claim-roster', rosterOf],
    queryFn: () => adminApi.claimRoster(rosterOf!),
    enabled: !!rosterOf,
  })

  const expire = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.expireClaim(id, reason),
    onSuccess: () => {
      setBad(false)
      setMsg('Заявка погашена. Взнос не возвращён: возврата у админа нет.')
      setExpiring(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'claims'] })
    },
    onError: (error: Error) => { setBad(true); setMsg(error.message) },
  })

  if (list.isLoading) return <Skeleton rows={5} />
  if (list.isError) return <Fault retry={() => list.refetch()} />
  const items = list.data?.items ?? []

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <div className="adm-switch">
        {(['open', 'all'] as const).map(value => (
          <button
            key={value}
            type="button"
            className={scope === value ? 'active' : ''}
            onClick={() => setScope(value)}
          >
            {value === 'open' ? 'Открытые' : 'Все'}
          </button>
        ))}
      </div>

      {items.length === 0
        ? <Empty title="Заявок нет" hint="Открытых войн за районы сейчас не идёт." />
        : (
          <Table head={['Район', 'Нападение', 'Оборона', 'Состав', 'Бой', 'Статус', 'Взнос', '']}>
            {items.map(claim => (
              <tr key={claim.id}>
                <td>{claim.territory.name}</td>
                <td>[{claim.attacker.tag}]</td>
                <td>{claim.defender ? `[${claim.defender.tag}]` : 'ничей'}</td>
                <td>{claim.roster.attack} / {claim.roster.defence}</td>
                <td>{when(claim.battleStartsAt)}</td>
                <td>{claim.status}{claim.walkover ? ' (без боя)' : ''}</td>
                <td>{rub(claim.feePaid)}</td>
                <td>
                  <button type="button" onClick={() => setRosterOf(rosterOf === claim.id ? null : claim.id)}>
                    Состав
                  </button>
                  {role === 'SUPER_ADMIN' && claim.status === 'PENDING' && (
                    <button type="button" onClick={() => setExpiring(expiring === claim.id ? null : claim.id)}>
                      Погасить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

      {rosterOf && roster.data && (
        <section className="adm-card-block">
          <h5>Состав заявки</h5>
          <Table head={['Сторона', 'Ник', 'Уровень при подаче', 'Уровень сейчас']}>
            {roster.data.roster.map((row, index) => (
              <tr key={index}>
                <td>{row.side === 1 ? 'нападение' : 'оборона'}</td>
                <td>{row.nickname ?? '—'}</td>
                <td>{row.battleLevelAtFiling}</td>
                <td>{row.battleLevelNow ?? '—'}</td>
              </tr>
            ))}
          </Table>
          <p className="adm-hint">
            Уровень при подаче записан отдельно: иначе заявку закрывают прокачанными,
            а приводят альтов.
          </p>
        </section>
      )}

      {expiring && (
        <div className="adm-card-block">
          <p>
            Заявка гасится <b>без возврата взноса</b>. Возврата у админа нет: пока
            заявка висела, район был занят, а после возврата его мог занять другой
            клан — вернуть всё как было невозможно. Само гашение обратимо, деньги
            не двигались.
          </p>
          <ReasonForm
            label="Погасить заявку"
            danger
            busy={expire.isPending}
            onSubmit={reason => expire.mutate({ id: expiring, reason })}
          />
        </div>
      )}
    </>
  )
}
