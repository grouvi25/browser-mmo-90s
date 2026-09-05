// Цепочка транзакций: вся история предмета, персонажа или бригады одной
// лентой.
//
// То, чем ловят дюп и перелив. У двух копий предмета история совпадает до
// момента раздвоения, и увидеть это можно, только положив цепочки рядом —
// в отдельном журнале не видно ничего.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi } from '../admin-api'
import { Skeleton, Empty, Note } from '../../stage3/stage3-ui'
import { Table, when, rub } from '../admin-ui'

type Subject = 'character' | 'item' | 'clan'

const LABEL: Record<Subject, string> = {
  character: 'Персонаж',
  item: 'Предмет',
  clan: 'Бригада',
}

export function TraceSection({ focus }: { focus?: string }) {
  const [type, setType] = useState<Subject>('character')
  const [id, setId] = useState(focus ?? '')
  const [asked, setAsked] = useState<{ type: Subject; id: string } | null>(
    focus ? { type: 'character', id: focus } : null,
  )

  // Переход из карточки игрока или из его вещи. Раньше сюда приходили с
  // пустой формой и полем «Идентификатор», значение для которого взять
  // было неоткуда, — оттого раздел и казался лишним.
  useEffect(() => {
    if (!focus) return
    setId(focus)
    setAsked(current => (current?.id === focus ? current : { type: 'character', id: focus }))
  }, [focus])

  const trace = useQuery({
    queryKey: ['admin', 'trace', asked?.type, asked?.id],
    queryFn: () => adminApi.trace(asked!.type, asked!.id),
    enabled: !!asked,
    retry: false,
  })

  return (
    <>
      <form
        className="adm-trace-form"
        onSubmit={event => { event.preventDefault(); if (id.trim()) setAsked({ type, id: id.trim() }) }}
      >
        <select value={type} onChange={event => setType(event.target.value as Subject)} aria-label="Что искать">
          {(Object.keys(LABEL) as Subject[]).map(key => (
            <option key={key} value={key}>{LABEL[key]}</option>
          ))}
        </select>
        <input
          value={id}
          onChange={event => setId(event.target.value)}
          placeholder="Ник, название бригады или идентификатор"
          aria-label="Кого искать"
        />
        <button type="submit" disabled={!id.trim()}><Search size={12} /> Показать</button>
      </form>

      {!asked && (
        <p className="adm-hint">
          Цепочка сшивает журналы по одному предмету, персонажу или бригаде:
          деньги, вещи, ресурсы и производство одной лентой. В отдельном журнале
          ни дюп, ни перелив не видны — они видны только здесь.
          Персонажа и бригаду можно назвать по имени; предмет — только
          идентификатором, и его даёт карточка игрока кнопкой «цепочка».
        </p>
      )}

      {asked && trace.isLoading && <Skeleton rows={5} />}
      {asked && trace.isError && (
        <Note text={(trace.error as Error)?.message || 'Не найдено. Проверьте тип и имя.'} kind="bad" />
      )}

      {trace.data && (
        <>
          <p className="adm-alert">
            {String(trace.data.subject.label ?? '—')}
            {trace.data.truncated ? ' · показаны не все события' : ''}
          </p>
          {trace.data.events.length === 0
            ? <Empty title="История пуста" hint="По этому объекту журналы ничего не записали." />
            : (
              <Table head={['Когда', 'Откуда', 'Что', 'Сколько', 'Остаток', 'Действие админа']}>
                {trace.data.events.map((event, index) => (
                  <tr key={index} className={event.adminActionId ? 'adm-by-admin' : ''}>
                    <td>{when(event.at)}</td>
                    <td>{event.source}</td>
                    <td>{event.action}</td>
                    <td className={(event.amount ?? 0) < 0 ? 'adm-bad' : ''}>{rub(event.amount)}</td>
                    <td>{rub(event.balanceAfter)}</td>
                    <td>
                      {event.adminActionId
                        ? <span className="adm-hint">{event.adminActionId.slice(0, 8)}</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          <p className="adm-hint">
            Строки, помеченные действием админа, порождены административной
            операцией: журнал ссылается на неё в момент записи.
          </p>
        </>
      )}
    </>
  )
}
