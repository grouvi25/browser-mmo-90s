// =============================================================
// Рынок (правка заказчика 21.10).
//
// «На рынок любой игрок выставляет ТОЛЬКО ресурсы. Вещи продаёт
// профессия Торгаш: 1 лвл — за рубли, 2 лвл (за донат) — и за доллары.
// Ресурсы за доллары — добытчик 2-го уровня. У торгаша магазин с ID,
// чтобы лавку было удобно искать и рекламировать».
//   /market          — объявления: только ресурсы
//   /market/trader   — Торгаш: уровни, свой магазин, продажа вещей
//   /market/shops    — магазины торгашей: поиск по номеру и список
// =============================================================
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { marketApi, type MarketFilters, type MarketListingView, type Currency } from '../../shared/api/market.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { resourcesApi } from '../../shared/api/resources.api'

const money = (value: number, currency: Currency = 'RUB') => `${value.toLocaleString('ru')} ${currency === 'USD' ? '$' : '₽'}`
const fee = (price: number, currency: Currency) => Math.max(5, Math.round((currency === 'USD' ? price * 100 : price) * 0.02))

function useRefresh() {
  const qc = useQueryClient()
  return () => {
    for (const key of ['market', 'inventory', 'resources', 'character']) void qc.invalidateQueries({ queryKey: [key] })
  }
}

function ListingsTable({ items, mine, onBuy, onCancel, busy }: {
  items: MarketListingView[]; mine?: boolean; busy?: boolean
  onBuy?: (id: string) => void; onCancel?: (id: string) => void
}) {
  return <table className="data-table"><thead><tr><th>Тип</th><th>Название</th><th>Продавец</th><th>Кол-во</th><th>Цена</th><th>Истекает</th><th /></tr></thead>
    <tbody>{items.map(listing => <tr key={listing.id}>
      <td>{listing.type === 'ITEM' ? 'Вещь' : 'Ресурс'}</td>
      <td>{listing.item?.name ?? listing.resource?.name ?? 'Неизвестно'}</td>
      <td><Link to={listing.sellerUrl}>{listing.sellerNickname}</Link></td>
      <td>{listing.resourceAmount ?? 1}</td>
      <td>{money(listing.finalPrice ?? listing.price, listing.currency)}</td>
      <td>{new Date(listing.expiresAt).toLocaleString('ru')}</td>
      <td>{mine
        ? <button className="btn btn-sm" disabled={busy} onClick={() => onCancel?.(listing.id)}>Снять</button>
        : <button className="btn btn-sm btn-gold" disabled={busy} onClick={() => onBuy?.(listing.id)}>Купить</button>}</td>
    </tr>)}</tbody>
  </table>
}

/** Объявления: на общий рынок — только ресурсы. */
export function MarketPage() {
  const refresh = useRefresh()
  const [mine, setMine] = useState(false)
  const [price, setPrice] = useState(100)
  const [currency, setCurrency] = useState<Currency>('RUB')
  const [resourceId, setResourceId] = useState('')
  const [amount, setAmount] = useState(1)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<MarketFilters['sort']>('NEWEST')
  const [page, setPage] = useState(1)

  const filters: MarketFilters = {
    mine, type: mine ? undefined : 'RESOURCE', page, limit: 20, sort,
    ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
  }
  const listings = useQuery({ queryKey: ['market', filters], queryFn: () => marketApi.list(filters) })
  const resources = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })
  const trader = useQuery({ queryKey: ['market', 'trader'], queryFn: marketApi.trader })

  const buy = useMutation({ mutationFn: marketApi.buy, onSuccess: () => { setMessage('Покупка завершена'); refresh() }, onError: (e: Error) => setMessage(e.message) })
  const cancel = useMutation({ mutationFn: marketApi.cancel, onSuccess: () => { setMessage('Объявление снято, сбор не возвращается'); refresh() }, onError: (e: Error) => setMessage(e.message) })
  const create = useMutation({
    mutationFn: () => marketApi.createResource(resourceId, amount, price, currency),
    onSuccess: () => { setMessage(`Выставлено. Сбор: ${fee(price, currency)} ₽`); refresh() },
    onError: (e: Error) => setMessage(e.message),
  })
  const totalPages = Math.max(1, listings.data?.totalPages ?? 1)
  const usd = trader.data?.canSellResourcesForUsd

  return <div>
    {message && <div className="alert mb8" role="status">{message}</div>}
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Выставить ресурс</span></div>
      <div className="panel-body market-form">
        <select aria-label="Ресурс для продажи" value={resourceId} onChange={e => setResourceId(e.target.value)}>
          <option value="">Выберите ресурс</option>
          {resources.data?.items?.map(stack => <option key={stack.template.id} value={stack.template.id}>{stack.template.name} ({stack.availableAmount})</option>)}
        </select>
        <input aria-label="Количество ресурса" type="number" min={1} value={amount} onChange={e => setAmount(Number(e.target.value))} />
        <input aria-label="Цена объявления" type="number" min={1} max={1_000_000} value={price} onChange={e => setPrice(Number(e.target.value))} />
        <select aria-label="Валюта" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
          <option value="RUB">₽</option>
          <option value="USD" disabled={!usd}>${usd ? '' : ' — добытчик 2-го уровня'}</option>
        </select>
        <span>Сбор {fee(price, currency)} ₽</span>
        <button className="btn btn-primary" disabled={create.isPending || !resourceId} onClick={() => create.mutate()}>Выставить</button>
      </div>
      <p className="text-dim market-note">На общий рынок — только ресурсы. Вещи продаёт <Link to="/market/trader">Торгаш</Link> в своём магазине.</p>
    </div>

    <div className="panel mb8">
      <div className="panel-body market-form">
        <input aria-label="Поиск на рынке" placeholder="Название или код" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select aria-label="Сортировка рынка" value={sort} onChange={e => { setSort(e.target.value as MarketFilters['sort']); setPage(1) }}>
          <option value="NEWEST">Сначала новые</option><option value="PRICE_ASC">Сначала дешёвые</option><option value="PRICE_DESC">Сначала дорогие</option>
        </select>
        <button className={`btn ${!mine ? 'btn-primary' : ''}`} onClick={() => { setMine(false); setPage(1) }}>Рынок</button>
        <button className={`btn ${mine ? 'btn-primary' : ''}`} onClick={() => { setMine(true); setPage(1) }}>Мои объявления</button>
      </div>
    </div>

    <div className="panel"><div className="panel-body">
      <ListingsTable items={listings.data?.items ?? []} mine={mine} busy={buy.isPending || cancel.isPending}
        onBuy={id => buy.mutate(id)} onCancel={id => cancel.mutate(id)} />
      {!listings.data?.items?.length && <div className="text-dim">Подходящих объявлений нет.</div>}
      <div className="market-pages">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Назад</button>
        <span>Страница {page} из {totalPages}, всего {listings.data?.total ?? 0}</span>
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(v => v + 1)}>Далее</button>
      </div>
    </div></div>
  </div>
}

/** Торгаш: уровни профессии, свой магазин, продажа вещей. */
export function TraderPage() {
  const refresh = useRefresh()
  const [message, setMessage] = useState('')
  const [itemId, setItemId] = useState('')
  const [price, setPrice] = useState(100)
  const [currency, setCurrency] = useState<Currency>('RUB')
  const trader = useQuery({ queryKey: ['market', 'trader'], queryFn: marketApi.trader })
  const inventory = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.getItems })
  const mine = useQuery({ queryKey: ['market', 'mine-items'], queryFn: () => marketApi.list({ mine: true, type: 'ITEM', limit: 50 }) })
  const level = useMutation({ mutationFn: marketApi.buyTraderLevel, onSuccess: r => { setMessage(`Готово: Торгаш ${r.traderLevel}-го уровня, магазин №${r.shopNumber}`); refresh() }, onError: (e: Error) => setMessage(e.message) })
  const create = useMutation({ mutationFn: () => marketApi.createItem(itemId, price, currency), onSuccess: () => { setMessage('Вещь выставлена в вашем магазине'); setItemId(''); refresh() }, onError: (e: Error) => setMessage(e.message) })
  const cancel = useMutation({ mutationFn: marketApi.cancel, onSuccess: () => { setMessage('Снято с продажи'); refresh() }, onError: (e: Error) => setMessage(e.message) })
  const t = trader.data

  return <div>
    {message && <div className="alert mb8" role="status">{message}</div>}
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Профессия «Торгаш»</span></div>
      <div className="panel-body">
        {!t ? <p>Загрузка…</p> : <>
          <p>Уровень: <b>{t.traderLevel || 'нет'}</b>{t.shopNumber ? <> · ваш магазин <b>№{t.shopNumber}</b> — номер для рекламы</> : null}</p>
          <ul className="market-levels">
            <li><b>1-й уровень</b> — продажа вещей за рубли, свой магазин с номером. {money(t.prices.level1PriceRub)}
              {t.traderLevel < 1 && <button className="btn btn-primary btn-sm" disabled={level.isPending} onClick={() => level.mutate(1)}>Купить</button>}</li>
            <li><b>2-й уровень</b> — продажа и за доллары. {money(t.prices.level2PriceUsd, 'USD')}
              {t.traderLevel === 1 && <button className="btn btn-primary btn-sm" disabled={level.isPending} onClick={() => level.mutate(2)}>Купить</button>}</li>
          </ul>
          <p className="text-dim">Налог с продажи берётся везде — и в рублях, и в долларах.</p>
        </>}
      </div>
    </div>

    {t && t.traderLevel > 0 && <>
      <div className="panel">
        <div className="panel-header"><span className="panel-title">Выставить вещь в магазине №{t.shopNumber}</span></div>
        <div className="panel-body market-form">
          <select aria-label="Вещь для продажи" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">Выберите вещь</option>
            {inventory.data?.filter(item => !item.isEquipped && item.status === 'NORMAL').map(item => <option key={item.id} value={item.id}>{item.template.name}</option>)}
          </select>
          <input aria-label="Цена" type="number" min={1} max={1_000_000} value={price} onChange={e => setPrice(Number(e.target.value))} />
          <select aria-label="Валюта" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
            <option value="RUB">₽</option><option value="USD" disabled={t.traderLevel < 2}>${t.traderLevel < 2 ? ' — 2-й уровень' : ''}</option>
          </select>
          <span>Сбор {fee(price, currency)} ₽</span>
          <button className="btn btn-primary" disabled={create.isPending || !itemId} onClick={() => create.mutate()}>Выставить</button>
        </div>
      </div>
      <div className="panel"><div className="panel-body">
        <ListingsTable items={mine.data?.items ?? []} mine busy={cancel.isPending} onCancel={id => cancel.mutate(id)} />
        {!mine.data?.items?.length && <div className="text-dim">В магазине пока пусто.</div>}
      </div></div>
    </>}
  </div>
}

/** Магазины торгашей: поиск по номеру и общий список. */
export function ShopsPage() {
  const navigate = useNavigate()
  const [number, setNumber] = useState('')
  const shops = useQuery({ queryKey: ['market', 'shops'], queryFn: marketApi.shops })
  return <div>
    <form className="panel-body market-form" onSubmit={e => { e.preventDefault(); if (number.trim()) navigate(`/market/shops/${number.trim()}`) }}>
      <input aria-label="Номер магазина" inputMode="numeric" placeholder="Номер магазина, например 1001" value={number} onChange={e => setNumber(e.target.value.replace(/\D/g, ''))} />
      <button className="btn btn-primary" type="submit" disabled={!number}>Найти</button>
    </form>
    <div className="panel"><div className="panel-body">
      <table className="data-table"><thead><tr><th>№</th><th>Торгаш</th><th>Уровень</th><th>Лотов</th><th /></tr></thead>
        <tbody>{shops.data?.items.map(shop => <tr key={shop.id}>
          <td>{shop.shopNumber}</td><td>{shop.nickname}</td><td>{shop.traderLevel}</td><td>{shop.listings}</td>
          <td><Link className="btn btn-sm" to={`/market/shops/${shop.shopNumber}`}>Открыть</Link></td>
        </tr>)}</tbody>
      </table>
      {shops.data && !shops.data.items.length && <div className="text-dim">Торгашей пока нет.</div>}
    </div></div>
  </div>
}

export function ShopPage() {
  const { number = '' } = useParams()
  const refresh = useRefresh()
  const [message, setMessage] = useState('')
  const shop = useQuery({ queryKey: ['market', 'shop', number], queryFn: () => marketApi.shop(Number(number)), retry: false })
  const buy = useMutation({ mutationFn: marketApi.buy, onSuccess: () => { setMessage('Покупка завершена'); refresh() }, onError: (e: Error) => setMessage(e.message) })
  return <div>
    {message && <div className="alert mb8" role="status">{message}</div>}
    {shop.isError && <p role="alert">Магазина №{number} нет. <Link to="/market/shops">К списку магазинов</Link></p>}
    {shop.data && <>
      <h2>Магазин №{shop.data.owner.shopNumber} · {shop.data.owner.nickname} <small className="text-dim">Торгаш {shop.data.owner.traderLevel}-го уровня</small></h2>
      <ListingsTable items={shop.data.listings.items} busy={buy.isPending} onBuy={id => buy.mutate(id)} />
      {!shop.data.listings.items.length && <div className="text-dim">В магазине пока пусто.</div>}
    </>}
  </div>
}
