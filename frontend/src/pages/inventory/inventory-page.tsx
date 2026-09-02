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
// Слоты манекена берутся из ARMOR_SLOT_LABELS, то есть из того, что
// умеет сервер. Полсотни рамок, нарисованных вокруг фигуры, повторять
// нечем: под них нет ни предметов, ни слотов.
//
// Карманы (расходники на бой) — наша механика, в макете её нет.
// Держим отдельной полосой под плитками, чтобы не спорить с ним.
// =============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { inventoryApi } from '../../shared/api/inventory.api'
import { shopApi } from '../../shared/api/shop.api'
import {
  ARMOR_SLOT_LABELS, QUALITY_LABELS, type ItemInstance, type ItemStatKey,
} from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { itemImage } from '../../shared/assets/shop/shop-images'
import { SPRITES } from '../../shared/ui/sprite'
import './inventory.css'

const LOADOUT_KEY = 'mmo_battle_loadout'
function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

/** Стрелковое отделено от рукопашного: в макете это разные вкладки. */
const RANGED = new Set(['PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY', 'THROWN'])

type Match = (item: ItemInstance) => boolean
interface Tab { key: string; label: string; match?: Match }

/** Порядок и подписи — как нарисовано: восемь вкладок в первом ряду,
 *  шесть во втором. Без `match` вкладка закрыта: наполнения нет. */
const TABS: Tab[] = [
  { key: 'caps',    label: 'Шапки',    match: i => i.template.armorSlot === 'HEAD' },
  { key: 'amulets', label: 'Амулеты' },
  { key: 'belts',   label: 'Пояса',    match: i => i.template.armorSlot === 'BELT' },
  { key: 'cloaks',  label: 'Плащи',    match: i => i.template.armorSlot === 'BACK' },
  { key: 'pants',   label: 'Штаны',    match: i => i.template.armorSlot === 'LEGS' },
  { key: 'armor',   label: 'Броня',    match: i => i.template.armorSlot === 'CHEST' },
  { key: 'melee',   label: 'Оружие',   match: i => i.template.type === 'WEAPON' && !RANGED.has(i.template.weaponType ?? '') },
  { key: 'ranged',  label: 'Стрелковое оружие', match: i => i.template.type === 'WEAPON' && RANGED.has(i.template.weaponType ?? '') },
  { key: 'rings',   label: 'Кольца' },
  { key: 'bracers', label: 'Наручи',   match: i => i.template.armorSlot === 'GLOVES' || i.template.armorSlot === 'HANDS' },
  { key: 'chains',  label: 'Цепочки' },
  { key: 'stones',  label: 'Камни' },
  { key: 'special', label: 'Специальные изделия' },
  { key: 'tools',   label: 'Инструменты', match: i => i.template.type === 'TOOL' || i.template.type === 'CONSUMABLE' },
]

/** Слоты манекена: две колонки по бокам фигуры, как разложено в макете. */
const LEFT_SLOTS = ['HEAD', 'CHEST', 'GLOVES', 'HANDS', 'BELT', 'LEFT_HAND']
const RIGHT_SLOTS = ['BACK', 'LEGS', 'FEET', 'ACCESSORY', 'POCKET', 'RIGHT_HAND']

export function InventoryPage() {
  const qc = useQueryClient()
  const [tabKey, setTabKey] = useState('melee')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [loadoutIds, setLoadoutIds] = useState<string[]>(() => getLoadout())

  const toggleLoadout = (id: string) => {
    setLoadoutIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(next))
      return next
    })
  }

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
  const allocateMut = useMutation({
    mutationFn: ({ id, stat }: { id: string; stat: ItemStatKey }) => inventoryApi.allocatePoints(id, stat),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['inventory'] }); showMsg('success', 'Очко распределено') },
    onError: err => fail(err, 'Не удалось распределить очко'),
  })
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
  const bySlot = (slot: string) => equipped.find(i => i.armorSlot === slot || i.template.armorSlot === slot)

  if (isLoading) return <div className="loading"><span className="spinner" />Загрузка инвентаря…</div>

  const Slot = ({ slot }: { slot: string }) => {
    const item = bySlot(slot)
    const label = ARMOR_SLOT_LABELS[slot] ?? slot
    return (
      <button type="button" className={'inv-slot' + (item ? '' : ' is-empty')}
        disabled={!item || inBattle || unequipMut.isPending}
        title={item ? `${item.template.name} — снять` : `${label}: пусто`}
        aria-label={item ? `Снять: ${item.template.name}` : `${label}: пусто`}
        onClick={() => item && unequipMut.mutate(item.id)}>
        {item && <img src={itemImage(item.template.code, item.template.weaponType, item.template.type)} alt="" />}
        <span className="inv-slot__label">{label}</span>
      </button>
    )
  }

  return (
    <div className="inv">
      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <nav className="inv-tabs" aria-label="Категории вещей">
        {TABS.map(t => (
          <button key={t.key} type="button"
            className={tabKey === t.key ? 'active' : ''}
            aria-current={tabKey === t.key}
            disabled={!t.match}
            title={t.match ? t.label : 'В игре пока нет таких вещей'}
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
                const stats = t.type === 'WEAPON'
                  ? (['DAMAGE', 'ACCURACY', 'CRIT', 'DURABILITY'] as ItemStatKey[])
                  : (['ARMOR', 'DURABILITY', 'ANTI_CRIT'] as ItemStatKey[])
                return (
                  <article key={item.id} className="inv-card">
                    <img src={itemImage(t.code, t.weaponType, t.type)} alt="" />
                    <div>
                      <div className="inv-card__head">
                        <h3 className={`q-${item.quality}`}>{t.name}</h3>
                        {/* Каждая запись инвентаря — одна вещь, поэтому
                            «Колличество» макета здесь всегда единица. */}
                        <span className="inv-card__count">Количество: 1</span>
                      </div>
                      <dl>
                        <div><dt>Прочность</dt><dd>{item.durabilityCurrent}/{item.durabilityMax}</dd></div>
                        <div><dt>Качество</dt><dd>{QUALITY_LABELS[item.quality]}</dd></div>
                        <div><dt>Требуемый уровень</dt><dd>{t.levelReq > 0 ? t.levelReq : '—'}</dd></div>
                        {t.minDamage != null && <div><dt>Урон</dt><dd>{t.minDamage}–{t.maxDamage}</dd></div>}
                        {!!t.armor && <div><dt>Броня тела</dt><dd>+{t.armor}</dd></div>}
                        {!!t.hpBonus && <div><dt>Восстановит</dt><dd>+{t.hpBonus} HP</dd></div>}
                        {t.strReq > 0 && <div><dt>Требует силы</dt><dd>{t.strReq}</dd></div>}
                      </dl>

                      {t.allocationMode === 'PLAYER' && item.freePoints > 0 && (
                        <div className="inv-card__actions">
                          <span className="inv-card__count">Очки: {item.freePoints}</span>
                          {stats.map(stat => (
                            <button key={stat} type="button" className="inv-btn"
                              disabled={allocateMut.isPending || inBattle}
                              onClick={() => allocateMut.mutate({ id: item.id, stat })}>
                              <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                              <span>+ {stat}</span>
                            </button>
                          ))}
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
                              onClick={() => sellMut.mutate(item.id)}>
                              <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                              <span>Продать</span>
                            </button>
                            <button type="button" className="inv-btn" disabled={discardMut.isPending}
                              onClick={() => discardMut.mutate(item.id)}>
                              <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
                              <span>Выбросить</span>
                            </button>
                          </>
                        )}
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
          <div className="inv-doll__slots">
            <div className="inv-doll__col">{LEFT_SLOTS.map(s => <Slot key={s} slot={s} />)}</div>
            <div className="inv-doll__figure" aria-hidden="true" />
            <div className="inv-doll__col">{RIGHT_SLOTS.map(s => <Slot key={s} slot={s} />)}</div>
          </div>
          <div className="inv-doll__strip">
            <button type="button" className="inv-btn"
              disabled={inBattle || equipped.length === 0 || unequipMut.isPending}
              onClick={() => equipped.forEach(i => unequipMut.mutate(i.id))}>
              <img className="gshop-frame" src={SPRITES['shop-btn-frame']} alt="" draggable={false} />
              <span>Снять всё</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
