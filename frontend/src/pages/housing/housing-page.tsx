// =============================================================
// Жилой сектор (правка заказчика 21.10.2026): квартира или дом за доллары,
// прибавка к опыту за бой, вход на склад из дома, туннели на Стрелки,
// Промзону и Фермы, налёты на чужие дома (бой со сторожем, −10% прочности).
// =============================================================
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Home, Building2, Hammer, Package, Shovel, Swords } from 'lucide-react'
import { housingApi, type HomeKind, type HousingView } from '../../shared/api/housing.api'
import { SCENES } from '../../shared/ui/sprite'
import './housing.css'

const pct = (share: number) => Math.round(share * 100)
const KIND_ICON: Record<HomeKind, typeof Home> = { APARTMENT: Building2, HOUSE: Home }

export function HousingPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const query = useQuery({ queryKey: ['housing'], queryFn: housingApi.view })
  const done = (text: string) => { setMsg({ text, bad: false }); void qc.invalidateQueries({ queryKey: ['housing'] }); void qc.invalidateQueries({ queryKey: ['character'] }) }
  const fail = (e: Error) => setMsg({ text: e.message, bad: true })

  const buy = useMutation({ mutationFn: housingApi.buy, onSuccess: r => done(`Жильё ваше. Списано ${r.cost} $.`), onError: fail })
  const tunnel = useMutation({ mutationFn: housingApi.tunnel, onSuccess: () => done('Туннель прорыт.'), onError: fail })
  const repair = useMutation({ mutationFn: housingApi.repair, onSuccess: r => done(`Отремонтировано за ${r.cost.toLocaleString('ru')} ₽.`), onError: fail })
  const raid = useMutation({ mutationFn: housingApi.raid, onSuccess: r => navigate(`/battle/${r.battleId}`), onError: fail })
  const busy = buy.isPending || tunnel.isPending || repair.isPending || raid.isPending

  return (
    <div className="housing">
      <img className="brigade-scene" src={SCENES.housing} alt="Жилой сектор" draggable={false} />
      {msg && <p className={'housing__msg' + (msg.bad ? ' is-bad' : '')} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      {query.isLoading && <p role="status">Загрузка…</p>}
      {query.isError && <p role="alert">Сектор не загрузился. <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Повторить</button></p>}
      {query.data && <>
        {query.data.home
          ? <MyHome data={query.data} busy={busy} onTunnel={code => tunnel.mutate(code)} onRepair={() => repair.mutate()} onBuy={kind => buy.mutate(kind)} onGo={to => navigate(to)} />
          : <BuyHome data={query.data} busy={busy} onBuy={kind => buy.mutate(kind)} />}
        <section className="housing__block">
          <h3>Дома соседей</h3>
          {query.data.homes.length === 0
            ? <p className="housing__muted">В секторе пока никто не живёт.</p>
            : <ul className="housing__list">{query.data.homes.map(h => {
              const wait = h.canRaidAt && new Date(h.canRaidAt).getTime() > Date.now()
              return <li key={h.id}>
                <span><b>{h.owner}</b> ур. {h.ownerLevel} · {query.data!.prices[h.kind].name.toLowerCase()} · прочность {h.durability}%</span>
                <button type="button" className="btn btn-sm" disabled={busy || !!wait} onClick={() => raid.mutate(h.id)}
                  title={wait ? `Снова — после ${new Date(h.canRaidAt!).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Бой со сторожем дома'}>
                  <Swords size={13} /> {wait ? 'Уже нападали' : 'Напасть'}
                </button>
              </li>
            })}</ul>}
        </section>
      </>}
    </div>
  )
}

function BuyHome({ data, busy, onBuy }: { data: HousingView; busy: boolean; onBuy: (kind: HomeKind) => void }) {
  return (
    <section className="housing__block">
      <h3>Купить жильё</h3>
      <p className="housing__muted">Только за доллары. У вас {data.wallet.dollars} $.</p>
      <div className="housing__offers">
        {(Object.keys(data.prices) as HomeKind[]).map(kind => {
          const p = data.prices[kind]; const Icon = KIND_ICON[kind]
          return <article key={kind} className="housing__offer">
            <h4><Icon size={16} /> {p.name}</h4>
            <p>+{pct(p.expBonus)}% к опыту за бой · вход на склад · туннели</p>
            <button type="button" className="btn" disabled={busy || data.wallet.dollars < p.priceDollars} onClick={() => onBuy(kind)}>Купить за {p.priceDollars} $</button>
          </article>
        })}
      </div>
    </section>
  )
}

function MyHome({ data, busy, onTunnel, onRepair, onBuy, onGo }: {
  data: HousingView; busy: boolean
  onTunnel: (code: 'pvp' | 'industrial' | 'farm') => void; onRepair: () => void; onBuy: (kind: HomeKind) => void; onGo: (to: string) => void
}) {
  const home = data.home!
  const Icon = KIND_ICON[home.kind]
  const repairCost = Math.ceil((100 - home.durability) / 10) * data.repairPer10
  const upgrade = home.kind === 'APARTMENT' ? data.prices.HOUSE.priceDollars - data.prices.APARTMENT.priceDollars : 0
  return (
    <section className="housing__block">
      <h3><Icon size={16} /> {home.kind === 'HOUSE' ? 'Ваш дом' : 'Ваша квартира'}</h3>
      <dl className="housing__facts">
        <div><dt>Прочность</dt><dd>
          <span className="housing__bar"><i style={{ width: `${home.durability}%` }} /></span> {home.durability}%
        </dd></div>
        <div><dt>Опыт за бой</dt><dd>{home.bonusActive ? `+${pct(home.bonus)}%` : 'не действует — дом разбит, нужен ремонт'}</dd></div>
      </dl>
      <div className="housing__actions">
        <button type="button" className="btn" onClick={() => onGo('/inventory')}><Package size={13} /> Склад</button>
        {home.durability < 100 && <button type="button" className="btn" disabled={busy || data.wallet.money < repairCost} onClick={onRepair}>
          <Hammer size={13} /> Ремонт за {repairCost.toLocaleString('ru')} ₽</button>}
        {upgrade > 0 && <button type="button" className="btn" disabled={busy || data.wallet.dollars < upgrade} onClick={() => onBuy('HOUSE')}>
          <Home size={13} /> Переехать в дом (+{upgrade} $)</button>}
      </div>
      <h4 className="housing__sub">Туннели из дома</h4>
      <div className="housing__actions">
        {data.tunnels.map(t => home.tunnels.includes(t.code)
          ? <button key={t.code} type="button" className="btn" onClick={() => onGo(t.to)}><Shovel size={13} /> Пройти {t.where}</button>
          : <button key={t.code} type="button" className="btn btn-ghost" disabled={busy || data.wallet.dollars < data.tunnelPrice} onClick={() => onTunnel(t.code)}>
              <Shovel size={13} /> Прорыть ход {t.where} — {data.tunnelPrice} $</button>)}
      </div>
      <p className="housing__muted">В доме на вас напасть нельзя. Напасть можно на сам дом: бой идёт со сторожем, победа нападавшего снимает {10}% прочности.</p>
      {home.raids.length > 0 && <>
        <h4 className="housing__sub">Налёты на ваш дом</h4>
        <ul className="housing__raids">{home.raids.map((r, i) => <li key={i}>
          {new Date(r.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.attacker} · {r.won ? 'сторож проиграл, −10%' : 'сторож отбился'}
        </li>)}</ul>
      </>}
    </section>
  )
}
