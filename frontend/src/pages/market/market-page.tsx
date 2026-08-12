import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { marketApi, type MarketFilters } from '../../shared/api/market.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { resourcesApi } from '../../shared/api/resources.api'

export function MarketPage() {
  const qc = useQueryClient()
  const [mine, setMine] = useState(false)
  const [type, setType] = useState<'ITEM' | 'RESOURCE' | undefined>()
  const [price, setPrice] = useState(100)
  const [itemId, setItemId] = useState('')
  const [resourceId, setResourceId] = useState('')
  const [amount, setAmount] = useState(1)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [priceMin, setPriceMin] = useState<number | undefined>()
  const [priceMax, setPriceMax] = useState<number | undefined>()
  const [sort, setSort] = useState<MarketFilters['sort']>('NEWEST')
  const [page, setPage] = useState(1)

  const filters: MarketFilters = {
    mine, type, page, limit: 20, sort, priceMin, priceMax,
    ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
  }
  const listings = useQuery({ queryKey: ['market', filters], queryFn: () => marketApi.list(filters) })
  const inventory = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.getItems })
  const resources = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['market'] })
    void qc.invalidateQueries({ queryKey: ['inventory'] })
    void qc.invalidateQueries({ queryKey: ['resources'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const buy = useMutation({ mutationFn: marketApi.buy, onSuccess: () => { setMessage('Покупка завершена'); refresh() }, onError: (error: Error) => setMessage(error.message) })
  const cancel = useMutation({ mutationFn: marketApi.cancel, onSuccess: () => { setMessage('Объявление снято, сбор не возвращается'); refresh() }, onError: (error: Error) => setMessage(error.message) })
  const create = useMutation({
    mutationFn: () => type === 'RESOURCE' ? marketApi.createResource(resourceId, amount, price) : marketApi.createItem(itemId, price),
    onSuccess: () => { setMessage(`Выставлено. Сбор: ${Math.max(5, Math.round(price * 0.02))} ₽`); refresh() },
    onError: (error: Error) => setMessage(error.message),
  })

  const changeFilter = (apply: () => void) => { apply(); setPage(1) }
  const totalPages = listings.data?.totalPages ?? 1

  return <div>
    {message && <div className="alert mb8">{message}</div>}
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Выставить на продажу</span></div>
      <div className="panel-body" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Тип объявления" value={type ?? 'ITEM'} onChange={event => setType(event.target.value as 'ITEM' | 'RESOURCE')}>
          <option value="ITEM">Вещь</option><option value="RESOURCE">Ресурс</option>
        </select>
        {type === 'RESOURCE' ? <>
          <select aria-label="Ресурс для продажи" value={resourceId} onChange={event => setResourceId(event.target.value)}>
            <option value="">Выберите ресурс</option>
            {resources.data?.items.map(stack => <option key={stack.template.id} value={stack.template.id}>{stack.template.name} ({stack.availableAmount})</option>)}
          </select>
          <input aria-label="Количество ресурса" type="number" min={1} value={amount} onChange={event => setAmount(Number(event.target.value))} />
        </> : <select aria-label="Вещь для продажи" value={itemId} onChange={event => setItemId(event.target.value)}>
          <option value="">Выберите вещь</option>
          {inventory.data?.filter(item => !item.isEquipped && item.status === 'NORMAL').map(item => <option key={item.id} value={item.id}>{item.template.name}</option>)}
        </select>}
        <input aria-label="Цена объявления" type="number" min={1} max={1_000_000} value={price} onChange={event => setPrice(Number(event.target.value))} />
        <span>Сбор {Math.max(5, Math.round(price * 0.02))} ₽</span>
        <button className="btn btn-primary" disabled={create.isPending || (!itemId && type !== 'RESOURCE') || (!resourceId && type === 'RESOURCE')} onClick={() => create.mutate()}>Выставить</button>
      </div>
    </div>

    <div className="panel mb8">
      <div className="panel-header"><span className="panel-title">Фильтры рынка</span></div>
      <div className="panel-body" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input aria-label="Поиск на рынке" placeholder="Название или код" value={search} onChange={event => changeFilter(() => setSearch(event.target.value))} />
        <input aria-label="Цена от" placeholder="Цена от" type="number" min={1} value={priceMin ?? ''} onChange={event => changeFilter(() => setPriceMin(event.target.value ? Number(event.target.value) : undefined))} />
        <input aria-label="Цена до" placeholder="Цена до" type="number" min={1} value={priceMax ?? ''} onChange={event => changeFilter(() => setPriceMax(event.target.value ? Number(event.target.value) : undefined))} />
        <select aria-label="Сортировка рынка" value={sort} onChange={event => changeFilter(() => setSort(event.target.value as MarketFilters['sort']))}>
          <option value="NEWEST">Сначала новые</option><option value="PRICE_ASC">Сначала дешёвые</option><option value="PRICE_DESC">Сначала дорогие</option>
        </select>
        <button className={`btn ${!mine ? 'btn-primary' : ''}`} onClick={() => changeFilter(() => setMine(false))}>Рынок</button>
        <button className={`btn ${mine ? 'btn-primary' : ''}`} onClick={() => changeFilter(() => setMine(true))}>Мои объявления</button>
        <button className="btn" onClick={() => changeFilter(() => setType(undefined))}>Все</button>
        <button className="btn" onClick={() => changeFilter(() => setType('ITEM'))}>Вещи</button>
        <button className="btn" onClick={() => changeFilter(() => setType('RESOURCE'))}>Ресурсы</button>
      </div>
    </div>

    <div className="panel"><div className="panel-body">
      <table className="data-table"><thead><tr><th>Тип</th><th>Название</th><th>Продавец</th><th>Кол-во</th><th>Цена</th><th>Истекает</th><th /></tr></thead>
        <tbody>{listings.data?.items.map(listing => <tr key={listing.id}>
          <td>{listing.type === 'ITEM' ? 'Вещь' : 'Ресурс'}</td>
          <td>{listing.item?.name ?? listing.resource?.name ?? 'Неизвестно'}</td>
          <td><a href={listing.sellerUrl}>{listing.sellerNickname}</a></td>
          <td>{listing.resourceAmount ?? 1}</td><td>{listing.price.toLocaleString()} ₽</td><td>{new Date(listing.expiresAt).toLocaleString()}</td>
          <td>{mine ? <button className="btn btn-sm" onClick={() => cancel.mutate(listing.id)}>Снять</button> : <button className="btn btn-sm btn-gold" onClick={() => buy.mutate(listing.id)}>Купить</button>}</td>
        </tr>)}</tbody>
      </table>
      {!listings.data?.items.length && <div className="text-dim">Подходящих объявлений нет.</div>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 10 }}>
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Назад</button>
        <span>Страница {page} из {totalPages}, всего {listings.data?.total ?? 0}</span>
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Далее</button>
      </div>
    </div></div>
  </div>
}
