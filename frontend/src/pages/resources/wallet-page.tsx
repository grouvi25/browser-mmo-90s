// Кошелёк (№133, Metallica 16.11): приход и расход рублей, как выписка по
// долларам. Чат с системными строками улетает быстро, а здесь видно, что
// пришло (зарплата, продажи, премии за уровень) и куда ушло (покупки, налоги).
import { useInfiniteQuery } from '@tanstack/react-query'
import { inventoryApi } from '../../shared/api/inventory.api'

const when = (at: string) => new Date(at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

export function WalletPage() {
  const log = useInfiniteQuery({
    queryKey: ['wallet'],
    queryFn: ({ pageParam }) => inventoryApi.moneyLog(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.hasMore ? last.items[last.items.length - 1]?.id : undefined,
  })
  const rows = log.data?.pages.flatMap(page => page.items) ?? []
  if (log.isLoading) return <div className="loading"><span className="spinner" />Загружаем кошелёк…</div>
  if (log.isError) return <div className="panel"><div className="panel-body">
    <p role="alert">Кошелёк не загрузился.</p>
    <button className="btn btn-sm" type="button" onClick={() => void log.refetch()}>Повторить</button>
  </div></div>
  return <div className="panel">
    <div className="panel-header"><span className="panel-title">Рубли: приход и расход</span></div>
    {rows.length === 0 ? <div className="panel-body"><p>Движений по счёту пока нет.</p></div> : <>
      <table className="data-table wallet-table">
        <thead><tr><th>Когда</th><th>Что</th><th className="num">Сумма</th><th className="num">Остаток</th></tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.id}>
            <td className="wallet-when">{when(row.at)}</td>
            <td>{row.label}</td>
            <td className={`num ${row.amount > 0 ? 'wallet-plus' : 'wallet-minus'}`}>{row.amount > 0 ? '+' : '−'}{rub(Math.abs(row.amount))}</td>
            <td className="num">{rub(row.balanceAfter)}</td>
          </tr>)}
        </tbody>
      </table>
      {log.hasNextPage && <div className="panel-body">
        <button className="btn btn-sm" type="button" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          {log.isFetchingNextPage ? 'Загружаю…' : 'Показать ещё'}
        </button>
      </div>}
    </>}
  </div>
}
