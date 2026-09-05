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
// Отсюда же коэффициент правится: путь в конфиге у каждого свой, правка
// уходит в журнал с причиной и снимается оттуда же.
// =============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Search } from 'lucide-react'
import { adminApi, type BalanceFormula, type BalanceGroup, type BalanceParam } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'
import { REASON_MIN } from '../admin-api'

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

export function BalanceSection({ role, focus }: { role?: string | null; focus?: string }) {
  const balance = useQuery({ queryKey: ['admin', 'balance'], queryFn: adminApi.balance })
  const [query, setQuery] = useState('')
  // focus приходит из алерта: он говорит, какую формулу открыть — иначе
  // кнопка «к порогам» приводила бы просто на список из 29 штук.
  const [openId, setOpenId] = useState<string | null>(focus ?? null)
  const canEdit = role === 'SUPER_ADMIN'

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
        живые — читаются из конфигурации сервера.{' '}
        {canEdit
          ? 'Любое можно поправить прямо здесь: правка применяется к игре сразу, без выката, записывается в журнал с причиной и снимается оттуда же.'
          : 'Править может только SUPER_ADMIN.'}
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
              canEdit={canEdit}
              open={openId === formula.id || needle.length > 0}
              focused={focus === formula.id && openId === formula.id}
              onToggle={() => setOpenId(openId === formula.id ? null : formula.id)}
            />
          ))}
        </section>
      ))}
    </>
  )
}

function Formula({
  formula, open, onToggle, canEdit, focused,
}: {
  formula: BalanceFormula; open: boolean; onToggle: () => void
  canEdit: boolean; focused?: boolean
}) {
  const box = useRef<HTMLElement>(null)

  // Переход из алерта раскрывал нужную формулу, но она оставалась за
  // краем экрана — для человека это неотличимо от «просто перекинуло на
  // вкладку баланса». Подводим к ней и подсвечиваем.
  useEffect(() => {
    if (!focused || !box.current) return
    box.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])

  return (
    <article ref={box} className={[
      'adm-formula', open ? 'is-open' : '', focused ? 'is-focused' : '',
    ].filter(Boolean).join(' ')}>
      <button type="button" className="adm-formula__head" onClick={onToggle} aria-expanded={open}>
        <b>{formula.title}</b>
        <span className="adm-formula__what">{formula.what}</span>
      </button>

      {open && (
        <div className="adm-formula__body">
          <div className="adm-formula__block">
            <h5>Как считается</h5>
            <code className="adm-formula__math">{formula.formula}</code>
          </div>

          {/* Разбор на живых числах. Считает его сервер теми же функциями,
              что работают в игре, — это не пересказ формулы, а её прогон. */}
          {formula.example && (
            <div className="adm-formula__block">
              <h5>Пример расчёта</h5>
              <p className="adm-example__given">Дано: {formula.example.given.join(' · ')}</p>
              <ol className="adm-example__steps">
                {formula.example.steps.map((step, index) => (
                  <li key={index}>
                    <span>{step.text}</span>
                    <b>{step.value}</b>
                  </li>
                ))}
              </ol>
              <p className="adm-example__result">= {formula.example.result}</p>
              <p className="adm-example__meaning">{formula.example.meaning}</p>
            </div>
          )}

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
                <ParamRow key={param.path} param={param} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}


/**
 * Строка коэффициента с правкой.
 *
 * Правятся только числа: за таблицами порогов и наборами архетипов стоят
 * связанные решения, и менять их полем ввода в один клик — способ сломать
 * баланс молча. Их видно, но не тронуть.
 */
function ParamRow({ param, canEdit }: { param: BalanceParam; canEdit: boolean }) {
  const qc = useQueryClient()
  const numeric = typeof param.value === 'number'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(param.value ?? ''))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => adminApi.setBalanceParam(param.path, Number(draft), reason.trim()),
    onSuccess: () => { setEditing(false); setReason(''); setError(''); void qc.invalidateQueries({ queryKey: ['admin'] }) },
    onError: (err: Error) => setError(err.message),
  })
  const reset = useMutation({
    mutationFn: () => adminApi.clearBalanceParam(param.path, `возврат к значению из кода: ${param.path}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (err: Error) => setError(err.message),
  })

  const changed = param.override != null

  return (
    <tr className={changed ? 'adm-param is-changed' : 'adm-param'}>
      <td><code>{param.path}</code></td>
      <td className="num">
        {editing ? (
          <div className="adm-param__edit">
            <input
              type="number" step="any" value={draft} autoFocus
              onChange={event => setDraft(event.target.value)}
              aria-label={`Новое значение ${param.path}`}
            />
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={`Причина, от ${REASON_MIN} символов`}
              aria-label="Причина правки"
            />
            <button type="button" disabled={save.isPending || reason.trim().length < REASON_MIN}
              onClick={() => save.mutate()}>Применить</button>
            <button type="button" className="adm-link" onClick={() => { setEditing(false); setError('') }}>отмена</button>
            {error && <Note text={error} kind="bad" />}
          </div>
        ) : (
          <>
            {show(param.value)}
            {changed && (
              <span className="adm-param__was" title={param.override?.reason}>
                было {show(param.defaultValue)}
              </span>
            )}
            {canEdit && numeric && (
              <button type="button" className="adm-link" onClick={() => { setDraft(String(param.value)); setEditing(true) }}>
                править
              </button>
            )}
            {canEdit && changed && (
              <button type="button" className="adm-link" onClick={() => reset.mutate()} disabled={reset.isPending}>
                <RotateCcw size={11} /> вернуть
              </button>
            )}
          </>
        )}
      </td>
      <td>
        {param.note}
        {changed && (
          <div className="adm-param__reason">
            Правка: {param.override?.reason}
          </div>
        )}
      </td>
    </tr>
  )
}
