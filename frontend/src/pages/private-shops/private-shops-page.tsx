import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { privateShopsApi, type PrivateShopItemView } from '../../shared/api/private-shops.api'
import { charactersApi } from '../../shared/api/characters.api'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { itemStatLines } from '../../shared/lib/item-stat-lines'
import { QUALITY_LABELS } from '../../shared/types/api.types'
import { SPRITES } from '../../shared/ui/sprite'
import '../shop/shop.css'

const money = (value: number) => value.toLocaleString('ru-RU')

/** Частная лавка — те же плитки, что в госмагазине: картинка, цена и все характеристики вещи (обращение №49). */
export function PrivateShopsPage() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [shop, setShop] = useState(params.get('shop') ?? 'kommersant')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const shops = useQuery({ queryKey: ['private-shops'], queryFn: privateShopsApi.shops })
  const items = useQuery({ queryKey: ['private-shops', shop], queryFn: () => privateShopsApi.items(shop) })
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  const buy = useMutation({
    mutationFn: (id: string) => privateShopsApi.buy(shop, id),
    onSuccess: r => {
      setMessage({ type: 'success', text: `Куплено за ${money(r.total)} ₽. Остаток: ${money(r.newBalance)} ₽` })
      for (const key of ['private-shops', 'inventory', 'resources', 'character']) qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: Error) => setMessage({ type: 'error', text: e.message }),
  })

  return (
    <div className="gshop">
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}
      <header className="gshop-head">
        <span className="gshop-cash"><img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} /><span>Ваша наличность: <b>{me.data ? money(me.data.money) : '—'} руб.</b></span></span>
      </header>
      <nav className="gshop-tabs" aria-label="Лавки">
        {shops.data?.map(s => (
          <button key={s.code} className={shop === s.code ? 'active' : ''} aria-current={shop === s.code} onClick={() => { setShop(s.code); setMessage(null) }}>
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <span>{s.name}</span>
          </button>
        ))}
      </nav>
      {items.isLoading ? <div className="loading"><span className="spinner" />Загрузка лавки…</div>
        : !items.data?.length ? <p className="gshop-empty">Сейчас на прилавке пусто.</p>
        : (
          <section className="gshop-grid">
            {items.data.map(item => (
              <ShopCard key={item.id} item={item} money={me.data?.money} battleLevel={me.data?.battleLevel} economicLevel={me.data?.economicLevel}
                pending={buy.isPending} onBuy={() => buy.mutate(item.id)} />
            ))}
          </section>
        )}
    </div>
  )
}

function ShopCard({ item, money: cash, battleLevel, economicLevel, pending, onBuy }: {
  item: PrivateShopItemView; money?: number; battleLevel?: number; economicLevel?: number; pending: boolean; onBuy: () => void
}) {
  const t = item.template
  const soldOut = item.stockMode === 'LIMITED' && (item.stockAmount ?? 0) <= 0
  const needBattle = Math.max(item.minBattleLevel, t?.levelReq ?? 0)
  const tooLow = (battleLevel != null && battleLevel < needBattle) || (economicLevel != null && economicLevel < item.minEconomicLevel)
  const tooPoor = cash != null && cash < item.price
  const image = item.kind === 'ITEM' ? itemImage(item.code, t?.weaponType, t?.type) : undefined
  const why = soldOut ? 'Закончилось' : tooLow ? 'Не хватает уровня' : tooPoor ? 'Не хватает денег' : undefined
  return (
    <article className="gshop-card">
      {image ? <img src={image} alt="" width={64} height={64} /> : <span style={{ width: 64 }} />}
      <div className="gshop-card-body">
        <div className="gshop-card-head">
          <h3 className={t ? `q-${t.qualityBase}` : undefined}>{item.name}</h3>
          <span className="gshop-card-count">{item.stockMode === 'INFINITE' ? 'В наличии' : `Осталось: ${item.stockAmount ?? 0}`}</span>
        </div>
        <p className="gshop-card-meta">
          {t && <span>{t.type === 'TOOL' ? `Использований: ${t.usesMax ?? 0}` : `Прочность: ${t.durabilityMax}`}</span>}
          {!t && <span>Сырьё, {item.itemTier}-й сорт</span>}
          <span>Цена: {money(item.price)} руб.</span>
        </p>
        <div className="gshop-card-lower">
          <div className="gshop-card-stats">
            <dl>
              {needBattle > 0 && <div><dt>Боевой уровень</dt><dd>{needBattle}</dd></div>}
              {item.minEconomicLevel > 0 && <div><dt>Экономический уровень</dt><dd>{item.minEconomicLevel}</dd></div>}
              {t && <div><dt>Качество</dt><dd>{QUALITY_LABELS[t.qualityBase]}</dd></div>}
            </dl>
            {t && <ul className="gshop-bonuses">{itemStatLines(t).map(line => <li key={line}>{line}</li>)}</ul>}
          </div>
          <div className="gshop-card-actions">
            <button className="gshop-btn" disabled={pending || !!why} title={why} onClick={onBuy}>
              <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
              <span>{soldOut ? 'Нет' : 'Купить'}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
