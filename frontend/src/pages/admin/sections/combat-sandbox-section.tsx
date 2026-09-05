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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Swords } from 'lucide-react'
import { adminApi, type CombatResult, type CombatSide, type Fighter, type ItemTemplateRow } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'

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

/** Справочник предметов — что вообще есть в игре и с какими числами. */
export function ItemsSection() {
  const items = useQuery({ queryKey: ['admin', 'items'], queryFn: adminApi.sandboxItems })
  const [type, setType] = useState<string>('WEAPON')

  if (items.isLoading) return <Skeleton rows={4} />
  if (items.isError) return <Fault retry={() => items.refetch()} />

  const all = items.data?.items ?? []
  const types = [...new Set(all.map(item => item.type))]
  const shown = all.filter(item => item.type === type)

  return (
    <>
      <p className="s4-lead">
        {all.length} предметов в игре — то, что реально лежит в базе, а не в сиде:
        правки, сделанные после последнего посева, тут тоже видны.
      </p>

      <div className="s3-tabs">
        {types.map(kind => (
          <button key={kind} type="button" className={kind === type ? 'active' : ''} onClick={() => setType(kind)}>
            {kind} ({all.filter(item => item.type === kind).length})
          </button>
        ))}
      </div>

      <div className="adm-scroll">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Название</th><th>Код</th><th>Ур.</th><th>Цена</th>
              <th>Урон</th><th>Точность</th><th>Броня</th><th>Прочность</th><th>Вес</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(item => (
              <tr key={item.code}>
                <td>{item.name}</td>
                <td><code>{item.code}</code></td>
                <td className="num">{item.levelReq ?? '—'}</td>
                <td className="num">{item.priceBase?.toLocaleString('ru-RU') ?? '—'}</td>
                <td className="num">{item.minDamage != null ? `${item.minDamage}–${item.maxDamage}` : '—'}</td>
                <td className="num">{item.weaponAccuracy ?? '—'}</td>
                <td className="num">{item.armor ?? '—'}</td>
                <td className="num">{item.durabilityMax ?? '—'}</td>
                <td className="num">{item.weight ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
