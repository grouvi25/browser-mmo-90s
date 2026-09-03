// =============================================================
// Улучшения по макету «Фон основного мнею Улучшения.psd».
//
// Композиция взята с макета целиком: пять вкладок разделов, панель
// «Государственная вставка камней» с прайсом ступеней, линейка и три
// слота «Предмет — Камень — Огранка», под ними кнопка «Вставить».
//
// Механики камней и огранки в игре нет — улучшение работает иначе:
// выбирается вещь и вид усиления, у каждого свой шанс и расход
// деталей. Поэтому слоты макета заняты тем, что у нас действительно
// есть, и подписаны своими словами: вещь, вид усиления и результат.
// Прайс-столбец показывает настоящие ступени этой вещи, а не
// нарисованные числа.
//
// Четыре раздела из пяти — «Кузница», «Личное оружие», «Специальное
// изделие», «Частная мастерская» — в игре не существуют. Они
// нарисованы, поэтому стоят на своих местах, но помечены как
// закрытые: вести живую кнопку в пустоту нельзя.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { upgradesApi, type UpgradeType } from '../../shared/api/upgrades.api'
import { charactersApi } from '../../shared/api/characters.api'
import { SPRITES } from '../../shared/ui/sprite'
import '../shop/shop.css'
import './upgrades.css'

const TYPES: UpgradeType[] = ['DAMAGE', 'ACCURACY', 'CRIT', 'ARMOR', 'DURABILITY', 'ANTI_CRIT']
const TYPE_LABELS: Record<UpgradeType, string> = {
  DAMAGE: 'Урон', ACCURACY: 'Точность', CRIT: 'Крит',
  ARMOR: 'Броня', DURABILITY: 'Прочность', ANTI_CRIT: 'Защита от крита',
}

/** Разделы нарисованы в макете в этом порядке; работает пока первый. */
const SECTIONS = [
  { key: 'state', label: 'Оружие', open: true },
  { key: 'forge', label: 'Кузница', open: false },
  { key: 'personal', label: 'Личное оружие', open: false },
  { key: 'special', label: 'Специальное изделие', open: false },
  { key: 'private', label: 'Частная мастерская', open: false },
]

const money = (value: number) => value.toLocaleString('ru-RU')

export function UpgradesPage() {
  const qc = useQueryClient()
  const [itemId, setItemId] = useState('')
  const [type, setType] = useState<UpgradeType>('DAMAGE')
  const [msg, setMsg] = useState('')

  const items = useQuery({ queryKey: ['upgrades', 'items'], queryFn: upgradesApi.items })
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  const preview = useQuery({
    queryKey: ['upgrades', 'preview', itemId, type],
    queryFn: () => upgradesApi.preview(itemId, type),
    enabled: !!itemId,
  })
  const commit = useMutation({
    mutationFn: () => upgradesApi.commit(itemId, type),
    onSuccess: r => {
      setMsg(r.success ? `Получилось, уровень ${r.levelAfter}` : 'Не вышло. Деньги и детали потрачены.')
      for (const key of [['upgrades'], ['inventory'], ['resources'], ['character']]) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
    onError: (e: Error) => setMsg(e.message),
  })

  const selected = items.data?.find(x => x.id === itemId)
  const p = preview.data
  const lacking = p?.requiredResources.filter(r => !r.enough) ?? []

  return (
    <div className="upg">
      {msg && <div className="alert mb8">{msg}</div>}

      {/* Наличность в макете стоит над разделами, той же плашкой, что
          в магазине и мастерской. «Для уровня» рядом не ставим: список
          вещей для улучшения уровнем не фильтруется, и данных о нём
          в UpgradeItem нет — пустой фильтр был бы обманом. */}
      <header className="gshop-head">
        <span className="gshop-cash">
          <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
          <span>Ваша наличность: <b>{me.data ? money(me.data.money) : '—'} руб.</b></span>
        </span>
      </header>

      {/* Полоса разделов — те же плашки, что вкладки магазина. */}
      <nav className="gshop-tabs" aria-label="Разделы улучшений">
        {SECTIONS.map(section => (
          <button
            key={section.key}
            className={section.open ? 'active' : ''}
            aria-current={section.open}
            disabled={!section.open}
            title={section.open ? section.label : 'Раздел откроется позже'}
          >
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <span>{section.label}</span>
          </button>
        ))}
      </nav>

      <section className="upg-panel">
        <h2 className="upg-panel__title">Государственная вставка камней</h2>

        <dl className="upg-price">
          <dt>Цена:</dt>
          <dd>
            {p ? (
              <span className="upg-price__tier is-current">
                уровень {p.currentTotalLevel} → {p.nextTotalLevel} — {money(p.cost)} руб., шанс {Math.round(p.chance * 100)}%
              </span>
            ) : (
              <span className="upg-price__tier">выберите вещь и вид усиления</span>
            )}
            {p?.requiredResources.map(r => (
              <span key={r.resourceCode} className={'upg-price__tier' + (r.enough ? '' : ' upg-lack')}>
                {r.resourceName}: {r.available}/{r.amount}
              </span>
            ))}
          </dd>
        </dl>

        <div className="upg-rule" />

        {/* Три слота макета. Камня и огранки в игре нет, поэтому средний
            слот держит вид усиления, а правый — результат. */}
        <div className="upg-slots">
          <label className="upg-slot">
            <span>Предмет</span>
            <select className="upg-slot__box" value={itemId} onChange={e => setItemId(e.target.value)}
              aria-label="Вещь для улучшения">
              <option value="">не выбрано</option>
              {items.data?.map(x => <option key={x.id} value={x.id}>{x.template.name} (+{x.upgradeLevel})</option>)}
            </select>
          </label>

          <label className="upg-slot">
            <span>Усиление</span>
            <select className="upg-slot__box" value={type} onChange={e => setType(e.target.value as UpgradeType)}
              aria-label="Вид усиления">
              {TYPES.map(x => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
            </select>
          </label>

          <div className="upg-slot">
            <span>Результат</span>
            <output className={'upg-slot__box' + (p ? '' : ' is-empty')}>
              {p ? `+${p.nextTotalLevel}` : '—'}
            </output>
          </div>
        </div>

        <button className="upg-commit" disabled={!p?.canCommit || commit.isPending}
          onClick={() => commit.mutate()}>
          <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
          <span>Вставить</span>
        </button>

        {selected && lacking.length > 0 && (
          <p className="upg-note upg-lack">Не хватает: {lacking.map(r => r.resourceName).join(', ')}.</p>
        )}
      </section>
    </div>
  )
}
