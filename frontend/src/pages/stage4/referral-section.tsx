// Рефералы (обещание игрокам 23.10): доллары за процент с покупок
// приглашённых и вывод этих начислений на карту по заявке.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { referralApi, type PayoutStatus } from '../../shared/api/referral.api'
import { ApiError } from '../../shared/api/client'
import { referralLink } from '../../shared/lib/referral'
import { fmt } from '../stage3/stage3-ui'

const STATUS: Record<PayoutStatus, string> = { PENDING: 'в работе', PAID: 'выплачено', REJECTED: 'отклонено' }

export function ReferralSection() {
  const qc = useQueryClient()
  const summary = useQuery({ queryKey: ['referral', 'me'], queryFn: referralApi.me })
  const [copied, setCopied] = useState(false)
  const [amount, setAmount] = useState<number | ''>('')
  const [details, setDetails] = useState('')
  const payout = useMutation({
    mutationFn: () => referralApi.requestPayout(Number(amount), details.trim()),
    onSuccess: () => {
      setAmount(''); setDetails('')
      for (const key of ['referral', 'dollars']) void qc.invalidateQueries({ queryKey: [key] })
    },
  })

  const me = summary.data
  if (!me) return null
  const link = referralLink(me.code)
  const pending = me.payouts.some(row => row.status === 'PENDING')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* без доступа к буферу ссылку видно и так */ }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!amount || details.trim().length < 5) return
    payout.mutate()
  }

  return (
    <section className="referral">
      <h4>Приглашай своих</h4>
      <p className="s4-lead">
        Тебе — {me.sharePercent}% долларами с каждой покупки долларов у дилера тем, кого ты привёл.
        Эти доллары можно потратить в игре или вывести на карту.
      </p>
      <div className="referral__link">
        <input readOnly value={link} aria-label="Твоя ссылка" onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать'}</button>
      </div>
      <div className="s4-summary">
        <div className="s4-stat"><span className="s4-stat__label">Пришло по ссылке</span><b>{fmt(me.invited)}</b></div>
        <div className="s4-stat"><span className="s4-stat__label">Заработано</span><b>{fmt(me.earned)} $</b></div>
        <div className="s4-stat"><span className="s4-stat__label">Можно вывести</span><b>{fmt(me.withdrawable)} $</b></div>
      </div>

      <form className="referral__payout" onSubmit={submit}>
        <h4>Вывод на карту</h4>
        <p className="s4-muted">
          От {fmt(me.minPayout)} $. Доллары спишутся сразу, деньги переведёт администрация вручную.
          Если заявку отклонят, доллары вернутся.
        </p>
        <div className="dollars__fields">
          <label htmlFor="ref-amount">Сумма, $
            <input id="ref-amount" type="number" min={me.minPayout} max={me.withdrawable || undefined} value={amount}
              onChange={e => setAmount(e.target.value ? Number(e.target.value) : '')} />
          </label>
          <label htmlFor="ref-details">Куда перевести
            <input id="ref-details" value={details} maxLength={300} autoComplete="off"
              placeholder="Номер карты или телефон для СБП, банк"
              onChange={e => setDetails(e.target.value)} />
          </label>
          <button className="btn btn-primary"
            disabled={payout.isPending || pending || !amount || details.trim().length < 5 || me.withdrawable < me.minPayout}>
            {payout.isPending ? 'Отправляем…' : 'Отправить заявку'}
          </button>
        </div>
        {pending && <p className="s4-muted">Прошлая заявка ещё в работе: новую можно подать после неё.</p>}
        {payout.isError && <p className="alert alert-error" role="alert">{payout.error instanceof ApiError ? payout.error.message : 'Заявка не ушла'}</p>}
        {payout.isSuccess && <p className="alert alert-success" role="status">Заявка на {fmt(payout.data.amount)} $ принята.</p>}
      </form>

      {me.payouts.length > 0 && (
        <ul className="s4-list s4-list--log">
          {me.payouts.map(row => (
            <li key={row.id}>
              <span className="s4-muted">{new Date(row.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span>Вывод · {STATUS[row.status]}{row.adminNote ? ` · ${row.adminNote}` : ''}</span>
              <span>{fmt(row.amount)} $</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
