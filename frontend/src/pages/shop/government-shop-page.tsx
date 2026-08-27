// =============================================================
// Государственный магазин по макету «Фон основного меню Магазин».
// Плитки товаров вместо таблицы, шесть категорий, корзина и
// наличность в шапке — как нарисовано.
// =============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart, Trash2 } from 'lucide-react'
import { shopApi } from '../../shared/api/shop.api'
import { barsApi } from '../../shared/api/bars.api'
import { charactersApi } from '../../shared/api/characters.api'
import { QUALITY_LABELS, type ShopItem } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { SHOP_IMAGES } from '../../shared/assets/shop/shop-images'
import './shop.css'

type Category = 'WEAPON' | 'ARMOR' | 'MEDICINE' | 'TOOL' | 'FOOD' | 'DRINK'

/** Вкладки идут в том порядке, в каком нарисованы в макете. */
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: 'WEAPON', label: 'Оружие' },
  { key: 'ARMOR', label: 'Броня' },
  { key: 'MEDICINE', label: 'Аптечки' },
  { key: 'TOOL', label: 'Инструменты' },
  { key: 'FOOD', label: 'Бафф-еда' },
  { key: 'DRINK', label: 'Напитки' },
]

const money = (value: number) => value.toLocaleString('ru-RU')

function itemImage(item: ShopItem) {
  return SHOP_IMAGES[item.template.code] ?? SHOP_IMAGES.weapon_fists
}

/** Строки бонусов под названием — как в макете: «Силы +2», «Броня тела +20». */
function bonusLines(item: ShopItem): string[] {
  const t = item.template
  const out: string[] = []
  if (t.minDamage != null && t.maxDamage != null) out.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
  if (t.weaponAccuracy) out.push(`Точность: ${Math.round(t.weaponAccuracy * 100)}%`)
  if (t.critBonus) out.push(`Крит: +${Math.round(t.critBonus * 100)}%`)
  if (t.armor) out.push(`Броня тела: +${t.armor}`)
  if (t.dodgeBonus) out.push(`Уворот: +${Math.round(t.dodgeBonus * 100)}%`)
  if (t.antiCrit) out.push(`Антикрит: +${Math.round(t.antiCrit * 100)}%`)
  if (t.blockBonus) out.push(`Блок: +${Math.round(t.blockBonus * 100)}%`)
  if (t.hpBonus) out.push(`Восстановит: +${t.hpBonus} HP`)
  if (t.strReq > 0) out.push(`Требует силы: ${t.strReq}`)
  if (t.skillReq > 0) out.push(`Требует навык: ${t.skillReq}`)
  return out
}

function categoryOf(item: ShopItem): Category | null {
  const t = item.template
  if (t.type === 'WEAPON') return 'WEAPON'
  if (t.type === 'ARMOR') return 'ARMOR'
  if (t.type === 'TOOL') return 'TOOL'
  if (t.type === 'CONSUMABLE') return 'MEDICINE'
  return null
}

export function GovernmentShopPage() {
  const qc = useQueryClient()
  const [category, setCategory] = useState<Category>('WEAPON')
  const [level, setLevel] = useState<number | 'ALL'>('ALL')
  const [cart, setCart] = useState<string[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: items = [], isLoading } = useQuery({ queryKey: ['shop', 'government'], queryFn: shopApi.listItems })
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  // Еда и напитки живут в барах, а не в госмагазине: в этих вкладках
  // показываем витрину с ценами и отправляем покупать туда.
  const bars = useQuery({
    queryKey: ['bars'],
    queryFn: barsApi.list,
    enabled: category === 'FOOD' || category === 'DRINK',
  })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const buyMut = useMutation({
    mutationFn: (templateId: string) => shopApi.buy(templateId),
    onSuccess: data => {
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', `Куплено. Остаток: ${money(data.newBalance)} ₽`)
    },
    onError: err => {
      if (err instanceof ApiError) {
        showMsg('error', err.code === 'SHOP_001' ? 'Не хватает денег' : err.message)
      } else showMsg('error', 'Не удалось купить')
    },
  })

  /** Корзина покупается по одной позиции: у сервера один товар на запрос. */
  const checkout = useMutation({
    mutationFn: async (templateIds: string[]) => {
      let bought = 0
      for (const id of templateIds) {
        await shopApi.buy(id)
        bought += 1
      }
      return bought
    },
    onSuccess: bought => {
      setCart([])
      setCartOpen(false)
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('success', `Куплено позиций: ${bought}`)
    },
    onError: err => {
      void qc.invalidateQueries({ queryKey: ['character'] })
      showMsg('error', err instanceof ApiError ? err.message : 'Часть корзины не купилась')
    },
  })

  const levels = useMemo(
    () => [...new Set(items.map(i => i.template.levelReq))].sort((a, b) => a - b),
    [items],
  )

  const visible = items.filter(item => {
    if (categoryOf(item) !== category) return false
    if (level !== 'ALL' && item.template.levelReq !== level) return false
    return true
  })

  const cartItems = cart
    .map(id => items.find(i => i.template.id === id))
    .filter((i): i is ShopItem => Boolean(i))
  const cartTotal = cartItems.reduce((sum, i) => sum + (i.overridePrice ?? i.template.priceBase), 0)

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка магазина…</div>

  return (
    <div className="gshop">
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <header className="gshop-head">
        <span className="gshop-cash">
          Ваша наличность: <b>{me.data ? money(me.data.money) : '—'} руб.</b>
        </span>
        <label className="gshop-level">
          Для уровня:
          <select value={String(level)} onChange={e => setLevel(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
            <option value="ALL">все</option>
            {levels.map(lv => <option key={lv} value={lv}>{lv}</option>)}
          </select>
        </label>
        <button className="gshop-cart-btn" onClick={() => setCartOpen(v => !v)} aria-expanded={cartOpen}>
          <ShoppingCart size={14} /> Корзина{cart.length > 0 && <b> · {cart.length}</b>}
        </button>
      </header>

      <nav className="gshop-tabs" aria-label="Категории товаров">
        {CATEGORIES.map(tab => (
          <button
            key={tab.key}
            className={category === tab.key ? 'active' : ''}
            aria-current={category === tab.key}
            onClick={() => setCategory(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {cartOpen && (
        <section className="gshop-cart">
          {cartItems.length === 0 ? (
            <p className="muted">Корзина пуста.</p>
          ) : (
            <>
              <ul>
                {cartItems.map((item, index) => (
                  <li key={`${item.id}-${index}`}>
                    <span>{item.template.name}</span>
                    <b>{money(item.overridePrice ?? item.template.priceBase)} ₽</b>
                    <button
                      aria-label={`Убрать ${item.template.name}`}
                      onClick={() => setCart(prev => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="gshop-cart-foot">
                <span>Итого: <b>{money(cartTotal)} ₽</b></span>
                <button
                  className="btn btn-success"
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate(cart)}
                >
                  Купить всё
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {category === 'FOOD' || category === 'DRINK' ? (
        <BarShowcase category={category} loading={bars.isLoading} bars={bars.data?.items ?? []} />
      ) : visible.length === 0 ? (
        <p className="gshop-empty">В этой категории пока пусто.</p>
      ) : (
        <section className="gshop-grid">
          {visible.map(item => {
            const t = item.template
            const price = item.overridePrice ?? t.priceBase
            const tooPoor = me.data ? me.data.money < price : false
            const tooLow = me.data ? me.data.battleLevel < t.levelReq : false
            return (
              <article key={item.id} className="gshop-card">
                <img src={itemImage(item)} alt="" width={64} height={64} />
                <div className="gshop-card-body">
                  <h3 className={`q-${t.qualityBase}`}>{t.name}</h3>
                  <dl>
                    <div><dt>Прочность</dt><dd>{t.durabilityMax}</dd></div>
                    <div><dt>Качество</dt><dd>{QUALITY_LABELS[t.qualityBase]}</dd></div>
                    <div><dt>Требуемый уровень</dt><dd>{t.levelReq > 0 ? t.levelReq : '—'}</dd></div>
                    <div><dt>Цена в магазине</dt><dd>{money(price)} руб.</dd></div>
                  </dl>
                  <ul className="gshop-bonuses">
                    {bonusLines(item).map(line => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                <div className="gshop-card-actions">
                  <button
                    className="btn btn-success"
                    disabled={buyMut.isPending || tooPoor || tooLow}
                    title={tooLow ? `Нужен ${t.levelReq}-й уровень` : tooPoor ? 'Не хватает денег' : undefined}
                    onClick={() => buyMut.mutate(t.id)}
                  >
                    Купить
                  </button>
                  <button className="btn" disabled={tooLow} onClick={() => setCart(prev => [...prev, t.id])}>
                    В корзину
                  </button>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}

/** Витрина барного меню: тут только смотрят, покупают в самом баре. */
function BarShowcase({ category, loading, bars }: {
  category: 'FOOD' | 'DRINK'
  loading: boolean
  bars: Array<{ id: string; name: string; barOffers: Array<{ id: string; name: string; price: number; hpRestore: number; alcoholDegrees: number; accuracyBuff: number; damageBuff: number; buffMinutes: number }> }>
}) {
  if (loading) return <div className="loading"><span className="spinner" />Загрузка меню…</div>

  const rows = bars.flatMap(bar => bar.barOffers
    .filter(offer => (category === 'DRINK' ? offer.alcoholDegrees > 0 : offer.alcoholDegrees === 0))
    .map(offer => ({ bar, offer })))

  if (rows.length === 0) {
    return <p className="gshop-empty">Ничего не выставлено. Бары варят из фермерского сырья — если пусто, значит его не подвезли.</p>
  }

  return (
    <>
      <p className="gshop-note">
        Еду и напитки продают бары, а не государство. Здесь витрина с ценами — заказать можно <Link to="/bars">в барах</Link>.
      </p>
      <section className="gshop-grid">
        {rows.map(({ bar, offer }) => (
          <article key={offer.id} className="gshop-card gshop-card--bar">
            <div className="gshop-card-body">
              <span className="gshop-bar-name">{bar.name}</span>
              <h3>{offer.name}</h3>
              <ul className="gshop-bonuses">
                {offer.hpRestore > 0 && <li>Восстановит: +{offer.hpRestore} HP</li>}
                {offer.alcoholDegrees > 0 && <li>Градус: {offer.alcoholDegrees}°</li>}
                {offer.accuracyBuff > 0 && <li>Точность: +{offer.accuracyBuff}</li>}
                {offer.damageBuff > 0 && <li>Урон: +{Math.round(offer.damageBuff * 100)}%</li>}
                {offer.buffMinutes > 0 && <li>Действует: {offer.buffMinutes} мин</li>}
              </ul>
            </div>
            <div className="gshop-card-actions">
              <b>{money(offer.price)} руб.</b>
              <Link className="btn" to="/bars">В бар</Link>
            </div>
          </article>
        ))}
      </section>
    </>
  )
}
