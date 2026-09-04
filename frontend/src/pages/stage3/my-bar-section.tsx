import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Beer, PackageOpen } from 'lucide-react'
import { barsApi, type Bar, type BarOffer } from '../../shared/api/bars.api'
import { charactersApi } from '../../shared/api/characters.api'
import { fmt, Skeleton, Fault, Empty, Note } from './stage3-ui'

/** Мой бар: владелец правит цены в коридоре себестоимость…тройная себестоимость. */
export function MyBarSection() {
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  const bars = useQuery({ queryKey: ['bars'], queryFn: barsApi.list })

  if (bars.isLoading || me.isLoading) return <Skeleton rows={3} />
  if (bars.isError) return <Fault retry={() => bars.refetch()} />

  const mine = bars.data?.items.filter(bar => bar.ownerCharacterId && bar.ownerCharacterId === me.data?.id) ?? []

  if (mine.length === 0) {
    const price = bars.data?.items.find(bar => bar.purchasePrice != null)?.purchasePrice
    return (
      <Empty
        title="У вас нет своего бара"
        hint={`Бар покупается как обычный объект — на «Рынке объектов» в Промзоне.${price != null ? ` Цена ${fmt(price)} ₽.` : ''}`}
      />
    )
  }

  return <>{mine.map(bar => <MyBarCard key={bar.id} bar={bar} />)}</>
}

function MyBarCard({ bar }: { bar: Bar }) {
  return (
    <section className="mybar">
      <header>
        <div><Beer /><h2>{bar.name}</h2></div>
        <dl>
          <div><dt>Баланс бара</dt><dd>{fmt(bar.balance)} ₽</dd></div>
          <div><dt>Позиций в меню</dt><dd>{bar.barOffers.length}</dd></div>
        </dl>
      </header>

      <p className="s3-hint">
        С каждой продажи 20% уходит налогом, остальное падает на баланс бара.
        Нет сырья на складе — позиция не продаётся, даже если стоит в меню.
      </p>

      {bar.barOffers.length === 0 ? (
        <div className="empty-line"><PackageOpen size={16} /> меню пустое</div>
      ) : (
        <div className="s3-scroll">
          <table className="s3-table">
            <thead>
              <tr><th>Позиция</th><th>Себестоимость</th><th>Коридор</th><th>Цена</th><th /></tr>
            </thead>
            <tbody>
              {bar.barOffers.map(offer => <OfferRow key={offer.id} offer={offer} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function OfferRow({ offer }: { offer: BarOffer }) {
  const qc = useQueryClient()
  const [price, setPrice] = useState(offer.price)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const save = useMutation({
    mutationFn: () => barsApi.setPrice(offer.id, price),
    onSuccess: () => {
      setBad(false)
      setMsg('Цена обновлена')
      void qc.invalidateQueries({ queryKey: ['bars'] })
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  const min = offer.baseCost
  const max = offer.baseCost * 3
  const outside = price < min || price > max

  return (
    <tr>
      <td><b>{offer.name}</b></td>
      <td>{fmt(offer.baseCost)} ₽</td>
      <td className="muted">{fmt(min)}–{fmt(max)} ₽</td>
      <td>
        <input
          type="number" min={min} max={max} value={price}
          aria-label={'Цена: ' + offer.name}
          aria-invalid={outside}
          onChange={e => setPrice(Number(e.target.value))}
        />
      </td>
      <td>
        <button onClick={() => save.mutate()} disabled={save.isPending || outside || price === offer.price}>
          Сохранить
        </button>
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </td>
    </tr>
  )
}
