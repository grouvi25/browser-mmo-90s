// =============================================================
// Инвентарь по макету «Инвентарь.psd» (холст 3200x1800).
//
// Композиция макета: два ряда вкладок категорий, слева плитки вещей
// с картинкой, названием, количеством, прочностью и блоком
// характеристик, справа панель с манекеном, слотами экипировки и
// кнопкой «снять всё».
//
// Категорий в макете четырнадцать, и пять из них в игре не
// существуют: колец, амулетов, цепочек, камней и специальных изделий
// нет ни как типа вещи, ни как слота. Они нарисованы, поэтому стоят
// на своих местах, но отключены — вести живую вкладку в пустоту хуже,
// чем показать её закрытой.
//
// Манекен и его ячейки взяты из макета по координатам слоёв. Рамок
// там 48, но это не 48 слотов: шестнадцать ячеек снаряжения, и в
// каждой по два гнезда под камни. Одиннадцать ячеек заняты нашими
// слотами, пять пустуют, гнёзда молчат — вставки камней в игре нет.
//
// Карманы (расходники на бой) — наша механика, в макете её нет.
// Держим отдельной полосой под плитками, чтобы не спорить с ним.
// =============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { OutfitBar } from './outfit-bar'
import { GearSummaryDialog, ItemSetupDialog } from './item-setup'
import { inventoryApi } from '../../shared/api/inventory.api'
import { shopApi } from '../../shared/api/shop.api'
import { ARMOR_SLOT_LABELS, QUALITY_LABELS, type ItemInstance } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { instanceImage, itemBonusLines } from '../../shared/lib/item-bonuses'
import { SPRITES } from '../../shared/ui/sprite'
import { rangeLabel } from '../../shared/lib/weapon-range'
import { useBattleLoadout } from '../../shared/lib/battle-loadout'
import '../shop/shop.css'
import './inventory.css'

/** Стрелковое отделено от рукопашного: в макете это разные вкладки. */
const RANGED = new Set(['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY', 'THROWN'])

type Match = (item: ItemInstance) => boolean
interface Tab { key: string; label: string; match?: Match }

/** Порядок и подписи — как нарисовано (плюс «Обувь»): восемь вкладок в
 *  первом ряду, остальные во втором. Все вкладки открыты (правка заказчика
 *  28.10: «сделать все вкладки со шмотом активные»): где вещей пока нет,
 *  вкладка просто пустая. */
const TABS: Tab[] = [
  { key: 'caps',    label: 'Шапки',    match: i => i.template.armorSlot === 'HEAD' },
  { key: 'amulets', label: 'Амулеты',  match: i => i.template.armorSlot === 'ACCESSORY' },
  { key: 'belts',   label: 'Пояса',    match: i => i.template.armorSlot === 'BELT' },
  { key: 'cloaks',  label: 'Плащи',    match: i => i.template.armorSlot === 'BACK' },
  { key: 'pants',   label: 'Штаны',    match: i => i.template.armorSlot === 'LEGS' },
  // Обуви в макете нет, а вещи под ноги в игре есть (берцы): без вкладки
  // купленную обувь на складе было не найти (правка заказчика 22.10).
  { key: 'boots',   label: 'Обувь',    match: i => i.template.armorSlot === 'FEET' },
  { key: 'armor',   label: 'Броня',    match: i => i.template.armorSlot === 'CHEST' },
  { key: 'melee',   label: 'Оружие',   match: i => i.template.type === 'WEAPON' && !RANGED.has(i.template.weaponType ?? '') },
  { key: 'ranged',  label: 'Стрелковое оружие', match: i => i.template.type === 'WEAPON' && RANGED.has(i.template.weaponType ?? '') },
  { key: 'rings',   label: 'Кольца',   match: i => i.template.armorSlot === 'RING' },
  { key: 'bracers', label: 'Наручи',   match: i => i.template.armorSlot === 'GLOVES' || i.template.armorSlot === 'HANDS' },
  { key: 'chains',  label: 'Цепочки',  match: () => false },
  { key: 'stones',  label: 'Камни',    match: i => i.template.type === 'UPGRADE_MODULE' },
  { key: 'special', label: 'Специальные изделия', match: i => i.template.type === 'SHIELD' || i.template.type === 'COMPONENT' },
  { key: 'tools',   label: 'Инструменты', match: i => i.template.type === 'TOOL' || i.template.type === 'CONSUMABLE' },
]

interface Rect { x: number; y: number; w: number; h: number }
interface Cell { slot: string | null; box: Rect; sockets: Rect[] }

/** Манекен взят из макета как есть. Ячеек шестнадцать, у каждой два
 *  гнезда под камни — это и есть те 48 рамок «Прямоугольник 6».
 *  Числа ниже посчитаны из слоёв: доли панели «Прямоугольник 1 копия 4»
 *  (2314,350 · 709x1251), в которой они нарисованы.
 *
 *  Наших слотов двенадцать, и один из них — карманы, у которых своя
 *  полоса. Остальные одиннадцать легли по месту на теле; перчатки и
 *  руки — на верхние боковые ячейки, зеркально друг другу. Пять ячеек
 *  остаются без слота: под них в игре нет ни вещей, ни места, и это
 *  ровно те пять категорий, что закрыты во вкладках. Гнёзда под камни
 *  не работают — вставки камней в игре нет.
 */
/** Прибавка от очков, улучшений и камней к базовой характеристике. */
function Gain({ value }: { value: number }) {
  return value > 0 ? <span className="inv-card__gain"> (+{value})</span> : null
}
/** Доли (0.05) в проценты с одним знаком после запятой, без хвостовых нулей. */
const pct = (share: number) => Math.round(share * 1000) / 10
/** Процентная характеристика: базовая — итогом с прибавкой, новая — «+N%». */
function PercentRow({ label, total, base }: { label: string; total: number; base: number }) {
  const gain = Math.round((total - base) * 1000) / 10
  return <div><dt>{label}</dt><dd>{base > 0 ? <>{pct(total)}%{gain > 0 && <span className="inv-card__gain"> (+{gain})</span>}</> : <>+{pct(total)}%</>}</dd></div>
}

const CELLS: Cell[] = [
  { slot: 'HEAD', box: { x: 39.77, y: 1.28, w: 20.31, h: 11.51 },
    sockets: [{ x: 40.9, y: 8.55, w: 6.35, h: 3.6 }, { x: 52.89, y: 8.55, w: 6.35, h: 3.6 }] },
  { slot: 'ACCESSORY', box: { x: 39.77, y: 13.51, w: 20.45, h: 6 },
    sockets: [{ x: 40.76, y: 15.11, w: 6.35, h: 3.6 }, { x: 52.89, y: 15.11, w: 6.35, h: 3.6 }] },
  { slot: 'CHEST', box: { x: 35.54, y: 20.46, w: 28.77, h: 27.5 },
    sockets: [{ x: 36.53, y: 39.57, w: 9.17, h: 7.59 }, { x: 53.88, y: 39.57, w: 9.17, h: 7.59 }] },
  { slot: 'BACK', box: { x: 71.65, y: 27.9, w: 18.05, h: 17.43 },
    sockets: [{ x: 72.78, y: 41.25, w: 6.35, h: 3.6 }, { x: 82.37, y: 41.25, w: 6.35, h: 3.6 }] },
  { slot: 'LEFT_HAND', box: { x: 3.1, y: 47.08, w: 28.91, h: 13.75 },
    sockets: [{ x: 4.23, y: 55.16, w: 9.17, h: 5.12 }, { x: 21.72, y: 55.16, w: 9.17, h: 5.12 }] },
  { slot: 'RIGHT_HAND', box: { x: 67.56, y: 47.08, w: 28.91, h: 13.75 },
    sockets: [{ x: 68.55, y: 55.16, w: 9.17, h: 5.12 }, { x: 86.32, y: 55.16, w: 9.17, h: 5.12 }] },
  { slot: 'BELT', box: { x: 39.77, y: 48.52, w: 20.45, h: 6 },
    sockets: [{ x: 40.76, y: 50.12, w: 6.35, h: 3.6 }, { x: 52.89, y: 49.64, w: 6.35, h: 3.6 }] },
  { slot: 'GLOVES', box: { x: 3.1, y: 61.71, w: 14.25, h: 7.51 },
    sockets: [{ x: 3.95, y: 65.23, w: 6.35, h: 3.52 }, { x: 10.16, y: 65.23, w: 6.35, h: 3.52 }] },
  { slot: 'RING', box: { x: 17.91, y: 61.71, w: 14.25, h: 7.51 },
    sockets: [{ x: 18.9, y: 65.23, w: 6.35, h: 3.52 }, { x: 25.11, y: 65.23, w: 6.35, h: 3.52 }] },
  { slot: 'HANDS', box: { x: 67.56, y: 61.71, w: 14.25, h: 7.51 },
    sockets: [{ x: 68.41, y: 65.23, w: 6.35, h: 3.52 }, { x: 74.61, y: 65.23, w: 6.35, h: 3.52 }] },
  { slot: 'RING_2', box: { x: 82.37, y: 61.71, w: 14.25, h: 7.51 },
    sockets: [{ x: 83.22, y: 65.23, w: 6.35, h: 3.52 }, { x: 89.42, y: 65.23, w: 6.35, h: 3.52 }] },
  { slot: 'LEGS', box: { x: 3.1, y: 70.5, w: 14.25, h: 7.51 },
    sockets: [{ x: 3.95, y: 74.02, w: 6.35, h: 3.52 }, { x: 10.16, y: 74.02, w: 6.35, h: 3.52 }] },
  { slot: null, box: { x: 17.91, y: 70.5, w: 14.25, h: 7.51 },
    sockets: [{ x: 18.9, y: 74.02, w: 6.35, h: 3.52 }, { x: 25.11, y: 74.02, w: 6.35, h: 3.52 }] },
  { slot: null, box: { x: 67.56, y: 70.5, w: 14.25, h: 7.51 },
    sockets: [{ x: 68.41, y: 74.02, w: 6.35, h: 3.52 }, { x: 74.61, y: 74.02, w: 6.35, h: 3.52 }] },
  { slot: null, box: { x: 82.37, y: 70.5, w: 14.25, h: 7.51 },
    sockets: [{ x: 83.22, y: 74.02, w: 6.35, h: 3.52 }, { x: 89.42, y: 74.02, w: 6.35, h: 3.52 }] },
  { slot: 'FEET', box: { x: 35.83, y: 79.3, w: 28.21, h: 14.55 },
    sockets: [{ x: 36.67, y: 87.93, w: 9.17, h: 5.12 }, { x: 53.74, y: 87.93, w: 9.17, h: 5.12 }] },
]

const place = (r: Rect) => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` })
export function InventoryPage() {
  const qc = useQueryClient()
  const [tabKey, setTabKey] = useState('melee')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const pocket = useBattleLoadout()
  const loadoutIds = pocket.ids
  const toggleLoadout = pocket.toggle

  const { data: char } = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe() })
  const { data: items = [], isLoading } = useQuery({ queryKey: ['inventory'], queryFn: () => inventoryApi.getItems() })

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }
  const fail = (err: unknown, fallback: string) =>
    showMsg('error', err instanceof ApiError ? err.message : fallback)

  const inBattle = char?.status === 'IN_BATTLE'
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }

  const equipMut = useMutation({
    mutationFn: ({ id, hand }: { id: string; hand?: 'LEFT_HAND' | 'RIGHT_HAND' }) => inventoryApi.equip(id, hand),
    onSuccess: () => { refresh(); showMsg('success', 'Предмет надет') },
    onError: err => {
      const code = err instanceof ApiError ? err.code : ''
      const text = code === 'CHAR_003' ? 'Нельзя менять экипировку во время боя'
        : code === 'ITEM_004' ? 'Предмет уже надет'
        : code === 'ITEM_003' ? 'Предмет сломан — сначала починить'
        : code === 'ITEM_007' ? 'Недостаточный уровень'
        : null
      if (text) showMsg('error', text); else fail(err, 'Ошибка сервера')
    },
  })
  const unequipMut = useMutation({
    mutationFn: (id: string) => inventoryApi.unequip(id),
    onSuccess: () => { refresh(); showMsg('success', 'Предмет снят') },
    onError: err => fail(err, 'Ошибка сервера'),
  })
  const useItemMut = useMutation({
    mutationFn: (id: string) => inventoryApi.useItem(id),
    onSuccess: data => { refresh(); showMsg('success', `${data.itemName}: +${data.hpRestored} HP (теперь ${data.newHp} HP)`) },
    onError: err => fail(err, 'Ошибка'),
  })
  // Столбики именной вещи и итог комплекта (заказчик 30.10) — отдельными окнами.
  const [setupId, setSetupId] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const setupItem = items.find(item => item.id === setupId)
  const sellMut = useMutation({
    mutationFn: (id: string) => shopApi.sell(id),
    onSuccess: data => { refresh(); showMsg('success', `Продано за ${data.sellPrice.toLocaleString('ru')} ₽`) },
    onError: err => fail(err, 'Ошибка'),
  })
  const discardMut = useMutation({
    mutationFn: (id: string) => shopApi.discard(id),
    onSuccess: () => { refresh(); showMsg('success', 'Предмет выброшен') },
    onError: err => fail(err, 'Ошибка'),
  })

  const equipped = useMemo(() => items.filter(i => i.isEquipped), [items])
  const consumables = useMemo(
    () => items.filter(i => i.template.type === 'CONSUMABLE' && !i.isEquipped && i.status !== 'DELETED'),
    [items],
  )
  const tab = TABS.find(t => t.key === tabKey) ?? TABS[0]
  const visible = items.filter(i => i.status !== 'DELETED' && (tab.match?.(i) ?? false))
  // Кольца две, а на шаблоне слот один: у них смотрим только, куда надето.
  const bySlot = (slot: string) => equipped.find(i => i.armorSlot === slot || (!slot.startsWith('RING') && i.template.armorSlot === slot))

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка инвентаря…</div>

  const DollCell = ({ cell }: { cell: Cell }) => {
    const sockets = cell.sockets.map((s, n) => (
      <span key={n} className="inv-socket" style={place(s)} aria-hidden="true" />
    ))
    if (!cell.slot) {
      return <>
        <span className="inv-cell is-locked" style={place(cell.box)} aria-hidden="true" />
        {sockets}
      </>
    }
    const item = bySlot(cell.slot)
    const label = ARMOR_SLOT_LABELS[cell.slot] ?? cell.slot
    return <>
      <button type="button" className={'inv-cell' + (item ? '' : ' is-empty')} style={place(cell.box)} data-slot={cell.slot}
        disabled={!item || inBattle || unequipMut.isPending}
        title={item ? `${item.template.name} — снять` : `${label}: пусто`}
        aria-label={item ? `Снять: ${item.template.name}` : `${label}: пусто`}
        onClick={() => item && unequipMut.mutate(item.id)}>
        {item && <img src={instanceImage(item)} alt="" />}
      </button>
      {sockets}
    </>
  }

  return (
    <div className="inv">
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}
      <OutfitBar disabled={inBattle} onMessage={showMsg} />
      {char && <button type="button" className="inv-btn inv-summary-btn" onClick={() => setSummaryOpen(true)}>
        <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
        <span>Итог комплекта</span>
      </button>}
      {summaryOpen && char && <GearSummaryDialog char={char} onClose={() => setSummaryOpen(false)} />}
      {setupItem && <ItemSetupDialog key={setupItem.id} item={setupItem} disabled={inBattle} onClose={() => setSetupId(null)} onMessage={showMsg} />}

      <nav className="inv-tabs" aria-label="Категории вещей">
        {TABS.map(t => (
          <button key={t.key} type="button"
            className={tabKey === t.key ? 'active' : ''}
            aria-current={tabKey === t.key}
            title={t.label}
            onClick={() => setTabKey(t.key)}>
            <img className="gshop-frame" src={SPRITES['shop-tab-frame']} alt="" draggable={false} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <div className="inv-body">
        <div>
          {visible.length === 0 ? (
            <p className="inv-empty">В этой категории пусто.</p>
          ) : (
            <section className="inv-grid">
              {visible.map(item => {
                const t = item.template
                const broken = item.status === 'BROKEN' || item.durabilityCurrent <= 0
                const tooLow = (char?.battleLevel ?? 0) < t.levelReq
                const eff = item.effective
                return (
                  <article key={item.id} className="inv-card">
                    <img src={instanceImage(item)} alt="" />
                    <div>
                      <div className="inv-card__head">
                        <h3 className={`q-${item.quality}`}>{t.name}{!!item.namedLevel && <small> · ур. {item.namedLevel}</small>}</h3>
                        {/* Каждая запись инвентаря — одна вещь, поэтому
                            «Колличество» макета здесь всегда единица. */}
                        <span className="inv-card__count">Количество: 1</span>
                      </div>
                      <div className="inv-card__body">
                        <dl>
                          <div><dt>Прочность</dt><dd>{item.durabilityCurrent}/{item.durabilityMax}</dd></div>
                          <div><dt>Качество</dt><dd>{QUALITY_LABELS[item.quality]}</dd></div>
                          <div><dt>Требуемый уровень</dt><dd>{t.levelReq > 0 ? t.levelReq : '—'}</dd></div>
                          {t.minDamage != null && <div><dt>Урон</dt><dd>{eff?.minDamage ?? t.minDamage}–{eff?.maxDamage ?? t.maxDamage}<Gain value={(eff?.maxDamage ?? 0) - (t.maxDamage ?? 0)} /></dd></div>}
                          {t.type === 'WEAPON' && !!t.maxRange && <div><dt>Дальность</dt><dd>{rangeLabel(t.maxRange)}</dd></div>}
                          {!!t.armor && <div><dt>Броня тела</dt><dd>+{eff?.armor ?? t.armor}<Gain value={(eff?.armor ?? 0) - (t.armor ?? 0)} /></dd></div>}
                          {!!t.hpBonus && <div><dt>{t.type === 'CONSUMABLE' ? 'Восстановит' : 'Здоровье'}</dt><dd>+{t.hpBonus} HP</dd></div>}
                          {/* Заказчик 30.10: «обереги не все в карточке шмота». Теперь здесь всё:
                              статы, мастерства и обереги, и базовые, и вписанные игроком. */}
                          {itemBonusLines(t, item).map(line => <div key={line.key}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}
                          {t.strReq > 0 && <div><dt>Требует силы</dt><dd>{t.strReq}</dd></div>}
                          {/* Характеристики, которых у вещи в базе нет, — новой строкой внизу. */}
                          {/* Есть в базе — итог и прибавка (точность ножа 70% → «71% (+1)»);
                              нет в базе — «+N%» новой строкой. */}
                          {!!eff?.weaponAccuracy && <PercentRow label="Точность" total={eff.weaponAccuracy} base={t.weaponAccuracy ?? 0} />}
                          {!!eff?.critBonus && <PercentRow label="Крит" total={eff.critBonus} base={t.critBonus ?? 0} />}
                        </dl>
                        <div className="inv-card__side">
                          {t.allocationMode === 'PLAYER' && (item.budget ?? 0) > 0 && (
                            <div className="inv-card__actions">
                              <span className="inv-card__count">Очки: {item.freePoints} из {item.budget}</span>
                              <button type="button" className="inv-btn" disabled={inBattle} onClick={() => setSetupId(item.id)}>
                                <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                <span>Настроить</span>
                              </button>
                            </div>
                          )}

                          <div className="inv-card__actions">
                            {item.isEquipped ? (
                              <button type="button" className="inv-btn" disabled={inBattle || unequipMut.isPending}
                                onClick={() => unequipMut.mutate(item.id)}>
                                <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                <span>Снять</span>
                              </button>
                            ) : t.type === 'CONSUMABLE' ? (
                              <>
                                <button type="button" className="inv-btn" disabled={useItemMut.isPending}
                                  onClick={() => useItemMut.mutate(item.id)}>
                                  <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                  <span>Использовать</span>
                                </button>
                                <button type="button" className="inv-btn"
                                  onClick={() => toggleLoadout(item.id)}>
                                  <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                  <span>{loadoutIds.includes(item.id) ? 'Из кармана' : 'В карман'}</span>
                                </button>
                              </>
                            ) : (
                              <button type="button" className="inv-btn"
                                disabled={inBattle || broken || tooLow || equipMut.isPending}
                                title={broken ? 'Сломан — сначала починить' : tooLow ? `Нужен ${t.levelReq}-й уровень` : undefined}
                                onClick={() => equipMut.mutate({ id: item.id })}>
                                <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                <span>Надеть</span>
                              </button>
                            )}
                            {!item.isEquipped && (
                              <>
                                <button type="button" className="inv-btn" disabled={sellMut.isPending}
                                  onClick={() => { if (window.confirm(`Продать «${t.name}»? Вернуть вещь будет нельзя.`)) sellMut.mutate(item.id) }}>
                                  <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                  <span>Продать</span>
                                </button>
                                <button type="button" className="inv-btn" disabled={discardMut.isPending}
                                  onClick={() => { if (window.confirm(`Выбросить «${t.name}»? Вещь пропадёт насовсем.`)) discardMut.mutate(item.id) }}>
                                  <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                                  <span>Выбросить</span>
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>
          )}

          <section className="inv-pockets" aria-label="Боевой карман">
            <div className="inv-pockets__head">
              <b>Карманы — взять в бой, максимум 4</b>
              <small>Наполни перед боем: расходники будут доступны прямо в схватке</small>
              {pocket.error && <small role="alert" className="inv-pockets__error">
                {pocket.error instanceof ApiError ? pocket.error.message : 'Не удалось сохранить карман'}
              </small>}
            </div>
            <div className="inv-pockets__list">
              {[0, 1, 2, 3].map(i => {
                const id = loadoutIds[i]
                const item = id ? consumables.find(x => x.id === id) : null
                return (
                  <button key={i} type="button" className="inv-btn"
                    disabled={!item} onClick={() => item && toggleLoadout(item.id)}
                    title={item ? 'Убрать из кармана' : 'Пусто'}>
                    <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                    <span>{i + 1}. {item ? item.template.name : '— пусто —'}{item && <X size={9} />}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <aside className="inv-doll" aria-label="Надетое снаряжение">
          <div className="inv-doll__figure" aria-hidden="true" />
          {CELLS.map((cell, n) => <DollCell key={cell.slot ?? `empty-${n}`} cell={cell} />)}
          <button type="button" className="inv-doll__all"
            disabled={inBattle || equipped.length === 0 || unequipMut.isPending}
            onClick={() => equipped.forEach(i => unequipMut.mutate(i.id))}>
            Снять всё
          </button>
        </aside>
      </div>
    </div>
  )
}
