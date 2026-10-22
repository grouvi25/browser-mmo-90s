// Обменник Чёрного рынка (обещание игрокам 22.10): рубли ↔ доллары в обе
// стороны. Курсы и суточный потолок покупки задаёт сервер.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dollarsApi } from '../../shared/api/dollars.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'
import { fmt } from '../stage3/stage3-ui'

export function ExchangeSection() {
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['dollars', 'exchange'], queryFn: dollarsApi.exchangeInfo })
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy')
  const [amount, setAmount] = useState<number | ''>('')
  const swap = useMutation({
    mutationFn: () => dollarsApi.exchange(direction, Number(amount)),
    onSuccess: () => {
      setAmount('')
      void qc.invalidateQueries({ queryKey: ['dollars'] })
      void qc.invalidateQueries({ queryKey: ['character'] })
    },
  })
  const rate = direction === 'buy' ? info.data?.buyRate : info.data?.sellRate
  const rub = rate && amount ? rate * Number(amount) : 0
  return (
    <section className="exchange">
      <p className="s4-lead">Обменник: рубли на доллары и обратно. Разница курсов — комиссия обменника.</p>
      <div className="exchange__wallet">
        <span>Рубли: <b>{fmt(me.data?.money ?? 0)} ₽</b></span>
        <span>Доллары: <b>{fmt(me.data?.dollars ?? 0)} $</b></span>
      </div>
      {info.data && <ul className="exchange__rates">
        <li>Купить 1 $ — {fmt(info.data.buyRate)} ₽ (за сутки не больше {info.data.dailyBuyLimit} $, осталось {info.data.buyLeft} $)</li>
        <li>Продать 1 $ — получите {fmt(info.data.sellRate)} ₽</li>
      </ul>}
      <form className="exchange__form" onSubmit={e => { e.preventDefault(); if (amount) swap.mutate() }}>
        <div className="adm-switch" role="radiogroup" aria-label="Направление обмена">
          <button type="button" className={direction === 'buy' ? 'active' : ''} onClick={() => setDirection('buy')}>Купить доллары</button>
          <button type="button" className={direction === 'sell' ? 'active' : ''} onClick={() => setDirection('sell')}>Продать доллары</button>
        </div>
        <label>Сколько долларов
          <input type="number" min={1} step={1} value={amount} onChange={e => setAmount(e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : '')} />
        </label>
        <p>{direction === 'buy' ? `Спишется: ${fmt(rub)} ₽` : `Получите: ${fmt(rub)} ₽`}</p>
        <button className="btn btn-primary" disabled={!amount || swap.isPending}>{direction === 'buy' ? 'Купить' : 'Продать'}</button>
      </form>
      {swap.isError && <p role="alert" className="city-notice">{swap.error instanceof ApiError ? swap.error.message : 'Не удалось обменять'}</p>}
      {swap.isSuccess && <p role="status" className="city-notice">Готово.</p>}
    </section>
  )
}
