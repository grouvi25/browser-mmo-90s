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
import { adminApi, type CombatResult, type CombatSide, type Fighter, type ItemTemplateRow } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'
import { ItemCreateForm } from './item-create-form'
import { CHARMS, GEAR_STATS, KINDS, shopTitle } from './item-catalog'

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
 * Предметы игры: справочник и правка (переделка 30.10 — одна форма на
 * создание, правку и копию, в списке видно, где вещь продаётся и что даёт).
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
  // Открытая форма: новая вещь, правка или копия конкретной вещи.
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit' | 'copy'; code: string } | null>(null)
  const [search, setSearch] = useState('')
  const canEdit = role === 'SUPER_ADMIN'

  if (items.isLoading) return <Skeleton rows={4} />
  if (items.isError) return <Fault retry={() => items.refetch()} />

  const all = items.data?.items ?? []
  const types = KINDS.map(([kind]) => kind).filter(kind => all.some(item => item.type === kind))
  const needle = search.trim().toLowerCase()
  const shown = all.filter(item => item.type === type && (!needle || item.name.toLowerCase().includes(needle)))
  const done = () => { setForm(null); void qc.invalidateQueries({ queryKey: ['admin', 'items'] }) }

  return (
    <>
      <p className="s4-lead">
        {all.length} вещей — то, что реально лежит в базе. Материалы и сырьё — на вкладке «Ресурсы и материалы».{' '}
        {canEdit
          ? 'Новая вещь — кнопкой «Добавить вещь»; похожую на готовую быстрее завести через «копия» у образца. «Править» открывает ту же форму с заполненными полями.'
          : 'Правка недоступна вашей роли.'}
      </p>

      <div className="adm-items__head">
        <div className="s3-tabs">
          {types.map(kind => (
            <button key={kind} type="button" className={kind === type ? 'active' : ''} onClick={() => setType(kind)}>
              {KIND_TITLE[kind] ?? kind} ({all.filter(item => item.type === kind).length})
            </button>
          ))}
        </div>
        <input className="adm-items__search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти по названию" aria-label="Найти вещь по названию" />
        {canEdit && (
          <button type="button" className="adm-link" onClick={() => setForm(form?.mode === 'create' ? null : { mode: 'create' })}>
            <Plus size={12} /> {form?.mode === 'create' ? 'скрыть форму' : 'Добавить вещь'}
          </button>
        )}
      </div>

      {form?.mode === 'create' && <ItemCreateForm onDone={done} onCancel={() => setForm(null)} />}

      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Название</th><th>Ур.</th><th>Где продаётся</th><th>Основа</th><th>Даёт</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {shown.map(item => form && form.mode !== 'create' && form.code === item.code
              ? (
                <tr key={item.code} className="adm-item is-editing">
                  <td colSpan={6}>
                    <ItemCreateForm key={`${form.mode}-${item.code}`} mode={form.mode} initial={item} onDone={done} onCancel={() => setForm(null)} />
                  </td>
                </tr>
              )
              : <ItemRow key={item.code} item={item} canEdit={canEdit} onEdit={() => setForm({ mode: 'edit', code: item.code })} onCopy={() => setForm({ mode: 'copy', code: item.code })} />)}
            {shown.length === 0 && <tr><td colSpan={6} className="adm-hint">Ничего не нашлось.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

const KIND_TITLE: Record<string, string> = Object.fromEntries(KINDS.map(([kind, title]) => [kind, title.replace(/ \(.*\)$/, '')]))

/** Что вещь даёт надевшему — одной строкой, как в карточке игрока. */
function gives(item: ItemTemplateRow): string {
  const parts = [
    ...GEAR_STATS.filter(([key]) => item.statBonuses?.[key]).map(([key, label]) => `${label} ${item.statBonuses![key] > 0 ? '+' : ''}${item.statBonuses![key]}`),
    item.hpBonus && item.type !== 'CONSUMABLE' ? `HP +${item.hpBonus}` : '',
    item.critBonus ? `крит +${Math.round(item.critBonus * 1000) / 10}%` : '',
    item.dodgeBonus ? `уворот +${Math.round(item.dodgeBonus * 1000) / 10}%` : '',
    ...CHARMS.filter(([key]) => (item as unknown as Record<string, number | null>)[key]).map(([key, label]) => {
      const value = (item as unknown as Record<string, number>)[key]
      return `${label.toLowerCase()} ${value > 0 ? '+' : ''}${Math.round(value * 1000) / 10}%`
    }),
    item.statBudget ? `${item.statBudget} очк.` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : '—'
}

function ItemRow({ item, canEdit, onEdit, onCopy }: { item: ItemTemplateRow; canEdit: boolean; onEdit: () => void; onCopy: () => void }) {
  const base = item.minDamage != null
    ? `урон ${item.minDamage}–${item.maxDamage}${item.weaponAccuracy != null ? `, точн. ${Math.round(item.weaponAccuracy * 100)}%` : ''}`
    : item.armor != null ? `броня ${item.armor}`
      : item.type === 'CONSUMABLE' && item.hpBonus ? `лечит ${item.hpBonus} HP` : '—'
  const sales = item.sales?.length
    ? item.sales.map(s => `${shopTitle(s.shop)} ${s.price.toLocaleString('ru-RU')} ${s.currency === 'USD' ? '$' : '₽'}${s.isAvailable ? '' : ' (снята)'}`).join('; ')
    : 'не продаётся'
  return (
    <tr className={item.isActive === false ? 'is-muted' : undefined}>
      <td>{item.name}<em className="adm-row__hint">{item.code}</em></td>
      <td className="num">{item.levelReq ?? '—'}</td>
      <td>{sales}</td>
      <td>{base}</td>
      <td>{gives(item)}</td>
      {canEdit && (
        <td className="adm-items__acts">
          <button type="button" className="adm-link" onClick={onEdit}>править</button>
          <button type="button" className="adm-link" onClick={onCopy}>копия</button>
        </td>
      )}
    </tr>
  )
}
