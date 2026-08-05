import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { resourcesApi } from '../../shared/api/resources.api'

export function ResourcesPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })
  const sell = useMutation({
    mutationFn: ({ code, amount }: { code: string; amount: number }) => resourcesApi.sell(code, amount),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resources'] }); qc.invalidateQueries({ queryKey: ['character'] }) },
  })
  if (isLoading) return <div className="loading"><span className="spinner" />Загружаем склад…</div>
  return <div className="panel">
    <div className="panel-header"><span className="panel-title">Сырьё</span><span>Общий вес: {data?.totalWeight.toFixed(2) ?? '0.00'}</span></div>
    <div className="panel-body">
      {!data?.items.length ? <div className="text-dim">Пока ничего нет.</div> : <table className="data-table">
        <thead><tr><th>Ресурс</th><th>Уровень</th><th>Есть</th><th>В залоге</th><th>Вес</th><th /></tr></thead>
        <tbody>{data.items.map(stack => <tr key={stack.id}>
          <td>{stack.template.name}</td><td>{stack.template.tier}</td><td>{stack.availableAmount}</td><td>{stack.reservedAmount}</td>
          <td>{(stack.amount * stack.template.weight).toFixed(2)}</td>
          <td><button className="btn btn-sm btn-gold" disabled={!stack.availableAmount || sell.isPending} onClick={() => sell.mutate({ code: stack.template.code, amount: 1 })}>Продать 1</button></td>
        </tr>)}</tbody>
      </table>}
    </div>
  </div>
}
