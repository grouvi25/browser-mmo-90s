import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { resourcesApi } from '../../shared/api/resources.api'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { barsApi, type BarOffer } from '../../shared/api/bars.api'
import { ApiError } from '../../shared/api/client'

export function ResourcesPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })
  const sell = useMutation({
    mutationFn: ({ code, amount }: { code: string; amount: number }) => resourcesApi.sell(code, amount),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['character'] }) },
  })
  // №117 (Metallica 15.11): еда и выпивка со склада, как заказ в баре, только без оплаты.
  const bars = useQuery({ queryKey: ['bars'], queryFn: barsApi.list, staleTime: 5 * 60_000 })
  const edible = new Map<string, BarOffer>()
  for (const bar of bars.data?.items ?? []) for (const offer of bar.barOffers) if (offer.resourceCode && !edible.has(offer.resourceCode)) edible.set(offer.resourceCode, offer)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const eat = useMutation({
    mutationFn: (code: string) => barsApi.eat(code),
    onSuccess: (result, code) => {
      setNote({ ok: true, text: `${edible.get(code)?.name ?? 'Готово'}: здоровье ${result.hpCurrent}` })
      qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['character'] })
    },
    onError: err => setNote({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось' }),
  })
  if (isLoading) return <div className="loading"><span className="spinner" />Загружаем склад…</div>
  return <div className="panel">
    <div className="panel-header"><span className="panel-title">Сырьё</span><span>Общий вес: {data?.totalWeight?.toFixed(2) ?? '0.00'}</span></div>
    <div className="panel-body">
      {note && <p className={note.ok ? 'alert alert-success' : 'alert alert-error'} role="status">{note.text}</p>}
      {!data?.items?.length ? <div className="text-dim">Пока ничего нет.</div> : <table className="data-table">
        <thead><tr><th>Ресурс</th><th>Уровень</th><th>Есть</th><th>В залоге</th><th>Вес</th><th /></tr></thead>
        <tbody>{data.items.map(stack => <tr key={stack.id}>
          <td><Link to={`/recipes?product=${encodeURIComponent(stack.template.code)}`} title="Откуда берётся и куда идёт">{stack.template.name}</Link></td><td>{stack.template.tier}</td><td>{stack.availableAmount}</td><td>{stack.reservedAmount}</td>
          <td>{(stack.amount * stack.template.weight).toFixed(2)}</td>
          <td><span className="res-actions">
            {edible.has(stack.template.code) && <button className="btn btn-sm" disabled={!stack.availableAmount || eat.isPending}
              onClick={() => eat.mutate(stack.template.code)}>{(edible.get(stack.template.code)!.alcoholDegrees > 0) ? 'Выпить' : 'Съесть'}</button>}
            <button className="btn btn-sm btn-gold" disabled={!stack.availableAmount || sell.isPending} onClick={() => sell.mutate({ code: stack.template.code, amount: 1 })}>Продать 1</button>
          </span></td>
        </tr>)}</tbody>
      </table>}
    </div>
  </div>
}
