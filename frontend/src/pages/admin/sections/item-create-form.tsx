// =============================================================
// Новая вещь целиком (просьба заказчика 25.10: «по шмоту — буду сам
// добавлять, там сидеть нудно»).
//
// Раньше форма знала только тип, цену, урон и броню: шапку или ботинки
// нельзя было надеть (нет слота), статов не было, а купить вещь было
// негде. Здесь всё, что нужно вещи, чтобы её купили и надели: слот или
// вид оружия, очки статов (по правилу заказчика — подставляются по уровню),
// прибавки к характеристикам персонажа и обереги (правка 26.10: «сила,
// выносливость, фарт, ловкость, меткость, агрессия» и «обереги уворота,
// удачи, крита, ответа — в плюс и в минус»), бонусы и магазин.
// =============================================================
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { adminApi, REASON_MIN } from '../admin-api'
import { Note } from '../../stage3/stage3-ui'

type Kind = 'WEAPON' | 'ARMOR' | 'SHIELD' | 'ACCESSORY' | 'CONSUMABLE' | 'TOOL' | 'MISC'
type StatKey = 'DAMAGE' | 'ACCURACY' | 'CRIT' | 'ARMOR' | 'DURABILITY' | 'ANTI_CRIT'

const KINDS: [Kind, string][] = [
  ['WEAPON', 'Оружие'], ['ARMOR', 'Одежда и броня'], ['SHIELD', 'Щит'], ['ACCESSORY', 'Амулет'],
  ['CONSUMABLE', 'Расходник'], ['TOOL', 'Инструмент'], ['MISC', 'Прочее'],
]
const WEAPON_TYPES: [string, string][] = [
  ['MELEE', 'Рукопашка'], ['KNIFE', 'Нож'], ['CLUB', 'Дубинка'], ['PISTOL', 'Пистолет'], ['SHOTGUN', 'Дробовик'],
  ['SMG', 'Пистолет-пулемёт'], ['RIFLE', 'Автомат'], ['SNIPER', 'Винтовка'], ['HEAVY', 'Тяжёлое'], ['THROWN', 'Метательное'],
]
const SLOTS: [string, string][] = [
  ['HEAD', 'Шапка'], ['CHEST', 'Броня'], ['LEGS', 'Штаны'], ['FEET', 'Обувь'],
  ['GLOVES', 'Перчатки / наручи'], ['BELT', 'Пояс'], ['BACK', 'Плащ'], ['ACCESSORY', 'Амулет'],
]
const SHOPS: [string, string][] = [
  ['', 'Не продавать (только выдача)'], ['GOVERNMENT', 'Госмагазин'], ['kommersant', 'Коммерсант'], ['armory_garage', 'Оружейный гараж'],
]
/** Характеристики персонажа, которые вещь прибавляет, пока надета. */
const GEAR_STATS: [string, string][] = [
  ['str', 'Сила'], ['end', 'Выносливость'], ['luck', 'Фарт'], ['agi', 'Ловкость'], ['acc', 'Меткость'], ['agr', 'Агрессия'],
]
/** Обереги: срезают у противника уворот, удачу, крит и ответку. */
const CHARMS: [string, string][] = [
  ['antiDodge', 'Оберег уворота'], ['antiLuck', 'Оберег удачи'], ['antiCrit', 'Оберег крита'], ['antiCounter', 'Оберег ответа'],
]

const STAT_LABEL: Record<StatKey, string> = {
  DAMAGE: 'Урон', ACCURACY: 'Точность', CRIT: 'Крит', ARMOR: 'Броня', DURABILITY: 'Прочность', ANTI_CRIT: 'Защита от крита',
}
/** Какие статы положены вещи — как на складе при распределении очков. */
const STATS_FOR: Partial<Record<Kind, StatKey[]>> = {
  WEAPON: ['DAMAGE', 'ACCURACY', 'CRIT', 'DURABILITY'],
  ARMOR: ['ARMOR', 'DURABILITY', 'ANTI_CRIT'],
  SHIELD: ['ARMOR', 'DURABILITY', 'ANTI_CRIT'],
  ACCESSORY: ['ARMOR', 'DURABILITY', 'ANTI_CRIT'],
}

/**
 * Очки статов по уровню — правило заказчика из документа: 1-й уровень —
 * 3 стата (+ урон у оружия), 2-й — 4, 3-й — 7, 4-й — 10, «и так далее в
 * пропорции»: с 2-го уровня +3 за уровень.
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
  const [price, setPrice] = useState(500)
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
  const [shop, setShop] = useState('GOVERNMENT')
  const [salePrice, setSalePrice] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const stats = STATS_FOR[kind] ?? []
  const wearable = stats.length > 0
  const spent = stats.reduce((sum, key) => sum + (alloc[key] ?? 0), 0)
  const reasonText = reason.trim() || (name.trim() ? `Новая вещь «${name.trim()}»` : '')

  const changeLevel = (next: number) => {
    setLevel(next)
    // Пока бюджет не правили руками — он следует правилу уровня.
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
      priceBase: price, levelReq: level, durabilityMax: durability, weight,
      minDamage: kind === 'WEAPON' ? minDamage : null,
      maxDamage: kind === 'WEAPON' ? maxDamage : null,
      weaponAccuracy: kind === 'WEAPON' ? accuracy / 100 : null,
      maxRange: kind === 'WEAPON' ? range : null,
      armor: ['ARMOR', 'SHIELD', 'ACCESSORY'].includes(kind) ? armor : null,
      critBonus: crit / 100, dodgeBonus: dodge / 100, hpBonus: hp,
      statBonuses: Object.fromEntries(Object.entries(gearStats).filter(([, v]) => v)),
      ...Object.fromEntries(CHARMS.map(([key]) => [key, (charms[key] ?? 0) / 100])),
      ...(wearable ? {
        statBudget: budget,
        allocationMode: mode,
        ...(mode === 'FIXED' ? { statAllocation: Object.fromEntries(stats.map(key => [key, alloc[key] ?? 0])) } : {}),
      } : {}),
    }, shop ? { shop, price: salePrice ?? price } : null, reasonText),
    onSuccess: result => { setError(''); onDone(result.code) },
    onError: (err: Error) => setError(err.message),
  })

  const num = (setter: (v: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => setter(Number(e.target.value))
  const problem = !name.trim() ? 'Нужно название'
    : kind === 'WEAPON' && minDamage > maxDamage ? 'Урон «от» больше, чем «до»'
      : mode === 'FIXED' && spent > budget ? `Расставлено ${spent} из ${budget} очков`
        : reasonText.length < REASON_MIN ? `Причина — от ${REASON_MIN} символов`
          : null

  return (
    <div className="adm-card-block adm-item__new">
      <h4>Новая вещь</h4>

      <div className="adm-item__fields">
        <label><span>Название</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Кожаная кепка" /></label>
        <label><span>Что это</span>
          <select value={kind} onChange={e => { setKind(e.target.value as Kind); setAlloc({}) }}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        {kind === 'WEAPON' && <label><span>Вид оружия</span>
          <select value={weaponType} onChange={e => setWeaponType(e.target.value)}>
            {WEAPON_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        {kind === 'ARMOR' && <label><span>Куда надевается</span>
          <select value={slot} onChange={e => setSlot(e.target.value)}>
            {SLOTS.filter(([value]) => value !== 'ACCESSORY').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
        <label><span>Уровень</span>
          <input type="number" min={0} max={30} value={level} onChange={num(changeLevel)} /></label>
        <label><span>Цена, ₽</span>
          <input type="number" min={0} value={price} onChange={num(setPrice)} /></label>
        <label><span>Прочность</span>
          <input type="number" min={1} value={durability} onChange={num(setDurability)} /></label>
        <label><span>Вес</span>
          <input type="number" min={0} step="0.1" value={weight} onChange={num(setWeight)} /></label>
      </div>

      {kind === 'WEAPON' && <div className="adm-item__fields">
        <label><span>Урон от</span><input type="number" min={0} value={minDamage} onChange={num(setMinDamage)} /></label>
        <label><span>Урон до</span><input type="number" min={0} value={maxDamage} onChange={num(setMaxDamage)} /></label>
        <label><span>Точность, %</span><input type="number" min={0} max={100} value={accuracy} onChange={num(setAccuracy)} /></label>
        <label><span>Дальность, клеток</span><input type="number" min={1} max={20} value={range} onChange={num(setRange)} /></label>
      </div>}
      {['ARMOR', 'SHIELD', 'ACCESSORY'].includes(kind) && <div className="adm-item__fields">
        <label><span>Броня</span><input type="number" min={0} value={armor} onChange={num(setArmor)} /></label>
      </div>}

      {kind !== 'CONSUMABLE' && kind !== 'TOOL' && <>
        <h5>Характеристики персонажа, пока вещь надета</h5>
        <div className="adm-item__fields">
          {GEAR_STATS.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min={-50} max={50} value={gearStats[key] ?? 0}
              onChange={e => setGearStats({ ...gearStats, [key]: Number(e.target.value) })} /></label>)}
        </div>

        <h5>Обереги, % (можно в минус)</h5>
        <div className="adm-item__fields">
          {CHARMS.map(([key, label]) => <label key={key}><span>{label}</span>
            <input type="number" min={-200} max={200} step="0.5" value={charms[key] ?? 0}
              onChange={e => setCharms({ ...charms, [key]: Number(e.target.value) })} /></label>)}
        </div>
      </>}

      <h5>Бонусы</h5>
      <div className="adm-item__fields">
        <label><span>Крит, %</span><input type="number" min={0} max={100} step="0.5" value={crit} onChange={num(setCrit)} /></label>
        <label><span>Уворот, %</span><input type="number" min={0} max={100} step="0.5" value={dodge} onChange={num(setDodge)} /></label>
        <label><span>{kind === 'CONSUMABLE' ? 'Лечит HP' : 'Здоровье, HP'}</span><input type="number" min={0} value={hp} onChange={num(setHp)} /></label>
      </div>

      {wearable && <>
        <h5>Очки статов</h5>
        <div className="adm-item__fields">
          <label><span>Очков</span>
            <input type="number" min={0} max={200} value={budget}
              onChange={e => { setBudgetTouched(true); setBudget(Number(e.target.value)) }} /></label>
          <label><span>Кто распределяет</span>
            <select value={mode} onChange={e => setMode(e.target.value as 'PLAYER' | 'FIXED')}>
              <option value="PLAYER">Игрок сам, на складе</option>
              <option value="FIXED">Задать сейчас</option>
            </select></label>
        </div>
        <p className="adm-hint">
          По правилу уровня: {level}-й уровень — {statBudgetForLevel(level)} очков{kind === 'WEAPON' ? ' + урон оружия' : ''}.
          {budgetTouched && budget !== statBudgetForLevel(level) && <> {' '}
            <button type="button" className="adm-link" onClick={() => { setBudget(statBudgetForLevel(level)); setBudgetTouched(false) }}>вернуть {statBudgetForLevel(level)}</button></>}
        </p>
        {mode === 'FIXED' && <div className="adm-item__fields">
          {stats.map(key => <label key={key}><span>{STAT_LABEL[key]}</span>
            <input type="number" min={0} max={budget} value={alloc[key] ?? 0}
              onChange={e => setAlloc({ ...alloc, [key]: Number(e.target.value) })} /></label>)}
          <p className={spent > budget ? 'adm-bad' : 'adm-hint'}>Расставлено {spent} из {budget}</p>
        </div>}
      </>}

      <h5>Где продаётся</h5>
      <div className="adm-item__fields">
        <label><span>Магазин</span>
          <select value={shop} onChange={e => setShop(e.target.value)}>
            {SHOPS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        {shop && <label><span>Цена в магазине, ₽</span>
          <input type="number" min={0} value={salePrice ?? price} onChange={e => setSalePrice(Number(e.target.value))} /></label>}
      </div>

      <details className="adm-item__more">
        <summary>Дополнительно</summary>
        <div className="adm-item__fields">
          <label><span>Описание</span>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Видна игроку в карточке" /></label>
          <label><span>Код (латиница, можно пусто)</span>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="соберётся сам" /></label>
        </div>
      </details>

      <div className="adm-item__save">
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder={reasonText || `Причина, от ${REASON_MIN} символов`} aria-label="Причина создания" />
        <button type="button" disabled={create.isPending || !!problem} title={problem ?? undefined}
          onClick={() => create.mutate()}>{create.isPending ? 'Создаём…' : 'Создать'}</button>
      </div>
      {problem && name.trim() && <p className="adm-hint">{problem}</p>}
      {error && <Note text={error} kind="bad" />}
      <p className="adm-hint">
        Вещь появится в игре сразу{shop ? ' и сразу в продаже' : ''}. Отменяется из журнала, пока её никому не продали и не выдали.
      </p>
    </div>
  )
}
