// =============================================================
// Баланс: что игра считает и чем это управляется.
//
// До этого раздела устройство игры жило только в девятнадцати файлах формул:
// администратор видел последствия — деньги, бои, жалобы, — но не мог
// посмотреть причину. Здесь каждая формула названа словами, сказано, на что
// она влияет, и показаны её коэффициенты с текущими значениями.
//
// Значения приходят с сервера из BalanceConfig на каждый запрос, а не
// скопированы сюда: разойтись с игрой панель не может.
//
// Пока только чтение. Правка отсюда — следующий шаг, и для неё уже всё
// разложено: у каждого коэффициента есть путь в конфиге.
// =============================================================
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi, type BalanceFormula, type BalanceGroup } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'

/** Значение коэффициента: числа и строки словами, структуры — как есть. */
function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    // Доли показываем процентами: 0.05 читается хуже, чем 5%.
    if (value > 0 && value < 1) return `${value} (${Math.round(value * 1000) / 10}%)`
    return value.toLocaleString('ru-RU')
  }
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  return JSON.stringify(value)
}

export function BalanceSection() {
  const balance = useQuery({ queryKey: ['admin', 'balance'], queryFn: adminApi.balance })
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const groups = balance.data?.groups ?? []
  const needle = query.trim().toLowerCase()

  // Поиск идёт и по формулам, и по коэффициентам: чаще всего ищут как раз
  // конкретное число — «откуда взялись эти 10 000».
  const filtered = useMemo<BalanceGroup[]>(() => {
    if (!needle) return groups
    return groups
      .map(group => ({
        ...group,
        formulas: group.formulas.filter(formula =>
          [formula.title, formula.formula, formula.what, formula.affects, formula.source]
            .join(' ').toLowerCase().includes(needle)
          || formula.params.some(param =>
            `${param.path} ${show(param.value)} ${param.note}`.toLowerCase().includes(needle)),
        ),
      }))
      .filter(group => group.formulas.length > 0)
  }, [groups, needle])

  if (balance.isLoading) return <Skeleton rows={5} />
  if (balance.isError) return <Fault retry={() => balance.refetch()} />

  const total = groups.reduce((sum, group) => sum + group.formulas.length, 0)
  const params = groups.reduce((sum, group) =>
    sum + group.formulas.reduce((inner, formula) => inner + formula.params.length, 0), 0)

  return (
    <>
      <p className="s4-lead">
        {total} формул и {params} коэффициентов, которыми считается игра. Значения
        живые — читаются из конфигурации сервера, а не переписаны сюда. Правка
        значений появится следующим шагом; пути в конфиге уже указаны у каждого.
      </p>

      <label className="adm-find">
        <Search size={13} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Найти формулу, коэффициент или число — например «уворот», «10000» или «upkeep»"
          aria-label="Поиск по балансу"
        />
      </label>

      {filtered.length === 0 && (
        <p className="adm-hint">Ничего не нашлось. Попробуйте часть слова или само число.</p>
      )}

      {filtered.map(group => (
        <section key={group.id} className="adm-balance-group">
          <h4>{group.title}</h4>
          <p className="adm-balance-group__intro">{group.intro}</p>
          {group.formulas.map(formula => (
            <Formula
              key={formula.id}
              formula={formula}
              open={openId === formula.id || needle.length > 0}
              onToggle={() => setOpenId(openId === formula.id ? null : formula.id)}
            />
          ))}
        </section>
      ))}
    </>
  )
}

function Formula({
  formula, open, onToggle,
}: { formula: BalanceFormula; open: boolean; onToggle: () => void }) {
  return (
    <article className={open ? 'adm-formula is-open' : 'adm-formula'}>
      <button type="button" className="adm-formula__head" onClick={onToggle} aria-expanded={open}>
        <b>{formula.title}</b>
        <span className="adm-formula__what">{formula.what}</span>
      </button>

      {open && (
        <div className="adm-formula__body">
          <code className="adm-formula__math">{formula.formula}</code>

          <dl className="adm-formula__facts">
            <div>
              <dt>На что влияет</dt>
              <dd>{formula.affects}</dd>
            </div>
            <div>
              <dt>Входы</dt>
              <dd>{formula.inputs.join(' · ')}</dd>
            </div>
            <div>
              <dt>Где в коде</dt>
              <dd><code>{formula.source}</code></dd>
            </div>
          </dl>

          <table className="adm-table adm-formula__params">
            <thead>
              <tr><th>Коэффициент</th><th>Значение</th><th>Почему такой</th></tr>
            </thead>
            <tbody>
              {formula.params.map(param => (
                <tr key={param.path}>
                  <td><code>{param.path}</code></td>
                  <td className="num">{show(param.value)}</td>
                  <td>{param.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
