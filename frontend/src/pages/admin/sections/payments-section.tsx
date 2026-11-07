// Платежи картой и СБП (эквайринг Т-Банка). Отчёт один для всех, у кого есть
// право «финансы»: сколько оплачено, сколько долларов зачислено, кто платил.
// Условие заказчика 06.11: цифры по донату видят обе стороны одинаково.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type AdminPaymentStatus } from '../admin-api'
import { Skeleton, Fault, Empty, fmt } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'

const STATUS: Record<AdminPaymentStatus, string> = {
  NEW: 'создан', PENDING: 'ждёт оплаты', CONFIRMED: 'оплачен', REJECTED: 'отказ банка', CANCELED: 'отменён', REFUNDED: 'возврат',
}
const rub = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }

export function PaymentsSection() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const report = useQuery({ queryKey: ['admin', 'payments', from, to], queryFn: () => adminApi.paymentsReport(from, `${to}T23:59:59`) })
  const paid = report.data?.totals.find(row => row.status === 'CONFIRMED')
  return (
    <>
      <div className="adm-filters">
        <label>С <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>По <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {report.isLoading && <Skeleton rows={3} />}
      {report.isError && <Fault retry={() => report.refetch()} />}
      {report.data && <>
        <p className="adm-total"><b>Оплачено: {rub(paid?.amountKopecks ?? 0)}</b> · {fmt(paid?.count ?? 0)} платежей · зачислено {fmt(paid?.dollars ?? 0)} $</p>
        {report.data.totals.filter(row => row.status !== 'CONFIRMED').length > 0 && <p className="s4-muted">
          {report.data.totals.filter(row => row.status !== 'CONFIRMED').map(row => `${STATUS[row.status]}: ${row.count}`).join(' · ')}
        </p>}
        {report.data.items.length === 0
          ? <Empty title="Платежей за этот период нет" hint="Они появятся, когда игроки начнут покупать доллары картой или через СБП." />
          : <div className="adm-announce-list">
              {report.data.items.map(row => (
                <article key={row.id}>
                  <header>
                    <b>{row.nickname ?? 'без персонажа'} · {fmt(row.dollars)} $ · {rub(row.amountKopecks)}</b>
                    <small>{when(row.createdAt)} · {STATUS[row.status]}{row.confirmedAt ? ` ${when(row.confirmedAt)}` : ''}{row.providerPaymentId ? ` · банк №${row.providerPaymentId}` : ''}{row.errorText ? ` · ${row.errorText}` : ''}</small>
                  </header>
                </article>
              ))}
            </div>}
      </>}
    </>
  )
}
