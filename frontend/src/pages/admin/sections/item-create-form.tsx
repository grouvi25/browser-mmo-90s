// =============================================================
// Вещь: создать, поправить, сделать по образцу (просьба заказчика 25.10:
// «по шмоту — буду сам добавлять»; переделки 30.10: «не понятно, как
// добавлять в общий, в Берёзку, в ЦУМ и как статы распределять — много
// дублируются поля», «чтобы Дима больше не путался»).
//
// Форма идёт шагами, как думает человек, который заводит вещь:
//   1. что это и какого уровня;
//   2. где продаётся и почём — госмагазин, ЦУМ, Берёзка, лавки или нигде;
//   3. основа вещи: урон и точность у оружия, броня у одежды;
//   4. что вещь даёт надевшему: характеристики, здоровье, шансы, обереги;
//   5. очки улучшения — по умолчанию их расставляет игрок, число по уровню.
// Внизу — карточка «как увидит игрок»: видно итог до сохранения.
//
// Та же форма открывается у готовой вещи кнопками «править» (меняются только
// изменённые поля, тип и слот — нет) и «копия» (новая вещь по образцу:
// похожие вещи по уровням заводятся за минуту).
// =============================================================
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { adminApi, REASON_MIN, type ItemTemplateRow } from '../admin-api'
import { Note } from '../../stage3/stage3-ui'
import { CHARMS, GEAR_STATS, KINDS, SHOPS, shopTitle, type Kind, type Shop } from './item-catalog'

type StatKey = 'DAMAGE' | 'ACCURACY' | 'CRIT' | 'ARMOR' | 'DURABILITY' | 'ANTI_CRIT'
export type ItemFormMode = 'create' | 'edit' | 'copy'

const WEAPON_TYPES: [string, string][] = [
  ['MELEE', 'Рукопашка'], ['KNIFE', 'Нож'], ['CLUB', 'Дубинка'], ['PISTOL', 'Пистолет'], ['SHOTGUN', 'Дробовик'],
  ['SMG', 'Пистолет-пулемёт'], ['RIFLE', 'Автомат'], ['SNIPER', 'Винтовка'], ['HEAVY', 'Тяжёлое'], ['THROWN', 'Метательное'],
]
const SLOTS: [string, string][] = [
  ['HEAD', 'Голова (шапка)'], ['CHEST', 'Тело (куртка, броня)'], ['LEGS', 'Штаны'], ['FEET', 'Обувь'],
  ['GLOVES', 'Руки (перчатки, наручи)'], ['BELT', 'Пояс'], ['BACK', 'Плащ'],
]
/** Очки улучшения: что даёт одно очко (формулы улучшений игры). */
const STAT_INFO: Record<StatKey, { title: string; perPoint: string }> = {
  DAMAGE: { title: 'Урон', perPoint: '+4% урона оружия' },
  ACCURACY: { title: 'Точность', perPoint: '+1% точности оружия' },
  CRIT: { title: 'Крит', perPoint: '+0,5% шанса крита' },
  ARMOR: { title: 'Броня', perPoint: '+6% брони вещи' },
  ANTI_CRIT: { title: 'Защита от крита', perPoint: '−0,5% шанса, что по вам пройдёт крит' },
  DURABILITY: { title: 'Прочность', perPoint: '' },
}
const STATS_FOR: Partial<Record<Kind, StatKey[]>> = {
  WEAPON: ['DAMAGE', 'ACCURACY', 'CRIT'],
  ARMOR: ['ARMOR', 'ANTI_CRIT'],
  SHIELD: ['ARMOR', 'ANTI_CRIT'],
  ACCESSORY: ['ARMOR', 'ANTI_CRIT'],
}

const toNumber = (raw: string) => { const n = Number(String(raw).replace(',', '.')); return Number.isFinite(n) ? n : 0 }
/** Целое в пределах — так же, как проверяет сервер. */
const int = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))
/** Проценты из поля (5 = 5%) в долю для сервера, в пределах. */
const share = (percent: number, min: number, max: number) => Math.min(max, Math.max(min, percent)) / 100
/** Доля из базы в проценты для поля, без хвостов 0,30000000000000004. */
const percent = (value: number | null | undefined) => Math.round((value ?? 0) * 1000) / 10
const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)
const money = (n: number) => n.toLocaleString('ru-RU')

/**
 * Очки по уровню — правило заказчика: 1-й уровень — 3, 2-й — 4, 3-й — 7,
 * 4-й — 10, дальше +3 за уровень.
 */
function statBudgetForLevel(level: number): number {
  return level <= 1 ? 3 : 3 * level - 2
}

export function ItemCreateForm({ onDone, onCancel, initial, mode = 'create' }: {
  onDone: (code: string) => void
  onCancel?: () => void
  initial?: ItemTemplateRow
  mode?: ItemFormMode
}) {
  const editing = mode === 'edit' && !!initial
  const firstSale = initial?.sales?.[0]
  const startShop: Shop = initial ? ((firstSale?.shop ?? '') as Shop) : 'GOVERNMENT'
  const [kind, setKind] = useState<Kind>((initial?.type as Kind) ?? 'ARMOR')
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [weaponType, setWeaponType] = useState(initial?.weaponType ?? 'KNIFE')
  const [slot, setSlot] = useState(initial?.armorSlot && initial.armorSlot !== 'ACCESSORY' ? initial.armorSlot : 'HEAD')
  const [level, setLevel] = useState(initial?.levelReq ?? 1)
  const [shop, setShop] = useState<Shop>(startShop)
  const [price, setPrice] = useState(firstSale?.price ?? initial?.priceBase ?? 500)
  const [rubValue, setRubValue] = useState(initial?.priceBase ?? 500)
  const [durability, setDurability] = useState(initial?.durabilityMax ?? 100)
  const [weight, setWeight] = useState(initial?.weight ?? 1)
  const [minDamage, setMinDamage] = useState(initial?.minDamage ?? 4)
  const [maxDamage, setMaxDamage] = useState(initial?.maxDamage ?? 8)
  const [accuracy, setAccuracy] = useState(initial?.weaponAccuracy != null ? percent(initial.weaponAccuracy) : 75)
  const [range, setRange] = useState(initial?.maxRange ?? 1)
  const [armor, setArmor] = useState(initial?.armor ?? 3)
  const [crit, setCrit] = useState(percent(initial?.critBonus))
  const [dodge, setDodge] = useState(percent(initial?.dodgeBonus))
  const [hp, setHp] = useState(initial?.hpBonus ?? 0)
  const [gearStats, setGearStats] = useState<Record<string, number>>({ ...(initial?.statBonuses ?? {}) })
  const [charms, setCharms] = useState<Record<string, number>>(
    Object.fromEntries(CHARMS.map(([key]) => [key, percent((initial as Record<string, unknown> | undefined)?.[key] as number | null)])))
  const [budget, setBudget] = useState(initial?.statBudget ?? statBudgetForLevel(initial?.levelReq ?? 1))
  const [budgetTouched, setBudgetTouched] = useState(!!initial && initial.statBudget !== statBudgetForLevel(initial.levelReq ?? 1))
  const [fixed, setFixed] = useState(initial?.allocationMode === 'FIXED' && !!initial.statAllocation && Object.keys(initial.statAllocation).length > 0)
  const [alloc, setAlloc] = useState<Partial<Record<StatKey, number>>>({ ...(initial?.statAllocation ?? {}) })
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const stats = STATS_FOR[kind] ?? []
  const wearable = stats.length > 0
  const worn = kind !== 'CONSUMABLE' && kind !== 'TOOL'
  const spent = stats.reduce((sum, key) => sum + (alloc[key] ?? 0), 0)
  const shopInfo = SHOPS.find(item => item.value === shop)!
  const dollars = !editing && shopInfo.currency === '$'
  // Рублёвая стоимость вещи нужна всегда: от неё считаются ремонт и продажа
  // государству. В рублёвом магазине это и есть цена на витрине.
  const priceBase = editing || dollars ? rubValue : price
  const defaultReason = name.trim() ? (editing ? `Правка вещи «${name.trim()}»` : `Новая вещь «${name.trim()}»`) : ''
  const reasonText = reason.trim() || defaultReason

  // Смена валюты: рубли не превращаются в доллары. Уходя в ЦУМ или Берёзку,
  // рублёвая цена становится стоимостью вещи, а витрине — 10 $ для начала.
  const chooseShop = (next: Shop) => {
    const nextDollars = SHOPS.find(item => item.value === next)?.currency === '$'
    if (nextDollars && !dollars) { setRubValue(price); setPrice(10) }
    if (!nextDollars && dollars) setPrice(rubValue)
    setShop(next)
  }

  const changeLevel = (next: number) => {
    setLevel(next)
    if (!budgetTouched) setBudget(statBudgetForLevel(next))
  }

  /** Поля шаблона ровно так, как их хранит сервер. */
  const fields = (): Record<string, unknown> => ({
    name: name.trim(),
    description: description.trim() || null,
    priceBase: int(priceBase, 0, 10_000_000), levelReq: int(level, 0, 30), durabilityMax: int(durability, 1, 10_000),
    weight: Math.min(100, Math.max(0, weight)),
    minDamage: kind === 'WEAPON' ? int(minDamage, 0, 1000) : null,
    maxDamage: kind === 'WEAPON' ? int(maxDamage, 0, 1000) : null,
    weaponAccuracy: kind === 'WEAPON' ? share(accuracy, 0, 100) : null,
    maxRange: kind === 'WEAPON' ? int(range, 1, 20) : null,
    armor: ['ARMOR', 'SHIELD', 'ACCESSORY'].includes(kind) ? int(armor, 0, 500) : null,
    critBonus: share(crit, 0, 100), dodgeBonus: share(dodge, 0, 100), hpBonus: int(hp, 0, 1000),
    statBonuses: Object.fromEntries(Object.entries(gearStats).map(([k, v]) => [k, int(v, -50, 50)]).filter(([, v]) => v)),
    ...Object.fromEntries(CHARMS.map(([key]) => [key, share(charms[key] ?? 0, -200, 200)])),
    ...(wearable ? {
      statBudget: int(budget, 0, 200),
      allocationMode: fixed ? 'FIXED' : 'PLAYER',
      statAllocation: fixed ? Object.fromEntries(stats.map(key => [key, int(alloc[key] ?? 0, 0, 200)])) : null,
    } : {}),
  })

  /** При правке уходят только изменённые поля: откат вернёт ровно их. */
  const changed = (): Record<string, unknown> => {
    if (!initial) return {}
    const next = fields()
    const before = initial as unknown as Record<string, unknown>
    // Пустой объект, ноль и пусто — одно и то же: у старых вещей в базе бывает по-разному.
    const norm = (v: unknown) => (v === 0 || (v && typeof v === 'object' && Object.keys(v).length === 0) ? null : v ?? null)
    const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))
      || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9)
    return Object.fromEntries(Object.entries(next).filter(([key, value]) => {
      if (key === 'statBonuses') return !same(value, Object.fromEntries(Object.entries(initial.statBonuses ?? {}).filter(([, v]) => v)))
      if (key === 'description') return !same(value, before.description || null)
      return !same(value, before[key])
    }))
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        await adminApi.updateItem(initial.code, changed(), reasonText)
        return { code: initial.code }
      }
      const { statAllocation, ...rest } = fields()
      return adminApi.createItem({
        ...rest,
        ...(statAllocation ? { statAllocation } : {}),
        ...(code.trim() ? { code: code.trim() } : {}),
        type: kind,
        weaponType: kind === 'WEAPON' ? weaponType : null,
        armorSlot: kind === 'ARMOR' ? slot : kind === 'ACCESSORY' ? 'ACCESSORY' : null,
        description: description.trim() || undefined,
      }, shop ? { shop, price: int(price, 0, 10_000_000) } : null, reasonText)
    },
    onSuccess: result => { setError(''); onDone(result.code) },
    onError: (err: Error) => setError(err.message),
  })

  const num = (setter: (v: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => setter(toNumber(e.target.value))
  const problem = !name.trim() ? 'Нужно название'
    : kind === 'WEAPON' && minDamage > maxDamage ? 'Урон «от» больше, чем «до»'
      : !editing && shop && price <= 0 ? 'Нужна цена'
        : fixed && wearable && spent > budget ? `Расставлено ${spent} из ${budget} очков`
          : reasonText.length < REASON_MIN ? `Причина — от ${REASON_MIN} символов`
            : editing && Object.keys(changed()).length === 0 ? 'Ничего не изменено'
              : null
  const typeTitle = kind === 'WEAPON' ? WEAPON_TYPES.find(([v]) => v === weaponType)?.[1]
    : kind === 'ARMOR' ? SLOTS.find(([v]) => v === slot)?.[1] : KINDS.find(([v]) => v === kind)?.[1]

  // Карточка «как увидит игрок» — те же числа, что уйдут на сервер.
  const preview: string[] = [
    kind === 'WEAPON' ? `Урон ${minDamage}–${maxDamage} · точность ${accuracy}% · дальность ${range}` : '',
    ['ARMOR', 'SHIELD', 'ACCESSORY'].includes(kind) ? `Броня ${armor}` : '',
    kind === 'CONSUMABLE' && hp ? `Лечит ${hp} HP` : '',
    worn ? GEAR_STATS.filter(([key]) => gearStats[key]).map(([key, label]) => `${label} ${signed(int(gearStats[key], -50, 50))}`).join(', ') : '',
    worn && hp ? `Здоровье +${hp}` : '',
    worn && crit ? `Шанс крита +${crit}%` : '',
    worn && dodge ? `Шанс уворота +${dodge}%` : '',
    worn ? CHARMS.filter(([key]) => charms[key]).map(([key, label]) => `${label} ${signed(charms[key])}%`).join(', ') : '',
    wearable && budget > 0 ? (fixed
      ? `Очки: ${stats.filter(key => alloc[key]).map(key => `${STAT_INFO[key].title} +${alloc[key]}`).join(', ') || 'не расставлены'}`
      : `${budget} очков улучшения — игрок расставит сам`) : '',
  ].filter(Boolean)
  const saleLine = editing
    ? (initial.sales?.length ? initial.sales.map(s => `${shopTitle(s.shop)} — ${money(s.price)} ${s.currency === 'USD' ? '$' : '₽'}${s.isAvailable ? '' : ' (снята)'}`).join('; ') : 'не продаётся')
    : shop ? `${shopInfo.title} — ${money(price)} ${shopInfo.currency}` : 'не продаётся'

  return (
    <div className="adm-card-block adm-item__new">
      <h4>{editing ? `Правка: «${initial.name}»` : mode === 'copy' && initial ? `Новая вещь по образцу «${initial.name}»` : 'Новая вещь'}</h4>
      {mode === 'copy' && <p className="adm-hint">Все поля взяты с образца — поменяйте название и то, что отличается. Образец не меняется.</p>}

      <h5>1. Что это</h5>
      <div className="adm-item__fields">
        <label className="adm-item__wide"><span>Название</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Кожаная кепка" /></label>
        <label><span>Тип</span>
          <select value={kind} disabled={editing} onChange={e => { setKind(e.target.value as Kind); setAlloc({}) }}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        {kind === 'WEAPON' && <label><span>Вид оружия</span>
          <select value={weaponType} disabled={editing} onChange={e => setWeaponType(e.target.value)}>
            {WEAPON_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        {kind === 'ARMOR' && <label><span>Куда надевается</span>
          <select value={slot} disabled={editing} onChange={e => setSlot(e.target.value)}>
            {SLOTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        <label><span>С какого уровня</span>
          <input type="number" min={0} max={30} value={level} onChange={num(changeLevel)} /></label>
        <label className="adm-item__wide"><span>Описание для игрока (можно пусто)</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Видно в карточке вещи" /></label>
      </div>
      {editing && <p className="adm-hint">Тип и слот у готовой вещи не меняются: она может быть надета у игроков. Нужен другой — сделайте копию.</p>}

      <h5>2. {editing ? 'Стоимость' : 'Где продаётся'}</h5>
      {editing
        ? <>
            <p className="adm-hint">Сейчас: {saleLine}. Цена на витрине и снятие с продажи — в «Магазины» и «ЦУМ и Берёзка».</p>
            <div className="adm-item__fields">
              <label><span>Стоимость в рублях</span>
                <input type="number" min={0} value={rubValue} onChange={num(setRubValue)} /></label>
            </div>
            <p className="adm-hint">От неё считаются ремонт и продажа вещи государству.</p>
          </>
        : <>
            <div className="adm-item__shops" role="radiogroup" aria-label="Где продаётся">
              {SHOPS.map(item => (
                <label key={item.value || 'none'} className={'adm-item__shop' + (shop === item.value ? ' is-on' : '')}>
                  <input type="radio" name="item-shop" checked={shop === item.value} onChange={() => chooseShop(item.value)} />
                  <span><b>{item.title}</b><small>{item.hint}</small></span>
                </label>
              ))}
            </div>
            <div className="adm-item__fields">
              {shop && <label><span>Цена в магазине, {shopInfo.currency}</span>
                <input type="number" min={1} value={price} onChange={num(setPrice)} /></label>}
              {(dollars || !shop) && <label><span>Стоимость в рублях</span>
                <input type="number" min={0} value={dollars ? rubValue : price} onChange={num(dollars ? setRubValue : setPrice)} /></label>}
            </div>
            <p className="adm-hint">
              {dollars ? 'Стоимость в рублях — для ремонта и продажи вещи государству; игрок платит долларами.'
                : shop ? 'От этой же цены считаются ремонт и продажа вещи государству.'
                  : 'Стоимость — для ремонта и продажи государству; в магазинах вещи не будет.'}
            </p>
          </>}

      {kind !== 'TOOL' && <>
        <h5>3. Основа вещи</h5>
        {kind === 'WEAPON' && <div className="adm-item__fields">
          <label><span>Урон от</span><input type="number" min={0} value={minDamage} onChange={num(setMinDamage)} /></label>
          <label><span>Урон до</span><input type="number" min={0} value={maxDamage} onChange={num(setMaxDamage)} /></label>
          <label><span>Точность, %</span><input type="number" min={0} max={100} value={accuracy} onChange={num(setAccuracy)} /></label>
          <label><span>Дальность, клеток</span><input type="number" min={1} max={20} value={range} onChange={num(setRange)} /></label>
        </div>}
        {['ARMOR', 'SHIELD', 'ACCESSORY'].includes(kind) && <div className="adm-item__fields">
          <label><span>Броня</span><input type="number" min={0} value={armor} onChange={num(setArmor)} /></label>
        </div>}
        {kind === 'CONSUMABLE' && <div className="adm-item__fields">
          <label><span>Лечит, HP</span><input type="number" min={0} value={hp} onChange={num(setHp)} /></label>
        </div>}
      </>}

      {worn && <>
        <h5>4. Что даёт надевшему</h5>
        <p className="adm-hint">Действует, пока вещь надета. Пусто или 0 — ничего не даёт. Можно и минус: тяжёлая броня отнимает ловкость.</p>
        <div className="adm-item__fields">
          {GEAR_STATS.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min={-50} max={50} value={gearStats[key] ?? 0}
              onChange={e => setGearStats({ ...gearStats, [key]: toNumber(e.target.value) })} /></label>)}
          <label><span>Здоровье, HP</span><input type="number" min={0} value={hp} onChange={num(setHp)} /></label>
          <label><span>Свой шанс крита, %</span><input type="number" min={0} max={100} step="0.5" value={crit} onChange={num(setCrit)} /></label>
          <label><span>Свой шанс уворота, %</span><input type="number" min={0} max={100} step="0.5" value={dodge} onChange={num(setDodge)} /></label>
        </div>
        <p className="adm-hint">Обереги, %. Плюс — оберег у вас; минус — срезает такой же оберег у противника, как в «Апехе».</p>
        <div className="adm-item__fields">
          {CHARMS.map(([key, label, what]) => <label key={key}><span>{label}</span>
            <input type="number" min={-200} max={200} step="0.5" value={charms[key] ?? 0}
              onChange={e => setCharms({ ...charms, [key]: toNumber(e.target.value) })} />
            <small className="adm-item__what">{what}</small></label>)}
        </div>
      </>}

      {wearable && <>
        <h5>5. Очки улучшения</h5>
        <div className="adm-item__fields">
          <label><span>Очков на вещи</span>
            <input type="number" min={0} max={200} value={budget}
              onChange={e => { setBudgetTouched(true); setBudget(toNumber(e.target.value)) }} /></label>
        </div>
        <p className="adm-hint">
          По правилу {level}-му уровню положено {statBudgetForLevel(level)}.
          {budgetTouched && budget !== statBudgetForLevel(level) && <> {' '}
            <button type="button" className="adm-link" onClick={() => { setBudget(statBudgetForLevel(level)); setBudgetTouched(false) }}>вернуть {statBudgetForLevel(level)}</button></>}
          {' '}Обычно ничего трогать не надо: игрок сам расставит очки на Складе.
        </p>
        <label className="adm-item__check">
          <input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)} /> Расставлю очки сам, игроку менять нельзя
        </label>
        {fixed && <>
          <ul className="adm-item__points">
            {stats.map(key => <li key={key}>
              <b>{STAT_INFO[key].title}</b> — одно очко: {STAT_INFO[key].perPoint}
              <input type="number" min={0} max={budget} value={alloc[key] ?? 0} aria-label={`Очков в «${STAT_INFO[key].title}»`}
                onChange={e => setAlloc({ ...alloc, [key]: toNumber(e.target.value) })} />
            </li>)}
          </ul>
          <p className={spent > budget ? 'adm-bad' : 'adm-hint'}>Расставлено {spent} из {budget}</p>
        </>}
      </>}

      <details className="adm-item__more">
        <summary>Дополнительно: прочность, вес{editing ? '' : ', код'}</summary>
        <div className="adm-item__fields">
          <label><span>Прочность (обычно 100)</span><input type="number" min={1} value={durability} onChange={num(setDurability)} /></label>
          <label><span>Вес</span><input type="number" min={0} step="0.1" value={weight} onChange={num(setWeight)} /></label>
          {!editing && <label><span>Код (латиница, можно пусто)</span>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="соберётся сам" /></label>}
        </div>
      </details>

      {name.trim() && (
        <div className="adm-item__preview" aria-label="Как увидит игрок">
          <small>Как увидит игрок</small>
          <b>{name.trim()}</b>
          <span>{typeTitle}, с {level}-го уровня</span>
          {preview.map(line => <span key={line}>{line}</span>)}
          <span className="adm-item__preview-sale">{saleLine}</span>
        </div>
      )}

      <div className="adm-item__save">
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder={reasonText || `Причина, от ${REASON_MIN} символов`} aria-label="Причина" />
        <button type="button" disabled={save.isPending || !!problem} title={problem ?? undefined}
          onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : editing ? 'Сохранить' : 'Создать вещь'}</button>
        {onCancel && <button type="button" className="adm-link" onClick={onCancel}>отмена</button>}
      </div>
      {problem && name.trim() && <p className="adm-hint">{problem}</p>}
      {error && <Note text={error} kind="bad" />}
      <p className="adm-hint">
        {editing
          ? 'Правка сразу видна в игре, в том числе у тех, у кого вещь уже есть. Отменяется из «Журнала → Действия».'
          : <>Вещь появится в игре сразу{shop ? ' и сразу в продаже' : ''}. Отменяется из «Журнала → Действия», пока её никому не продали и не выдали.</>}
      </p>
    </div>
  )
}
