// Выплаты реферальных (заказчик 28.10: «выплаты выводятся все вручную, если
// вывод на реальные ₽»). Доллары у игрока уже списаны заявкой; админ
// переводит деньги сам и отмечает «Выплачено» или отклоняет — тогда
// доллары возвращаются игроку. Решает только главный админ.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import type { PayoutStatus } from '../../../shared/api/referral.api'
import { Skeleton, Fault, Empty, Note, fmt } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'

const FILTERS: [PayoutStatus | undefined, string][] = [['PENDING', 'Ждут'], ['PAID', 'Выплачено'], ['REJECTED', 'Отклонено'], [undefined, 'Все']]
const STATUS: Record<PayoutStatus, string> = { PENDING: 'ждёт выплаты', PAID: 'выплачено', REJECTED: 'отклонено' }

export function PayoutsSection() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<PayoutStatus | undefined>('PENDING')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const list = useQuery({ queryKey: ['admin', 'payouts', status ?? 'ALL'], queryFn: () => adminApi.payouts(status) })
  const refresh = (text: string) => { setBad(false); setMsg(text); void qc.invalidateQueries({ queryKey: ['admin', 'payouts'] }) }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const paid = useMutation({
    mutationFn: (id: string) => adminApi.payoutPaid(id),
    onSuccess: row => refresh(`Отмечено: ${row.amount} $ выплачены`),
    onError: fail,
  })
  const reject = useMutation({
    mutationFn: (row: { id: string; note: string }) => adminApi.payoutReject(row.id, row.note),
    onSuccess: row => refresh(`Отклонено, ${row.amount} $ вернулись игроку`),
    onError: fail,
  })
  const busy = paid.isPending || reject.isPending
  const items = list.data?.items ?? []

  return (
    <>
      <nav className="s3-tabs" aria-label="Какие заявки">
        {FILTERS.map(([value, label]) => (
          <button key={label} type="button" className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => setStatus(value)}>
            {label}
          </button>
        ))}
      </nav>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      {list.isLoading && <Skeleton rows={3} />}
      {list.isError && <Fault retry={() => list.refetch()} />}
      {list.data && (items.length === 0
        ? <Empty title="Заявок нет" hint="Игроки подают их на вкладке «Премиум», блок «Приглашай своих»." />
        : <div className="adm-announce-list">
            {items.map(row => (
              <article key={row.id}>
                <header>
                  <b>{row.nickname} · {fmt(row.amount)} $</b>
                  <small>{when(row.createdAt)} · {STATUS[row.status]}{row.processedAt ? ` ${when(row.processedAt)}` : ''}{row.adminNote ? ` · ${row.adminNote}` : ''}</small>
                </header>
                <p>{row.details}</p>
                {row.status === 'PENDING' && (
                  <div className="adm-announce-actions">
                    <button type="button" disabled={busy}
                      onClick={() => { if (window.confirm(`Деньги игроку ${row.nickname} за ${row.amount} $ переведены?`)) paid.mutate(row.id) }}>
                      Выплачено
                    </button>
                    <button type="button" className="danger" disabled={busy}
                      onClick={() => {
                        const note = window.prompt('Причина отказа (игрок её увидит)')
                        if (note !== null) reject.mutate({ id: row.id, note })
                      }}>
                      Отклонить
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>)}
    </>
  )
}
