import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { clansApi } from '../../shared/api/clans.api'
import { fmt, Skeleton, Fault, Empty, Note } from './stage3-ui'
import { useMyClan } from './use-my-clan'

/** Общак: пополнение без ограничений, трата — только с причиной и в пределах суточного лимита. */
export function ClanTreasurySection() {
  const qc = useQueryClient()
  const { clan, can, isLoading, isError, refetch, hasClan } = useMyClan()
  const [amount, setAmount] = useState(500)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const done = (text: string) => {
    setBad(false)
    setMsg(text)
    void qc.invalidateQueries({ queryKey: ['clan'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const deposit = useMutation({ mutationFn: () => clansApi.deposit(amount), onSuccess: () => done('Общак пополнен'), onError: fail })
  const spend = useMutation({ mutationFn: () => clansApi.spend(amount, reason), onSuccess: () => { setReason(''); done('Списано из общака') }, onError: fail })

  if (isLoading) return <Skeleton rows={3} />
  if (isError) return <Fault retry={refetch} />
  if (!hasClan) return <Empty title="Вы не в бригаде" hint="Общак открывается вместе с вступлением в бригаду." />
  if (!clan) return <Skeleton rows={3} />

  return (
    <>
      <div className="clan-ledger">
        <div><span>В общаке</span><b>{fmt(clan.treasury)} ₽</b></div>
        <div><span>Долг по содержанию</span><b className={clan.maintenanceDebt > 0 ? 'bad' : ''}>{fmt(clan.maintenanceDebt)} ₽</b></div>
        <div><span>Содержание</span><b>500 ₽/сутки</b></div>
        <div><span>Статус</span><b>{clan.isFrozen ? 'заморожен' : 'в норме'}</b></div>
      </div>

      {clan.maintenanceDebt > 0 && (
        <p className="s3-hint s3-hint--warn">
          Пополнение сначала гасит долг и только потом ложится в общак.
          При долге от 1 500 ₽ бригада замораживается.
        </p>
      )}

      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <section className="treasury-forms">
        <fieldset>
          <legend><Wallet size={14} /> Пополнить</legend>
          <input type="number" min={1} value={amount} aria-label="Сумма" onChange={e => setAmount(Number(e.target.value))} />
          <button onClick={() => deposit.mutate()} disabled={deposit.isPending || !can('TREASURY_PUT')}>
            Внести {fmt(amount)} ₽
          </button>
        </fieldset>

        <fieldset>
          <legend>Потратить</legend>
          {/* Причина обязательна и попадает в журнал: трата без причины — готовый конфликт в бригаде. */}
          <input
            value={reason}
            placeholder="Причина траты"
            aria-label="Причина траты"
            onChange={e => setReason(e.target.value)}
          />
          <button
            onClick={() => spend.mutate()}
            disabled={spend.isPending || !can('TREASURY_SPEND') || reason.trim().length < 3 || clan.isFrozen}
          >
            Списать {fmt(amount)} ₽
          </button>
          {!can('TREASURY_SPEND') && <small className="muted">Ваша роль не может тратить общак.</small>}
        </fieldset>
      </section>
    </>
  )
}
