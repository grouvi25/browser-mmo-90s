// =============================================================
// Мастерская по макету «Фон основного мнею Мастерская.psd».
//
// Макет рисует ту же композицию, что и магазин: строка наличности
// и уровня, шесть вкладок категорий на 712/953/1194/1442/1774/2089
// (y 366, плашка 213x55, широкие 297 и 282) и плитки товаров
// «Прямоугольник 8» 691x202 сеткой 2x2 на 716/1404 x 451/650.
// Отличий два: корзины нет, а вместо «Купить» и «В корзину» стоит
// одна кнопка «Ремонт» — слой 146x35.
//
// Поэтому разметка и стили берутся у магазина: в макете это буквально
// те же нарисованные плашки, и повторять их вторым набором классов
// значило бы разъехаться с ним при первой же правке.
// =============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { repairApi } from '../../shared/api/repair.api'
import { charactersApi } from '../../shared/api/characters.api'
import { QUALITY_LABELS, type RepairItem } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { SHOP_IMAGES } from '../../shared/assets/shop/shop-images'
import { SPRITES } from '../../shared/ui/sprite'
import '../shop/shop.css'

type Category = 'WEAPON' | 'ARMOR' | 'MEDICINE' | 'TOOL' | 'FOOD' | 'DRINK'

/** Вкладки и их порядок — те же, что нарисованы в магазине и здесь. */
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: 'WEAPON', label: 'Оружие' },
  { key: 'ARMOR', label: 'Броня' },
  { key: 'MEDICINE', label: 'Аптечки' },
  { key: 'TOOL', label: 'Инструменты' },
  { key: 'FOOD', label: 'Бафф-еда' },
  { key: 'DRINK', label: 'Напитки' },
]

const money = (value: number) => value.toLocaleString('ru-RU')

function itemImage(item: RepairItem) {
  return SHOP_IMAGES[item.template.code] ?? SHOP_IMAGES.weapon_fists
}

/** Строки бонусов под названием — как в макете: «Сила: +2», «Броня тела: +5». */
function bonusLines(item: RepairItem): string[] {
  const t = item.template
  const out: string[] = []
  if (t.minDamage != null && t.maxDamage != null) out.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
  if (t.armor) out.push(`Броня тела: +${t.armor}`)
  if (t.strReq > 0) out.push(`Требует силы: ${t.strReq}`)
  return out
}

function categoryOf(item: RepairItem): Category | null {
  const t = item.template
  if (t.type === 'WEAPON') return 'WEAPON'
  if (t.type === 'ARMOR') return 'ARMOR'
  if (t.type === 'TOOL') return 'TOOL'
  if (t.type === 'CONSUMABLE') return 'MEDICINE'
  return null
}

export function RepairPage() {
  const qc = useQueryClient()
  const [category, setCategory] = useState<Category>('WEAPON')
  const [level, setLevel] = useState<number | 'ALL'>('ALL')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['repair', 'items'],
    queryFn: () => repairApi.listItems(),
  })
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const repairMut = useMutation({
    mutationFn: (itemId: string) => repairApi.commit(itemId),
    onSuccess: data => {
      showMsg('success', `Отремонтировано. Остаток: ${money(data.newBalance)} ₽`)
      void qc.invalidateQueries({ queryKey: ['repair'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
      void refetch()
    },
    onError: err => {
      if (err instanceof ApiError) {
        showMsg('error', err.status === 400 ? 'Не хватает денег на ремонт' : err.message)
      } else showMsg('error', 'Не удалось починить')
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

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка мастерской…</div>

  return (
    <div className="gshop">
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      {/* Строка наличности и уровня — как в магазине; корзины в макете
          мастерской нет, чинят по одной вещи прямо в плитке. */}
      <header className="gshop-head">
        <span className="gshop-cash">
          <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
          <span>Ваша наличность: <b>{me.data ? money(me.data.money) : '—'} руб.</b></span>
        </span>
        <label className="gshop-level">
          <span>Для уровня:</span>
          <span className="gshop-level__box">
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <select value={String(level)} onChange={e => setLevel(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
              <option value="ALL">все</option>
              {levels.map(lv => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          </span>
        </label>
      </header>

      <nav className="gshop-tabs" aria-label="Категории предметов">
        {CATEGORIES.map(tab => (
          <button
            key={tab.key}
            className={category === tab.key ? 'active' : ''}
            aria-current={category === tab.key}
            onClick={() => setCategory(tab.key)}
          >
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <p className="gshop-empty">В этой категории нет повреждённых вещей.</p>
      ) : (
        <section className="gshop-grid">
          {visible.map(item => {
            const t = item.template
            const tooPoor = me.data ? me.data.money < item.repairCost : false
            return (
              <article key={item.id} className="gshop-card gshop-card--repair">
                <img src={itemImage(item)} alt="" width={64} height={64} />
                <div className="gshop-card-body">
                  <h3 className={`q-${item.quality}`}>{t.name}</h3>
                  <dl>
                    {/* В макете у вещи стоит её текущая прочность, а не предел:
                        чинить имеет смысл именно по ней. */}
                    <div><dt>Прочность</dt><dd>{item.durabilityCurrent}</dd></div>
                    <div><dt>Качество</dt><dd>{QUALITY_LABELS[item.quality]}</dd></div>
                    <div><dt>Требуемый уровень</dt><dd>{t.levelReq > 0 ? t.levelReq : '—'}</dd></div>
                    <div><dt>Цена за ремонт</dt><dd>{money(item.repairCost)} руб.</dd></div>
                  </dl>
                  <ul className="gshop-bonuses">
                    {bonusLines(item).map(line => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                <div className="gshop-card-actions">
                  <button
                    className="gshop-btn"
                    disabled={repairMut.isPending || tooPoor}
                    title={tooPoor ? 'Не хватает денег' : undefined}
                    onClick={() => repairMut.mutate(item.id)}
                  >
                    <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                    <span>Ремонт</span>
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
