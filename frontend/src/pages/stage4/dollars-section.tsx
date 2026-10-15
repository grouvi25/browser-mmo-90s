// =============================================================
// Игровые доллары: счёт, где их взять и кабинет дилера.
//
// Схема заказчика (октябрь 2026): доллары покупаются у дилера, дилер
// зачисляет их на счёт, игрок тратит как хочет. В игре нет кнопки
// «оплатить картой» — и экран так и говорит: к дилеру.
// =============================================================
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dollarsApi, type DollarMove } from '../../shared/api/dollars.api'
import { ApiError } from '../../shared/api/client'
import { fmt } from '../stage3/stage3-ui'

const REASON: Record<DollarMove['reason'], string> = {
  ISSUE: 'Зачислено администрацией',
  WITHDRAW: 'Списано администрацией',
  TRANSFER_OUT: 'Перевод игроку',
  TRANSFER_IN: 'Пополнение от дилера',
  PURCHASE: 'Покупка',
}

export function DollarsSection() {
  const qc = useQueryClient()
  const account = useQuery({ queryKey: ['dollars', 'me'], queryFn: dollarsApi.me })
  const dealers = useQuery({ queryKey: ['dollars', 'dealers'], queryFn: dollarsApi.dealers })
  const [nickname, setNickname] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
  const [confirm, setConfirm] = useState(false)
  const transfer = useMutation({
    mutationFn: () => dollarsApi.transfer(nickname.trim(), Number(amount)),
    onSuccess: () => {
      setConfirm(false); setNickname(''); setAmount('')
      void qc.invalidateQueries({ queryKey: ['dollars'] })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!nickname.trim() || !amount) return
    // Перевод не отменить кнопкой: сначала показываем, кому и сколько.
    if (!confirm) { setConfirm(true); return }
    transfer.mutate()
  }

  const me = account.data
  return (
    <section className="dollars">
      <div className="dollars__balance">
        <span>Ваш счёт</span>
        <b>{account.isLoading ? '…' : `${fmt(me?.dollars ?? 0)} $`}</b>
      </div>
      <p className="s4-lead">
        Доллары — игровая валюта для премиума и плюшек. Купить их можно у дилера:
        договоритесь с ним, он зачислит доллары на ваш счёт, а тратите вы их сами.
      </p>
      <div className="dollars__dealers">
        <h4>Дилеры</h4>
        {dealers.data?.items.length
          ? <ul>{dealers.data.items.map(d => <li key={d.nickname}>
              <Link to={`/u/${encodeURIComponent(d.nickname)}`}>{d.nickname}</Link> <i>{d.battleLevel} ур.</i>
            </li>)}</ul>
          : <p className="s4-muted">{dealers.isLoading ? 'Загружаем…' : 'Дилеров пока нет — обратитесь к администрации.'}</p>}
      </div>

      {me?.isDealer && (
        <form className="dollars__dealer" onSubmit={submit}>
          <h4>Кабинет дилера</h4>
          <div className="dollars__fields">
            <label htmlFor="dlr-nick">Ник игрока
              <input id="dlr-nick" value={nickname} maxLength={64} autoComplete="off"
                onChange={e => { setNickname(e.target.value); setConfirm(false) }} />
            </label>
            <label htmlFor="dlr-amount">Сумма, $
              <input id="dlr-amount" type="number" min={1} max={100000} value={amount}
                onChange={e => { setAmount(e.target.value ? Number(e.target.value) : ''); setConfirm(false) }} />
            </label>
            <button className="btn btn-primary" disabled={transfer.isPending || !nickname.trim() || !amount}>
              {transfer.isPending ? 'Переводим…' : confirm ? `Подтвердить: ${fmt(Number(amount))} $ → ${nickname.trim()}` : 'Зачислить'}
            </button>
            {confirm && <button type="button" className="btn" onClick={() => setConfirm(false)}>Отмена</button>}
          </div>
          {transfer.isError && <p className="alert alert-error" role="alert">{transfer.error instanceof ApiError ? transfer.error.message : 'Перевод не прошёл'}</p>}
          {transfer.isSuccess && <p className="alert alert-success" role="status">
            Зачислено {fmt(transfer.data.amount)} $ игроку {transfer.data.to}. У вас осталось {fmt(transfer.data.dealerBalance)} $.
          </p>}
        </form>
      )}

      {me?.history.length ? (
        <>
          <h4>Движение по счёту</h4>
          <ul className="s4-list s4-list--log">
            {me.history.map(row => (
              <li key={row.id}>
                <span className="s4-muted">{new Date(row.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span>{REASON[row.reason]}{row.counterparty ? ` · ${row.counterparty}` : ''}{row.reason === 'PURCHASE' && row.note ? ` · ${row.note}` : ''}</span>
                <span className={row.amount > 0 ? 'dollars__plus' : 'dollars__minus'}>{row.amount > 0 ? '+' : ''}{fmt(row.amount)} $</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
