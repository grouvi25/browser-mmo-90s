// Районы: владелец, долг, защита, открытая заявка. Единственная мутация —
// сброс района в ничейный, и она недоступна ниже высшей роли: это действие
// меняет игру для всех сразу.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminRole } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'
import { Table, ReasonForm, when, rub } from '../admin-ui'

export function TerritoriesSection({ role }: { role: AdminRole | null }) {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [resetting, setResetting] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['admin', 'territories'], queryFn: adminApi.territories })

  const reset = useMutation({
    mutationFn: ({ code, reason }: { code: string; reason: string }) => adminApi.resetTerritory(code, reason),
    onSuccess: () => {
      setBad(false)
      setMsg('Район сброшен в ничейный. Действие обратимо: снимок владельца записан.')
      setResetting(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'territories'] })
    },
    onError: (error: Error) => { setBad(true); setMsg(error.message) },
  })

  if (list.isLoading) return <Skeleton rows={6} />
  if (list.isError) return <Fault retry={() => list.refetch()} />
  const items = list.data?.items ?? []
  const canReset = role === 'SUPER_ADMIN'

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <Table head={['Район', 'Состояние', 'Владелец', 'Ступень', 'Долг', 'Защита', 'Заявка', '']}>
        {items.map(row => (
          <tr key={row.code}>
            <td><b>{row.name}</b><br /><span className="adm-hint">{row.code}</span></td>
            <td>{row.status}</td>
            <td>{row.owner ? `[${row.owner.tag}] ${row.owner.name}` : '—'}</td>
            <td>{row.upkeepTier}</td>
            <td className={row.bonusSuspended ? 'adm-bad' : ''}>
              {rub(row.upkeepDebt)}{row.bonusSuspended ? ' (бонус погашен)' : ''}
            </td>
            <td>{row.isProtected ? when(row.protectedUntil) : '—'}</td>
            <td>
              {row.activeClaim
                ? `[${row.activeClaim.attackerTag}] → ${when(row.activeClaim.battleStartsAt)}`
                : '—'}
            </td>
            <td>
              {canReset && (
                <button type="button" onClick={() => setResetting(resetting === row.code ? null : row.code)}>
                  Сбросить
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      {resetting && (
        <div className="adm-card-block">
          <p>
            Сброс района <b>{resetting}</b> в ничейный. Владелец, ступень, защита и долг
            записываются снимком — действие отменяется откатом. Во время боя за район
            сброс запрещён: бой закончился бы в никуда.
          </p>
          <ReasonForm
            label="Сбросить район"
            danger
            busy={reset.isPending}
            onSubmit={reason => reset.mutate({ code: resetting, reason })}
          />
        </div>
      )}

      {!canReset && (
        <p className="adm-hint">
          Сброс района доступен только высшей роли: это действие меняет игру для всех сразу.
        </p>
      )}
    </>
  )
}
