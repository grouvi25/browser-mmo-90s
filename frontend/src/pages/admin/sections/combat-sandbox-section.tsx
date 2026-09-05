// =============================================================
// Песочница боя.
//
// «Что будет, если поднять силу на пять» — вопрос, на который раньше
// отвечал только прогон скрипта из командной строки. Здесь ответ сразу:
// слева два бойца, справа разложенные шансы и результат серии дуэлей.
//
// Считает сервер настоящими функциями боя. Показываем не только «кто
// победил», но и почему: шанс попадания, уворот, блок, крит и множитель
// владения оружием у каждой стороны — против этого конкретного противника.
//
// Оружие и броню можно взять из справочника предметов игры, а не
// придумывать числа: рядом с полями стоит выбор из того, что реально
// лежит в базе.
// =============================================================
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Swords } from 'lucide-react'
import { adminApi, REASON_MIN, type CombatResult, type CombatSide, type Fighter, type ItemTemplateRow } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/** Двое равных: отличия задаёт уже сам администратор. */
const BASE: Fighter = {
  name: 'Боец А',
  str: 10, agi: 10, rea: 10, acc: 10, end: 10, luck: 5, agr: 5,
  battleLevel: 10, weaponSkill: 10, antiSkill: 0,
  minDamage: 40, maxDamage: 80, weaponAccuracy: 0.75,
  armor: 20, equipmentWeight: 6,
}

const STAT_FIELDS: { key: keyof Fighter; label: string; hint: string }[] = [
  { key: 'str', label: 'STR', hint: 'сила: прибавка к урону' },
  { key: 'agi', label: 'AGI', hint: 'ловкость: уворот и инициатива' },
  { key: 'rea', label: 'REA', hint: 'реакция: первый ход, блок, ответка' },
  { key: 'acc', label: 'ACC', hint: 'точность: шанс попадания' },
  { key: 'end', label: 'END', hint: 'выносливость: здоровье и снижение урона' },
  { key: 'luck', label: 'LUCK', hint: 'удача: попадание и пробитие блока' },
  { key: 'agr', label: 'AGR', hint: 'агрессия: шанс крита' },
  { key: 'battleLevel', label: 'Уровень', hint: 'боевой уровень: запас здоровья' },
  { key: 'weaponSkill', label: 'Владение', hint: 'уровень владения оружием' },
  { key: 'antiSkill', label: 'Антимастерство', hint: 'контр-навык против оружия противника' },
]

const GEAR_FIELDS: { key: keyof Fighter; label: string; step?: number }[] = [
  { key: 'minDamage', label: 'Урон от' },
  { key: 'maxDamage', label: 'Урон до' },
  { key: 'weaponAccuracy', label: 'Точность оружия', step: 0.05 },
  { key: 'armor', label: 'Броня' },
  { key: 'equipmentWeight', label: 'Вес снаряжения' },
]

export function CombatSandboxSection() {
  const [a, setA] = useState<Fighter>({ ...BASE, name: 'Боец А' })
  const [b, setB] = useState<Fighter>({ ...BASE, name: 'Боец Б' })
  const [duels, setDuels] = useState(500)

  const items = useQuery({ queryKey: ['admin', 'items'], queryFn: adminApi.sandboxItems })
  const weapons = useMemo(
    () => (items.data?.items ?? []).filter(item => item.type === 'WEAPON' && item.minDamage != null),
    [items.data])
  const armors = useMemo(
    () => (items.data?.items ?? []).filter(item => item.type === 'ARMOR' && (item.armor ?? 0) > 0),
    [items.data])

  const run = useMutation({
    mutationFn: () => adminApi.simulateCombat({ a, b, duels, seed: 90210 }),
  })

  return (
    <>
      <p className="s4-lead">
        Два бойца, настоящие формулы боя. Показаны и шансы каждой стороны, и итог
        серии дуэлей: видно не только кто побеждает, но и за счёт чего. Прогон
        детерминирован — один и тот же ввод даёт один и тот же результат, поэтому
        две прикидки можно честно сравнивать.
      </p>

      <div className="adm-duel">
        <FighterForm side="A" value={a} onChange={setA} weapons={weapons} armors={armors} />
        <FighterForm side="Б" value={b} onChange={setB} weapons={weapons} armors={armors} />
      </div>

      <div className="adm-duel__run">
        <label>
          Дуэлей
          <input
            type="number" min={10} max={5000} step={10}
            value={duels}
            onChange={event => setDuels(Number(event.target.value) || 10)}
          />
        </label>
        <button type="button" onClick={() => run.mutate()} disabled={run.isPending}>
          <Swords size={13} /> {run.isPending ? 'Считаю…' : 'Прогнать бой'}
        </button>
        {run.isError && <span className="adm-bad">Не удалось посчитать: проверьте значения.</span>}
      </div>

      {run.data && <Result result={run.data} />}
    </>
  )
}

function Result({ result }: { result: CombatResult }) {
  const leader = result.a.winShare >= result.b.winShare ? result.a : result.b
  const gap = Math.abs(result.a.winShare - result.b.winShare)

  return (
    <>
      <p className={gap > 0.4 ? 'adm-verdict adm-verdict--bad' : 'adm-verdict adm-verdict--ok'}>
        {gap > 0.4
          ? `Перекос: «${leader.name}» берёт ${pct(leader.winShare)} боёв. Разрыв больше 40% — сторона выигрывает не тактикой, а числами.`
          : `Силы сопоставимы: «${leader.name}» впереди с ${pct(leader.winShare)}.`}
        {' '}Бой длится в среднем {result.averageRounds.toFixed(1)} раунда.
      </p>

      <div className="adm-duel__result">
        <SideResult side={result.a} />
        <SideResult side={result.b} />
      </div>
    </>
  )
}

function SideResult({ side }: { side: CombatSide }) {
  return (
    <div className="adm-card-block">
      <h4>{side.name}</h4>
      <table className="adm-table">
        <tbody>
          <tr><td>Побед</td><td className="num">{side.wins} ({pct(side.winShare)})</td></tr>
          <tr><td>Здоровье</td><td className="num">{side.hp}</td></tr>
          <tr>
            <td>Инициатива</td>
            {/* Без случайного слагаемого: в бою к ней добавляется разброс,
                и показывать одно из его значений значило бы врать. */}
            <td className="num">{side.odds.initiative} ±{side.odds.initiativeSpread}</td>
          </tr>
          <tr><td>Шанс попасть</td><td className="num">{pct(side.odds.hit)}</td></tr>
          <tr><td>Противник увернётся</td><td className="num">{pct(side.odds.dodge)}</td></tr>
          <tr><td>Противник заблокирует</td><td className="num">{pct(side.odds.block)}</td></tr>
          <tr><td>Шанс крита</td><td className="num">{pct(side.odds.crit)}</td></tr>
          <tr>
            <td>Эффективное владение</td>
            <td className="num">{side.odds.effectiveSkill} (×{side.odds.skillMultiplier.toFixed(2)})</td>
          </tr>
          <tr><td>Ударов дошло</td><td className="num">{pct(side.landedShare)}</td></tr>
          <tr><td>Урон за размах</td><td className="num">{side.averageDamagePerSwing.toFixed(1)}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function FighterForm({
  side, value, onChange, weapons, armors,
}: {
  side: string
  value: Fighter
  onChange: (next: Fighter) => void
  weapons: ItemTemplateRow[]
  armors: ItemTemplateRow[]
}) {
  const set = (key: keyof Fighter) => (raw: string) =>
    onChange({ ...value, [key]: key === 'name' ? raw : Number(raw) })

  return (
    <div className="adm-card-block">
      <h4>Боец {side}</h4>

      {/* Оружие и броня из справочника: числа берутся из базы, а не
          придумываются — иначе песочница проверяет не игру, а фантазию. */}
      <div className="adm-duel__gear">
        <label>
          Оружие
          <select
            onChange={event => {
              const item = weapons.find(weapon => weapon.code === event.target.value)
              if (!item) return
              onChange({
                ...value,
                minDamage: item.minDamage ?? value.minDamage,
                maxDamage: item.maxDamage ?? value.maxDamage,
                weaponAccuracy: item.weaponAccuracy ?? value.weaponAccuracy,
              })
            }}
            defaultValue=""
          >
            <option value="" disabled>— из справочника —</option>
            {weapons.map(item => (
              <option key={item.code} value={item.code}>
                {item.name} ({item.minDamage}–{item.maxDamage})
              </option>
            ))}
          </select>
        </label>
        <label>
          Броня
          <select
            onChange={event => {
              const item = armors.find(armor => armor.code === event.target.value)
              if (!item) return
              onChange({ ...value, armor: item.armor ?? value.armor })
            }}
            defaultValue=""
          >
            <option value="" disabled>— из справочника —</option>
            {armors.map(item => (
              <option key={item.code} value={item.code}>{item.name} ({item.armor})</option>
            ))}
          </select>
        </label>
      </div>

      <div className="adm-duel__stats">
        {STAT_FIELDS.map(field => (
          <label key={field.key} title={field.hint}>
            <span>{field.label}</span>
            <input
              type="number" min={0} max={30}
              value={String(value[field.key])}
              onChange={event => set(field.key)(event.target.value)}
            />
          </label>
        ))}
        {GEAR_FIELDS.map(field => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              type="number" min={0} step={field.step ?? 1}
              value={String(value[field.key])}
              onChange={event => set(field.key)(event.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * Предметы игры: справочник и правка.
 *
 * Цены и характеристики правятся прямо здесь — с причиной и через журнал,
 * как всякое админское действие. Смотреть на таблицу и не мочь поменять
 * цену, ради которой в неё и заглянули, — ровно то, чего в панели быть
 * не должно.
 */
export function ItemsSection({ role }: { role?: string | null }) {
  const qc = useQueryClient()
  const items = useQuery({ queryKey: ['admin', 'items'], queryFn: adminApi.sandboxItems })
  const [type, setType] = useState<string>('WEAPON')
  const [adding, setAdding] = useState(false)
  const canEdit = role === 'SUPER_ADMIN'

  if (items.isLoading) return <Skeleton rows={4} />
  if (items.isError) return <Fault retry={() => items.refetch()} />

  const all = items.data?.items ?? []
  const types = [...new Set(all.map(item => item.type))]
  const shown = all.filter(item => item.type === type)

  return (
    <>
      <p className="s4-lead">
        {all.length} вещей — оружие, броня, расходники и инструменты, то, что
        реально лежит в базе, а не в сиде. Материалы и сырьё сюда не входят: они
        на вкладке «Ресурсы и материалы».{' '}
        {canEdit
          ? 'Цену и характеристики можно поправить прямо в строке, а новый предмет завести кнопкой рядом.'
          : 'Править может только SUPER_ADMIN.'}
      </p>

      <div className="adm-items__head">
        <div className="s3-tabs">
          {types.map(kind => (
            <button key={kind} type="button" className={kind === type ? 'active' : ''} onClick={() => setType(kind)}>
              {kind} ({all.filter(item => item.type === kind).length})
            </button>
          ))}
        </div>
        {canEdit && (
          <button type="button" className="adm-link" onClick={() => setAdding(!adding)}>
            <Plus size={12} /> {adding ? 'скрыть форму' : 'Добавить предмет'}
          </button>
        )}
      </div>

      {adding && (
        <NewItemForm onDone={() => {
          setAdding(false)
          void qc.invalidateQueries({ queryKey: ['admin', 'items'] })
        }} />
      )}

      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Название</th><th>Код</th><th>Ур.</th><th>Цена</th>
              <th>Урон</th><th>Точность</th><th>Броня</th><th>Прочность</th><th>Вес</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(item => (
              <ItemRow key={item.code} item={item} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Числовые поля, которые имеет смысл править из панели. */
const EDITABLE: { key: keyof ItemTemplateRow; label: string; step?: number }[] = [
  { key: 'priceBase', label: 'Цена' },
  { key: 'levelReq', label: 'Уровень' },
  { key: 'minDamage', label: 'Урон от' },
  { key: 'maxDamage', label: 'Урон до' },
  { key: 'weaponAccuracy', label: 'Точность', step: 0.01 },
  { key: 'armor', label: 'Броня' },
  { key: 'durabilityMax', label: 'Прочность' },
  { key: 'weight', label: 'Вес', step: 0.1 },
]

function ItemRow({ item, canEdit }: { item: ItemTemplateRow; canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => {
      // Отправляем только изменённое: обратная операция пишется по этим же
      // полям, и лишние затёрли бы чужую правку соседнего поля.
      const fields: Record<string, number> = {}
      for (const field of EDITABLE) {
        const raw = draft[field.key as string]
        if (raw === undefined || raw === '') continue
        const next = Number(raw)
        if (next !== item[field.key]) fields[field.key as string] = next
      }
      return adminApi.updateItem(item.code, fields, reason.trim())
    },
    onSuccess: () => {
      setEditing(false); setReason(''); setError(''); setDraft({})
      void qc.invalidateQueries({ queryKey: ['admin', 'items'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  if (editing) {
    return (
      <tr className="adm-item is-editing">
        <td colSpan={10}>
          <div className="adm-item__edit">
            <b>{item.name}</b> <code>{item.code}</code>
            <div className="adm-item__fields">
              {EDITABLE.map(field => (
                <label key={field.key as string}>
                  <span>{field.label}</span>
                  <input
                    type="number" step={field.step ?? 1}
                    defaultValue={item[field.key] === null ? '' : String(item[field.key])}
                    onChange={event => setDraft({ ...draft, [field.key as string]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="adm-item__save">
              <input
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder={`Причина, от ${REASON_MIN} символов`}
                aria-label="Причина правки предмета"
              />
              <button type="button" disabled={save.isPending || reason.trim().length < REASON_MIN}
                onClick={() => save.mutate()}>Сохранить</button>
              <button type="button" className="adm-link"
                onClick={() => { setEditing(false); setError('') }}>отмена</button>
            </div>
            {error && <Note text={error} kind="bad" />}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{item.name}</td>
      <td><code>{item.code}</code></td>
      <td className="num">{item.levelReq ?? '—'}</td>
      <td className="num">{item.priceBase?.toLocaleString('ru-RU') ?? '—'}</td>
      <td className="num">{item.minDamage != null ? `${item.minDamage}–${item.maxDamage}` : '—'}</td>
      <td className="num">{item.weaponAccuracy ?? '—'}</td>
      <td className="num">{item.armor ?? '—'}</td>
      <td className="num">{item.durabilityMax ?? '—'}</td>
      <td className="num">{item.weight ?? '—'}</td>
      {canEdit && (
        <td>
          <button type="button" className="adm-link" onClick={() => setEditing(true)}>править</button>
        </td>
      )}
    </tr>
  )
}

/** Новый предмет. Код и тип задаются один раз и потом не меняются. */
function NewItemForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    code: '', name: '', type: 'WEAPON',
    priceBase: 500, levelReq: 1, durabilityMax: 100, weight: 1,
    minDamage: 10, maxDamage: 20, weaponAccuracy: 0.75, armor: 0,
  })
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: () => adminApi.createItem({
      ...form,
      // Оружейные поля осмысленны только у оружия, броня — у брони:
      // пустое значение у остальных типов честнее нуля.
      minDamage: form.type === 'WEAPON' ? form.minDamage : null,
      maxDamage: form.type === 'WEAPON' ? form.maxDamage : null,
      weaponAccuracy: form.type === 'WEAPON' ? form.weaponAccuracy : null,
      armor: form.type === 'ARMOR' ? form.armor : null,
    }, reason.trim()),
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  })

  const set = (key: string) => (value: string) =>
    setForm({ ...form, [key]: ['code', 'name', 'type'].includes(key) ? value : Number(value) })

  return (
    <div className="adm-card-block adm-item__new">
      <h4>Новый предмет</h4>
      <div className="adm-item__fields">
        <label><span>Код (латиница)</span>
          <input value={form.code} onChange={e => set('code')(e.target.value)} placeholder="weapon_bat_new" /></label>
        <label><span>Название</span>
          <input value={form.name} onChange={e => set('name')(e.target.value)} placeholder="Бита" /></label>
        <label><span>Тип</span>
          <select value={form.type} onChange={e => set('type')(e.target.value)}>
            {['WEAPON', 'ARMOR', 'CONSUMABLE', 'TOOL', 'MISC'].map(kind => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select></label>
        <label><span>Цена</span>
          <input type="number" value={form.priceBase} onChange={e => set('priceBase')(e.target.value)} /></label>
        <label><span>Уровень</span>
          <input type="number" value={form.levelReq} onChange={e => set('levelReq')(e.target.value)} /></label>
        <label><span>Прочность</span>
          <input type="number" value={form.durabilityMax} onChange={e => set('durabilityMax')(e.target.value)} /></label>
        <label><span>Вес</span>
          <input type="number" step="0.1" value={form.weight} onChange={e => set('weight')(e.target.value)} /></label>
        {form.type === 'WEAPON' && (
          <>
            <label><span>Урон от</span>
              <input type="number" value={form.minDamage} onChange={e => set('minDamage')(e.target.value)} /></label>
            <label><span>Урон до</span>
              <input type="number" value={form.maxDamage} onChange={e => set('maxDamage')(e.target.value)} /></label>
            <label><span>Точность</span>
              <input type="number" step="0.01" value={form.weaponAccuracy} onChange={e => set('weaponAccuracy')(e.target.value)} /></label>
          </>
        )}
        {form.type === 'ARMOR' && (
          <label><span>Броня</span>
            <input type="number" value={form.armor} onChange={e => set('armor')(e.target.value)} /></label>
        )}
      </div>
      <div className="adm-item__save">
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder={`Причина, от ${REASON_MIN} символов`} aria-label="Причина создания" />
        <button type="button"
          disabled={create.isPending || reason.trim().length < REASON_MIN || !form.code || !form.name}
          onClick={() => create.mutate()}>Создать</button>
      </div>
      {error && <Note text={error} kind="bad" />}
      <p className="adm-hint">
        Предмет появится в игре сразу. Отменяется из журнала — но только пока
        по нему никому ничего не выдали: у выданных вещей шаблон это их
        происхождение.
      </p>
    </div>
  )
}
