// =============================================================
// Улучшения по макету «Фон основного мнею Улучшения.psd».
//
// Панель макета — «Государственная вставка камней» — складывает
// вставку из трёх частей: вещь, камень и огранка, а рядом держит
// столбец цен по сортам камня. Столбец и есть прайс: камень покупается
// у казны в момент вставки. Огранка платы не берёт, она задаёт, в
// какую характеристику лягут очки камня.
//
// Гнёзд у вещи два — столько их нарисовано под каждой ячейкой
// снаряжения в макете инвентаря.
//
// Повышение уровня — другая механика, со своей вероятностью и расходом
// деталей. Она переехала в раздел «Кузница», который до сих пор стоял
// закрытым: панель государства теперь занята вставкой.
//
// Ещё три раздела — «Личное оружие», «Специальное изделие», «Частная
// мастерская» — в игре не существуют. Они нарисованы, поэтому стоят на
// своих местах, но помечены закрытыми.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  socketsApi, upgradesApi,
  type StoneGrade, type UpgradeType,
} from '../../shared/api/upgrades.api'
import { charactersApi } from '../../shared/api/characters.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { SPRITES } from '../../shared/ui/sprite'
import '../shop/shop.css'
import './upgrades.css'

const TYPES: UpgradeType[] = ['DAMAGE', 'ACCURACY', 'CRIT', 'ARMOR', 'DURABILITY', 'ANTI_CRIT']
const TYPE_LABELS: Record<UpgradeType, string> = {
  DAMAGE: 'Урон', ACCURACY: 'Точность', CRIT: 'Крит',
  ARMOR: 'Броня', DURABILITY: 'Прочность', ANTI_CRIT: 'Защита от крита',
}

/** Разделы нарисованы в макете в этом порядке. */
const SECTIONS = [
  { key: 'state', label: 'Оружие', open: true },
  { key: 'forge', label: 'Кузница', open: true },
  { key: 'personal', label: 'Личное оружие', open: false },
  { key: 'special', label: 'Специальное изделие', open: false },
  { key: 'private', label: 'Частная мастерская', open: false },
] as const

/** Каждому сорту — свой камень с макета, по порядку столбца цен. */
const GEMS = ['gem-green', 'gem-blue', 'gem-yellow', 'gem-red']

const money = (value: number) => value.toLocaleString('ru-RU')

export function UpgradesPage() {
  const qc = useQueryClient()
  const [section, setSection] = useState<string>('state')
  const [itemId, setItemId] = useState('')
  const [stone, setStone] = useState('')
  const [cut, setCut] = useState<UpgradeType>('DAMAGE')
  const [type, setType] = useState<UpgradeType>('DAMAGE')
  const [msg, setMsg] = useState('')

  const items = useQuery({ queryKey: ['upgrades', 'items'], queryFn: upgradesApi.items })
  /* Список улучшаемых вещей отдаёт только имя и тип, без кода — а по
     коду берётся картинка. Берём её из сумки, вещь там та же по id. */
  const bag = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.getItems })
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  const rules = useQuery({ queryKey: ['upgrades', 'stones'], queryFn: socketsApi.rules })

  const grades: StoneGrade[] = rules.data?.grades ?? []
  const grade = grades.find(g => g.code === stone) ?? grades[0]

  const socket = useQuery({
    queryKey: ['upgrades', 'socket', itemId, grade?.code, cut],
    queryFn: () => socketsApi.preview(itemId, grade!.code, cut),
    enabled: !!itemId && !!grade,
  })
  const preview = useQuery({
    queryKey: ['upgrades', 'preview', itemId, type],
    queryFn: () => upgradesApi.preview(itemId, type),
    enabled: !!itemId && section === 'forge',
  })

  const refresh = () => {
    for (const key of [['upgrades'], ['inventory'], ['resources'], ['character']]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }

  const insert = useMutation({
    mutationFn: () => socketsApi.insert(itemId, grade!.code, cut),
    onSuccess: r => { setMsg(`Камень встал: ${TYPE_LABELS[r.gain.kind]} +${r.gain.points}.`); refresh() },
    onError: (e: Error) => setMsg(e.message),
  })
  const commit = useMutation({
    mutationFn: () => upgradesApi.commit(itemId, type),
    onSuccess: r => {
      setMsg(r.success ? `Получилось, уровень ${r.levelAfter}` : 'Не вышло. Деньги и детали потрачены.')
      refresh()
    },
    onError: (e: Error) => setMsg(e.message),
  })

  const chosen = bag.data?.find(x => x.id === itemId)
  const chosenImage = chosen && itemImage(chosen.template.code, chosen.template.weaponType, chosen.template.type)
  const s = socket.data
  const p = preview.data
  const lacking = p?.requiredResources.filter(r => !r.enough) ?? []

  const status: string[] = []
  if (items.data?.length === 0) status.push('У вас нет вещей для улучшения.')
  else if (!itemId) status.push('Вещь не выбрана.')
  if (section === 'state' && s) {
    status.push(`Гнёзда: занято ${s.socketsUsed} из ${s.socketsMax}.`)
    status.push(`Вставка даст ${TYPE_LABELS[s.gain.kind]} +${s.gain.points} за ${money(s.price)} руб.`)
    if (!s.hasFreeSocket) status.push('Свободных гнёзд нет.')
    if (!s.enoughMoney) status.push('Не хватает денег.')
  }
  if (section === 'forge' && p) {
    status.push(`Станет: +${p.nextTotalLevel}. Шанс успеха: ${Math.round(p.chance * 100)}%.`)
    if (lacking.length > 0) status.push(`Не хватает деталей: ${lacking.map(r => r.resourceName).join(', ')}.`)
    status.push('При неудаче деньги и детали спишутся.')
  }

  return (
    <div className="upg">
      {msg && <div className="alert mb8">{msg}</div>}

      {/* Наличность в макете стоит над разделами, той же плашкой, что
          в магазине и мастерской. */}
      <header className="gshop-head">
        <span className="gshop-cash">
          <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
          <span>Ваша наличность: <b>{me.data ? money(me.data.money) : '—'} руб.</b></span>
        </span>
      </header>

      <nav className="gshop-tabs" aria-label="Разделы улучшений">
        {SECTIONS.map(x => (
          <button
            key={x.key}
            className={section === x.key ? 'active' : ''}
            aria-current={section === x.key}
            disabled={!x.open}
            title={x.open ? x.label : 'Раздел откроется позже'}
            onClick={() => setSection(x.key)}
          >
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <span>{x.label}</span>
          </button>
        ))}
      </nav>

      {/* Заголовок в макете стоит НАД рамкой: слой лежит на -38 от
          верха «Плашки 1» и в неё не заходит. */}
      <h2 className="upg-panel__title">
        {section === 'state' ? 'Государственная вставка камней' : 'Кузница: повышение уровня'}
      </h2>

      <section className="upg-panel">
        {section === 'state' ? (
          <>
            {/* Столбец цен макета: четыре сорта, у каждого свой камень
                и своя цена. Выбранный сорт подсвечен. */}
            <dl className="upg-price">
              <dt>Цена:</dt>
              <dd>
                {grades.map((g, i) => (
                  <button
                    key={g.code}
                    type="button"
                    className={'upg-price__row' + (g.code === grade?.code ? ' is-current' : '')}
                    aria-pressed={g.code === grade?.code}
                    onClick={() => setStone(g.code)}
                  >
                    <img className="upg-chip" src={SPRITES[GEMS[i] ?? 'gem-green']} alt="" draggable={false} />
                    {g.name}: +{g.points} — {money(g.fee)} руб.
                  </button>
                ))}
                {grades.length === 0 && (
                  <span className="upg-price__row">
                    <img className="upg-chip" src={SPRITES['gem-green']} alt="" draggable={false} />
                    прайс загружается
                  </span>
                )}
              </dd>
            </dl>

            <div className="upg-rule" />

            <div className="upg-slots">
              <label className="upg-slot">
                <span>Предмет</span>
                <span className="upg-slot__box">
                  {chosenImage
                    ? <img src={chosenImage} alt="" draggable={false} />
                    : <span className="upg-slot__mark" aria-hidden="true">—</span>}
                  <select className="upg-slot__pick" value={itemId} onChange={e => setItemId(e.target.value)}
                    aria-label="Вещь для вставки">
                    <option value="">не выбрано</option>
                    {items.data?.map(x => <option key={x.id} value={x.id}>{x.template.name} (+{x.upgradeLevel})</option>)}
                  </select>
                </span>
              </label>

              <label className="upg-slot">
                <span>Камень</span>
                <span className="upg-slot__box">
                  <img src={SPRITES[GEMS[grades.findIndex(g => g.code === grade?.code)] ?? 'gem-diamond']}
                    alt="" draggable={false} />
                  <select className="upg-slot__pick" value={grade?.code ?? ''}
                    onChange={e => setStone(e.target.value)} aria-label="Сорт камня">
                    {grades.map(g => <option key={g.code} value={g.code}>{g.name}</option>)}
                  </select>
                </span>
              </label>

              <label className="upg-slot">
                <span>Огранка</span>
                <span className="upg-slot__box">
                  <img src={SPRITES['gem-cut']} alt="" draggable={false} />
                  <select className="upg-slot__pick" value={cut}
                    onChange={e => setCut(e.target.value as UpgradeType)} aria-label="Огранка">
                    {TYPES.map(x => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
                  </select>
                </span>
              </label>
            </div>

            <button className="upg-commit" disabled={!s?.canCommit || insert.isPending}
              onClick={() => insert.mutate()}>
              <span>Вставить</span>
            </button>
          </>
        ) : (
          <>
            {/* Кузница: прежнее повышение уровня. Вещь, вид усиления и
                живой расчёт цены с шансом. */}
            <dl className="upg-price">
              <dt>Цена:</dt>
              <dd>
                {p ? (
                  <>
                    <span className="upg-price__row">
                      <img className="upg-chip" src={SPRITES['gem-green']} alt="" draggable={false} />
                      {money(p.cost)} руб. — уровень {p.currentTotalLevel} → {p.nextTotalLevel}
                    </span>
                    {p.requiredResources.map(r => (
                      <span key={r.resourceCode} className="upg-price__row">
                        <img className="upg-chip" src={SPRITES[r.enough ? 'gem-green' : 'gem-red']}
                          alt="" draggable={false} />
                        {r.resourceName}: {r.available}/{r.amount}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="upg-price__row">
                    <img className="upg-chip" src={SPRITES['gem-green']} alt="" draggable={false} />
                    выберите вещь и вид усиления
                  </span>
                )}
              </dd>
            </dl>

            <div className="upg-rule" />

            <div className="upg-slots">
              <label className="upg-slot">
                <span>Предмет</span>
                <span className="upg-slot__box">
                  {chosenImage
                    ? <img src={chosenImage} alt="" draggable={false} />
                    : <span className="upg-slot__mark" aria-hidden="true">—</span>}
                  <select className="upg-slot__pick" value={itemId} onChange={e => setItemId(e.target.value)}
                    aria-label="Вещь для улучшения">
                    <option value="">не выбрано</option>
                    {items.data?.map(x => <option key={x.id} value={x.id}>{x.template.name} (+{x.upgradeLevel})</option>)}
                  </select>
                </span>
              </label>

              <label className="upg-slot">
                <span>Усиление</span>
                <span className="upg-slot__box">
                  <img src={SPRITES['gem-diamond']} alt="" draggable={false} />
                  <select className="upg-slot__pick" value={type}
                    onChange={e => setType(e.target.value as UpgradeType)} aria-label="Вид усиления">
                    {TYPES.map(x => <option key={x} value={x}>{TYPE_LABELS[x]}</option>)}
                  </select>
                </span>
              </label>

              <div className="upg-slot">
                <span>Результат</span>
                <span className={'upg-slot__box' + (p ? '' : ' is-empty')}>
                  <output className="upg-slot__mark">{p ? `+${p.nextTotalLevel}` : '—'}</output>
                </span>
              </div>
            </div>

            <button className="upg-commit" disabled={!p?.canCommit || commit.isPending}
              onClick={() => commit.mutate()}>
              <span>Улучшить</span>
            </button>
          </>
        )}
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
