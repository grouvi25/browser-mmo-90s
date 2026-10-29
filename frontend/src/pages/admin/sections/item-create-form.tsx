// =============================================================
// Новая вещь (просьба заказчика 25.10: «по шмоту — буду сам добавлять»;
// переделка 30.10: «не понятно, как добавлять в общий, в Берёзку, в ЦУМ и
// как статы распределять — много дублируются поля»).
//
// Форма идёт шагами, как думает человек, который заводит вещь:
//   1. что это и какого уровня;
//   2. где продаётся и почём — госмагазин, ЦУМ, Берёзка, лавки или нигде;
//   3. основа вещи: урон и точность у оружия, броня у одежды;
//   4. что вещь даёт надевшему: характеристики, шансы, здоровье, обереги;
//   5. очки улучшения — усиливают основу (их вкладывает игрок или вы).
// Каждое число встречается один раз, у каждого — подсказка, что оно делает.
// =============================================================
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { adminApi, REASON_MIN } from '../admin-api'
import { Note } from '../../stage3/stage3-ui'

type Kind = 'WEAPON' | 'ARMOR' | 'SHIELD' | 'ACCESSORY' | 'CONSUMABLE' | 'TOOL'
type StatKey = 'DAMAGE' | 'ACCURACY' | 'CRIT' | 'ARMOR' | 'DURABILITY' | 'ANTI_CRIT'
type Shop = '' | 'GOVERNMENT' | 'TSUM' | 'BEREZKA' | 'kommersant' | 'armory_garage'

const KINDS: [Kind, string][] = [
  ['WEAPON', 'Оружие'], ['ARMOR', 'Одежда и броня'], ['SHIELD', 'Щит'], ['ACCESSORY', 'Амулет'],
  ['CONSUMABLE', 'Расходник (аптечка и т. п.)'], ['TOOL', 'Инструмент'],
]
const WEAPON_TYPES: [string, string][] = [
  ['MELEE', 'Рукопашка'], ['KNIFE', 'Нож'], ['CLUB', 'Дубинка'], ['PISTOL', 'Пистолет'], ['SHOTGUN', 'Дробовик'],
  ['SMG', 'Пистолет-пулемёт'], ['RIFLE', 'Автомат'], ['SNIPER', 'Винтовка'], ['HEAVY', 'Тяжёлое'], ['THROWN', 'Метательное'],
]
const SLOTS: [string, string][] = [
  ['HEAD', 'Голова (шапка)'], ['CHEST', 'Тело (куртка, броня)'], ['LEGS', 'Штаны'], ['FEET', 'Обувь'],
  ['GLOVES', 'Руки (перчатки, наручи)'], ['BELT', 'Пояс'], ['BACK', 'Плащ'],
]
/** Где продаётся: валюта у каждого своя — её и подписываем у цены. */
const SHOPS: { value: Shop; title: string; hint: string; currency: '₽' | '$' | null }[] = [
  { value: 'GOVERNMENT', title: 'Госмагазин', hint: 'общий магазин за рубли', currency: '₽' },
  { value: 'TSUM', title: 'ЦУМ', hint: 'именные и донатные вещи за доллары', currency: '$' },
  { value: 'BEREZKA', title: 'Берёзка', hint: 'артефакты за доллары', currency: '$' },
  { value: 'kommersant', title: 'Коммерсант', hint: 'частная лавка на рынке, за рубли', currency: '₽' },
  { value: 'armory_garage', title: 'Оружейный гараж', hint: 'частная лавка в Гаражах, за рубли', currency: '₽' },
  { value: '', title: 'Не продаётся', hint: 'только выдача из админки или награда', currency: null },
]
/** Прибавки надевшему: характеристики персонажа. */
const GEAR_STATS: [string, string][] = [
  ['str', 'Сила'], ['end', 'Выносливость'], ['luck', 'Фарт'], ['agi', 'Ловкость'], ['acc', 'Меткость'], ['agr', 'Агрессия'],
]
/** Обереги: свой плюс или минус противнику. */
const CHARMS: [string, string][] = [
  ['antiDodge', 'Оберег уворота'], ['antiLuck', 'Оберег удачи'], ['antiCrit', 'Оберег крита'], ['antiCounter', 'Оберег ответа'],
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

/**
 * Очки по уровню — правило заказчика: 1-й уровень — 3, 2-й — 4, 3-й — 7,
 * 4-й — 10, дальше +3 за уровень.
 */
function statBudgetForLevel(level: number): number {
  return level <= 1 ? 3 : 3 * level - 2
}

export function ItemCreateForm({ onDone }: { onDone: (code: string) => void }) {
  const [kind, setKind] = useState<Kind>('ARMOR')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [weaponType, setWeaponType] = useState('KNIFE')
  const [slot, setSlot] = useState('HEAD')
  const [level, setLevel] = useState(1)
  const [shop, setShop] = useState<Shop>('GOVERNMENT')
  const [price, setPrice] = useState(500)
  const [rubValue, setRubValue] = useState(500)
  const [durability, setDurability] = useState(100)
  const [weight, setWeight] = useState(1)
  const [minDamage, setMinDamage] = useState(4)
  const [maxDamage, setMaxDamage] = useState(8)
  const [accuracy, setAccuracy] = useState(75)
  const [range, setRange] = useState(1)
  const [armor, setArmor] = useState(3)
  const [crit, setCrit] = useState(0)
  const [dodge, setDodge] = useState(0)
  const [hp, setHp] = useState(0)
  const [gearStats, setGearStats] = useState<Record<string, number>>({})
  const [charms, setCharms] = useState<Record<string, number>>({})
  const [budget, setBudget] = useState(statBudgetForLevel(1))
  const [budgetTouched, setBudgetTouched] = useState(false)
  const [mode, setMode] = useState<'PLAYER' | 'FIXED'>('PLAYER')
  const [alloc, setAlloc] = useState<Partial<Record<StatKey, number>>>({})
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const stats = STATS_FOR[kind] ?? []
  const wearable = stats.length > 0
  const worn = kind !== 'CONSUMABLE' && kind !== 'TOOL'
  const spent = stats.reduce((sum, key) => sum + (alloc[key] ?? 0), 0)
  const shopInfo = SHOPS.find(item => item.value === shop)!
  const dollars = shopInfo.currency === '$'
  // Рублёвая стоимость вещи нужна всегда: от неё считаются ремонт и продажа
  // государству. В рублёвом магазине это и есть цена на витрине.
  const priceBase = dollars ? rubValue : price
  const reasonText = reason.trim() || (name.trim() ? `Новая вещь «${name.trim()}»` : '')

  const changeLevel = (next: number) => {
    setLevel(next)
    if (!budgetTouched) setBudget(statBudgetForLevel(next))
  }

  const create = useMutation({
    mutationFn: () => adminApi.createItem({
      ...(code.trim() ? { code: code.trim() } : {}),
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      type: kind,
      weaponType: kind === 'WEAPON' ? weaponType : null,
      armorSlot: kind === 'ARMOR' ? slot : kind === 'ACCESSORY' ? 'ACCESSORY' : null,
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
        allocationMode: mode,
        ...(mode === 'FIXED' ? { statAllocation: Object.fromEntries(stats.map(key => [key, int(alloc[key] ?? 0, 0, 200)])) } : {}),
      } : {}),
    }, shop ? { shop, price: int(price, 0, 10_000_000) } : null, reasonText),
    onSuccess: result => { setError(''); onDone(result.code) },
    onError: (err: Error) => setError(err.message),
  })

  const num = (setter: (v: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => setter(toNumber(e.target.value))
  const problem = !name.trim() ? 'Нужно название'
    : kind === 'WEAPON' && minDamage > maxDamage ? 'Урон «от» больше, чем «до»'
      : shop && price <= 0 ? 'Нужна цена'
        : mode === 'FIXED' && wearable && spent > budget ? `Расставлено ${spent} из ${budget} очков`
          : reasonText.length < REASON_MIN ? `Причина — от ${REASON_MIN} символов`
            : null
  const typeTitle = kind === 'WEAPON' ? WEAPON_TYPES.find(([v]) => v === weaponType)?.[1]
    : kind === 'ARMOR' ? SLOTS.find(([v]) => v === slot)?.[1] : KINDS.find(([v]) => v === kind)?.[1]

  return (
    <div className="adm-card-block adm-item__new">
      <h4>Новая вещь</h4>

      <h5>1. Что это</h5>
      <div className="adm-item__fields">
        <label className="adm-item__wide"><span>Название</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Кожаная кепка" /></label>
        <label><span>Тип</span>
          <select value={kind} onChange={e => { setKind(e.target.value as Kind); setAlloc({}) }}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        {kind === 'WEAPON' && <label><span>Вид оружия</span>
          <select value={weaponType} onChange={e => setWeaponType(e.target.value)}>
            {WEAPON_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        {kind === 'ARMOR' && <label><span>Куда надевается</span>
          <select value={slot} onChange={e => setSlot(e.target.value)}>
            {SLOTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        <label><span>С какого уровня</span>
          <input type="number" min={0} max={30} value={level} onChange={num(changeLevel)} /></label>
        <label className="adm-item__wide"><span>Описание для игрока (можно пусто)</span>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Видно в карточке вещи" /></label>
      </div>

      <h5>2. Где продаётся</h5>
      <div className="adm-item__shops" role="radiogroup" aria-label="Где продаётся">
        {SHOPS.map(item => (
          <label key={item.value || 'none'} className={'adm-item__shop' + (shop === item.value ? ' is-on' : '')}>
            <input type="radio" name="item-shop" checked={shop === item.value} onChange={() => setShop(item.value)} />
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
        <p className="adm-hint">Прибавки действуют, пока вещь надета. Можно и минус — например, тяжёлая броня отнимает ловкость.</p>
        <div className="adm-item__fields">
          {GEAR_STATS.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min={-50} max={50} value={gearStats[key] ?? 0}
              onChange={e => setGearStats({ ...gearStats, [key]: toNumber(e.target.value) })} /></label>)}
          <label><span>Здоровье, HP</span><input type="number" min={0} value={hp} onChange={num(setHp)} /></label>
          <label><span>Шанс крита, %</span><input type="number" min={0} max={100} step="0.5" value={crit} onChange={num(setCrit)} /></label>
          <label><span>Шанс уворота, %</span><input type="number" min={0} max={100} step="0.5" value={dodge} onChange={num(setDodge)} /></label>
        </div>
        <p className="adm-hint">Обереги, %: плюс — свой оберег; минус — срезает такой же оберег у противника, как в «Апехе».</p>
        <div className="adm-item__fields">
          {CHARMS.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min={-200} max={200} step="0.5" value={charms[key] ?? 0}
              onChange={e => setCharms({ ...charms, [key]: toNumber(e.target.value) })} /></label>)}
        </div>
      </>}

      {wearable && <>
        <h5>5. Очки улучшения</h5>
        <p className="adm-hint">
          Очки усиливают основу вещи из шага 3. По правилу уровня {level}-му уровню положено {statBudgetForLevel(level)}.
          {budgetTouched && budget !== statBudgetForLevel(level) && <> {' '}
            <button type="button" className="adm-link" onClick={() => { setBudget(statBudgetForLevel(level)); setBudgetTouched(false) }}>вернуть {statBudgetForLevel(level)}</button></>}
        </p>
        <div className="adm-item__fields">
          <label><span>Сколько очков</span>
            <input type="number" min={0} max={200} value={budget}
              onChange={e => { setBudgetTouched(true); setBudget(toNumber(e.target.value)) }} /></label>
          <label className="adm-item__wide"><span>Кто расставляет</span>
            <select value={mode} onChange={e => setMode(e.target.value as 'PLAYER' | 'FIXED')}>
              <option value="PLAYER">Игрок сам, на Складе (как у именных вещей)</option>
              <option value="FIXED">Я расставлю сейчас</option>
            </select></label>
        </div>
        <ul className="adm-item__points">
          {stats.map(key => <li key={key}>
            <b>{STAT_INFO[key].title}</b> — одно очко: {STAT_INFO[key].perPoint}
            {mode === 'FIXED' && <input type="number" min={0} max={budget} value={alloc[key] ?? 0} aria-label={`Очков в «${STAT_INFO[key].title}»`}
              onChange={e => setAlloc({ ...alloc, [key]: toNumber(e.target.value) })} />}
          </li>)}
        </ul>
        {mode === 'FIXED' && <p className={spent > budget ? 'adm-bad' : 'adm-hint'}>Расставлено {spent} из {budget}</p>}
      </>}

      <details className="adm-item__more">
        <summary>Дополнительно: прочность, вес, код</summary>
        <div className="adm-item__fields">
          <label><span>Прочность (обычно 100)</span><input type="number" min={1} value={durability} onChange={num(setDurability)} /></label>
          <label><span>Вес</span><input type="number" min={0} step="0.1" value={weight} onChange={num(setWeight)} /></label>
          <label><span>Код (латиница, можно пусто)</span>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="соберётся сам" /></label>
        </div>
      </details>

      {name.trim() && <p className="adm-item__summary">
        Будет: <b>«{name.trim()}»</b> — {typeTitle?.toLowerCase()}, с {level}-го уровня,{' '}
        {shop ? <>продаётся: {shopInfo.title}, {price.toLocaleString('ru-RU')} {shopInfo.currency}</> : 'не продаётся'}.
      </p>}

      <div className="adm-item__save">
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder={reasonText || `Причина, от ${REASON_MIN} символов`} aria-label="Причина создания" />
        <button type="button" disabled={create.isPending || !!problem} title={problem ?? undefined}
          onClick={() => create.mutate()}>{create.isPending ? 'Создаём…' : 'Создать вещь'}</button>
      </div>
      {problem && name.trim() && <p className="adm-hint">{problem}</p>}
      {error && <Note text={error} kind="bad" />}
      <p className="adm-hint">
        Вещь появится в игре сразу{shop ? ' и сразу в продаже' : ''}. Отменяется из «Журнала → Действия», пока её никому не продали и не выдали.
      </p>
    </div>
  )
}
