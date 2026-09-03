// Журнал действий администраторов.
//
// Это такой же раздел, как остальные, а не спрятанная страница логов.
// Прозрачность между админами — дешёвая и очень полезная мера: чтение
// доступно всем ролям, включая самую слабую.
//
// У каждой строки видна обратная операция. Это и есть главное обещание
// этапа: любое действие можно отменить, и видно, чем именно.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminRole } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table, ReasonForm, when } from '../admin-ui'

export function ActionsSection({ role }: { role: AdminRole | null }) {
  const qc = useQueryClient()
  const [undoing, setUndoing] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const list = useQuery({ queryKey: ['admin', 'actions'], queryFn: () => adminApi.actions() })

  const rollback = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rollback(id, reason),
    onSuccess: () => {
      setBad(false)
      setMsg('Действие отменено. Откат тоже записан в журнал.')
      setUndoing(null)
      void qc.invalidateQueries({ queryKey: ['admin'] })
    },
    onError: (error: Error) => { setBad(true); setMsg(error.message) },
  })

  if (list.isLoading) return <Skeleton rows={6} />
  if (list.isError) return <Fault retry={() => list.refetch()} />
  const items = list.data?.items ?? []
  const canRollback = role === 'SUPER_ADMIN'

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <p className="adm-hint">
        Каждое действие знает, как его отменить. Действие, у которого обратной
        операции нет, админу не выдаётся вовсе.
      </p>

      {items.length === 0
        ? <Empty title="Журнал пуст" hint="Ни одного административного действия ещё не было." />
        : (
          <Table head={['Когда', 'Кто', 'Что', 'Над чем', 'Причина', 'Отмена', '']}>
            {items.map(action => (
              <tr key={action.id} className={action.rolledBackAt ? 'adm-undone' : ''}>
                <td>{when(action.createdAt)}</td>
                <td>{action.adminRole}</td>
                <td><b>{action.kind}</b></td>
                <td>{action.targetType}<br /><span className="adm-hint">{action.targetId.slice(0, 8)}</span></td>
                <td>{action.reason}</td>
                <td>
                  {action.rolledBackAt
                    ? <span className="adm-hint">откачено {when(action.rolledBackAt)}</span>
                    : <span className="adm-hint">{action.undoKind}</span>}
                </td>
                <td>
                  {canRollback && !action.rolledBackAt && action.kind !== 'ROLLBACK' && (
                    <button type="button" onClick={() => setUndoing(undoing === action.id ? null : action.id)}>
                      Откатить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

      {undoing && (
        <div className="adm-card-block">
          <p>
            Откат выполняет обратную операцию и сам записывается в журнал. Если мир
            изменился — предмет продан, деньги потрачены, район занят другой заявкой —
            откат откажется работать, а не сделает вид, что вернул.
          </p>
          <ReasonForm
            label="Откатить действие"
            danger
            busy={rollback.isPending}
            onSubmit={reason => rollback.mutate({ id: undoing, reason })}
          />
        </div>
      )}

      {!canRollback && (
        <p className="adm-hint">
          Откат чужих действий доступен только высшей роли: это вмешательство в
          экономику, а не модерация.
        </p>
      )}
    </>
  )
}
