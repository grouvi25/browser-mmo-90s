// Сигналы антиабуза.
//
// Раздел обязан доносить одно: сигнал НИКОГО НЕ НАКАЗЫВАЕТ. Он объясняет,
// что показалось подозрительным, и приносит числа — решает человек. Поэтому
// у каждой строки видно объяснение словами, а не только вид и тяжесть.
//
// Отклонение тоже требует причины: массово отклонённые сигналы одного вида —
// повод пересмотреть правило, а не игрока, и увидеть это можно только по
// причинам отклонений.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { ReasonForm, when } from '../admin-ui'

const SEVERITY: Record<number, string> = {
  1: 'посмотреть',
  2: 'разобрать',
  3: 'остановить и разобраться',
}

export function SignalsSection() {
  const qc = useQueryClient()
  const [scope, setScope] = useState<'OPEN' | 'REVIEWED' | 'DISMISSED'>('OPEN')
  const [acting, setActing] = useState<{ id: string; status: 'REVIEWED' | 'DISMISSED' } | null>(null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'signals', scope], queryFn: () => adminApi.signals(scope) })

  const review = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: 'REVIEWED' | 'DISMISSED'; reason: string }) =>
      adminApi.reviewSignal(id, status, reason),
    onSuccess: () => {
      setBad(false)
      setMsg('Сигнал разобран. Решение записано в журнал действий и обратимо.')
      setActing(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'signals'] })
    },
    onError: (error: Error) => { setBad(true); setMsg(error.message) },
  })

  if (list.isLoading) return <Skeleton rows={5} />
  if (list.isError) return <Fault retry={() => list.refetch()} />
  const items = list.data?.items ?? []

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <p className="adm-hint">
        Сигнал ничего не делает сам. Он показывает, что показалось подозрительным,
        и приносит числа для проверки — решение принимает человек.
      </p>

      <div className="adm-switch">
        {(['OPEN', 'REVIEWED', 'DISMISSED'] as const).map(value => (
          <button
            key={value}
            type="button"
            className={scope === value ? 'active' : ''}
            onClick={() => setScope(value)}
          >
            {value === 'OPEN' ? 'Открытые' : value === 'REVIEWED' ? 'Разобранные' : 'Отклонённые'}
          </button>
        ))}
      </div>

      {items.length === 0
        ? <Empty title="Сигналов нет" hint="Разбор гоняется раз в сутки." />
        : (
          <ul className="adm-signals">
            {items.map(signal => (
              <li key={signal.id} className={`adm-signal adm-signal--${signal.severity}`}>
                <header>
                  <b>{signal.kind}</b>
                  <span className="adm-hint">
                    тяжесть {signal.severity} — {SEVERITY[signal.severity]} · {when(signal.createdAt)}
                  </span>
                </header>
                <p>{signal.summary}</p>
                <pre className="adm-evidence">{JSON.stringify(signal.evidence, null, 1)}</pre>

                {signal.status === 'OPEN' && (
                  <div className="adm-signal__actions">
                    <button type="button" onClick={() => setActing({ id: signal.id, status: 'REVIEWED' })}>
                      Разобран
                    </button>
                    <button type="button" onClick={() => setActing({ id: signal.id, status: 'DISMISSED' })}>
                      Отклонить
                    </button>
                  </div>
                )}

                {acting?.id === signal.id && (
                  <ReasonForm
                    label={acting.status === 'REVIEWED' ? 'Пометить разобранным' : 'Отклонить сигнал'}
                    busy={review.isPending}
                    onSubmit={reason => review.mutate({ id: signal.id, status: acting.status, reason })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
    </>
  )
}
