// Реферальная система (обещание игрокам 23.10, вкладка — заказчик 28.10):
// процент с покупок приглашённых копится на отдельном счёте, отсюда его
// зачисляют на персонажа или выводят на карту по заявке.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { referralApi, type PayoutStatus } from '../../shared/api/referral.api'
import { ApiError } from '../../shared/api/client'
import { referralLink } from '../../shared/lib/referral'
import { fmt, Skeleton, Fault } from '../stage3/stage3-ui'

const STATUS: Record<PayoutStatus, string> = { PENDING: 'в работе', PAID: 'выплачено', REJECTED: 'отклонено' }
const errorText = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

export function ReferralSection() {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['referral', 'me'], queryFn: referralApi.me })
  const [copied, setCopied] = useState(false)
  const [claimAmount, setClaimAmount] = useState<number | ''>('')
  const [amount, setAmount] = useState<number | ''>('')
  const [details, setDetails] = useState('')
  const refresh = () => { for (const key of ['referral', 'dollars']) void qc.invalidateQueries({ queryKey: [key] }) }
  const claim = useMutation({
    mutationFn: () => referralApi.claim(Number(claimAmount)),
    onSuccess: () => { setClaimAmount(''); refresh() },
  })
  const payout = useMutation({
    mutationFn: () => referralApi.requestPayout(Number(amount), details.trim()),
    onSuccess: () => { setAmount(''); setDetails(''); refresh() },
  })

  if (summary.isLoading) return <Skeleton rows={4} />
  if (summary.isError || !summary.data) return <Fault retry={() => summary.refetch()} />
  const me = summary.data
  const link = referralLink(me.code)
  const pending = me.payouts.some(row => row.status === 'PENDING')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* без доступа к буферу ссылку видно и так */ }
  }
  const submitClaim = (event: FormEvent) => {
    event.preventDefault()
    if (claimAmount) claim.mutate()
  }
  const submitPayout = (event: FormEvent) => {
    event.preventDefault()
    if (amount && details.trim().length >= 5) payout.mutate()
  }

  return (
    <section className="referral">
      <p className="s4-lead">
        Тебе — {me.sharePercent}% долларами с каждой покупки долларов у дилера тем, кого ты привёл.
        Они копятся здесь: зачисли их на персонажа или выведи на карту.
      </p>
      <div className="referral__link">
        <input readOnly value={link} aria-label="Твоя ссылка" onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать'}</button>
      </div>
      <div className="s4-summary">
        <div className="s4-stat s4-stat--good"><span className="s4-stat__label">Реферальный счёт</span><b>{fmt(me.balance)} $</b></div>
        <div className="s4-stat"><span className="s4-stat__label">Пришло по ссылке</span><b>{fmt(me.invited)}</b></div>
        <div className="s4-stat"><span className="s4-stat__label">Начислено всего</span><b>{fmt(me.earned)} $</b></div>
      </div>

      <form className="referral__box" onSubmit={submitClaim}>
        <h4>Зачислить на персонажа</h4>
        <div className="dollars__fields">
          <label htmlFor="ref-claim">Сумма, $
            <input id="ref-claim" type="number" min={1} max={me.balance || undefined} value={claimAmount}
              onChange={e => setClaimAmount(e.target.value ? Number(e.target.value) : '')} />
          </label>
          <button type="button" className="btn" disabled={me.balance === 0} onClick={() => setClaimAmount(me.balance)}>Всё</button>
          <button className="btn btn-primary" disabled={claim.isPending || !claimAmount || me.balance === 0}>
            {claim.isPending ? 'Зачисляем…' : 'Зачислить'}
          </button>
        </div>
        {claim.isError && <p className="alert alert-error" role="alert">{errorText(claim.error, 'Не получилось')}</p>}
        {claim.isSuccess && <p className="alert alert-success" role="status">Зачислено {fmt(claim.data.amount)} $, на персонаже {fmt(claim.data.dollars)} $.</p>}
      </form>

      <form className="referral__box" onSubmit={submitPayout}>
        <h4>Заявка на вывод</h4>
        <p className="s4-muted">
          От {fmt(me.minPayout)} $. Сумма спишется с реферального счёта сразу, деньги переведёт администрация вручную.
          Если заявку отклонят, сумма вернётся на счёт.
        </p>
        <div className="dollars__fields">
          <label htmlFor="ref-amount">Сумма, $
            <input id="ref-amount" type="number" min={me.minPayout} max={me.balance || undefined} value={amount}
              onChange={e => setAmount(e.target.value ? Number(e.target.value) : '')} />
          </label>
          <label htmlFor="ref-details">Куда перевести
            <input id="ref-details" value={details} maxLength={300} autoComplete="off"
              placeholder="Номер карты или телефон для СБП, банк"
              onChange={e => setDetails(e.target.value)} />
          </label>
          <button className="btn btn-primary"
            disabled={payout.isPending || pending || !amount || details.trim().length < 5 || me.balance < me.minPayout}>
            {payout.isPending ? 'Отправляем…' : 'Отправить заявку'}
          </button>
        </div>
        {pending && <p className="s4-muted">Прошлая заявка ещё в работе: новую можно подать после неё.</p>}
        {payout.isError && <p className="alert alert-error" role="alert">{errorText(payout.error, 'Заявка не ушла')}</p>}
        {payout.isSuccess && <p className="alert alert-success" role="status">Заявка на {fmt(payout.data.amount)} $ принята.</p>}
      </form>

      {me.payouts.length > 0 && (
        <>
          <h4>Заявки</h4>
          <ul className="s4-list s4-list--log">
            {me.payouts.map(row => (
              <li key={row.id}>
                <span className="s4-muted">{new Date(row.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span>Вывод · {STATUS[row.status]}{row.adminNote ? ` · ${row.adminNote}` : ''}</span>
                <span>{fmt(row.amount)} $</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
