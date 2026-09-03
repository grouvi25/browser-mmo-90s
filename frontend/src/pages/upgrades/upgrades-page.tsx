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

  const p = preview.data
  const lacking = p?.requiredResources.filter(r => !r.enough) ?? []
  const enoughMoney = !p || (me.data?.money ?? 0) >= p.cost

  const status: string[] = []
  if (items.data?.length === 0) status.push('У вас нет вещей для улучшения.')
  else if (!itemId) status.push('Вещь не выбрана.')
  if (p) status.push(`Шанс успеха: ${Math.round(p.chance * 100)}%.`)
  if (lacking.length > 0) status.push(`Не хватает деталей: ${lacking.map(r => r.resourceName).join(', ')}.`)
  if (p && !enoughMoney) status.push('Не хватает денег.')
  status.push('При неудаче деньги и детали спишутся.')

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

      {/* Заголовок в макете стоит НАД рамкой: слой лежит на -38 от
          верха «Плашки 1» и в неё не заходит. */}
      <h2 className="upg-panel__title">Государственная вставка камней</h2>
      <section className="upg-panel">

        {/* В макете справа от «Цена:» стоят четыре ряда камней: кружок
            сорта, прибавка и цена. Камней в игре нет, поэтому ряды
            заняты тем, из чего цена улучшения действительно состоит —
            деньгами и деталями, — а кружок показывает то, что здесь
            бывает разным: хватает или не хватает. */}
        <dl className="upg-price">
          <dt>Цена:</dt>
          <dd>
            {p ? (
              <>
                <span className="upg-price__row">
                  <i className={'upg-chip' + (enoughMoney ? '' : ' upg-chip--lack')} aria-hidden="true" />
                  {money(p.cost)} руб. — уровень {p.currentTotalLevel} → {p.nextTotalLevel}
                </span>
                {p.requiredResources.map(r => (
                  <span key={r.resourceCode} className="upg-price__row">
                    <i className={'upg-chip' + (r.enough ? '' : ' upg-chip--lack')} aria-hidden="true" />
                    {r.resourceName}: {r.available}/{r.amount}
                  </span>
                ))}
              </>
            ) : (
              <span className="upg-price__row">
                <i className="upg-chip upg-chip--idle" aria-hidden="true" />
                выберите вещь и вид усиления
              </span>
            )}
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
          <span>Вставить</span>
        </button>
      </section>

      {/* Три строки под панелью — в макете они сообщают о состоянии
          сумки. Здесь стоят те же по смыслу, но настоящие. */}
      {status.length > 0 && (
        <ul className="upg-status">
          {status.map(line => <li key={line}>{line}</li>)}
        </ul>
      )}
    </div>
  )
}
