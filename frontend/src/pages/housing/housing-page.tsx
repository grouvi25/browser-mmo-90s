// =============================================================
// Жилой сектор (правка заказчика 21.10.2026): квартира или дом за доллары,
// прибавка к опыту за бой, вход на склад из дома, туннели на Стрелки,
// Промзону и Фермы, налёты на чужие дома (бой со сторожем, −10% прочности).
//
// Жильё стоит заранее: план сектора — две многоэтажки по 8 квартир и улица
// из 8 домов. Свободный участок покупается, по чужому — налёт.
// =============================================================
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Home, Building2, Hammer, Package, Shovel, Swords } from 'lucide-react'
import { housingApi, type HomeKind, type HousingLot, type HousingView } from '../../shared/api/housing.api'
import { SCENES } from '../../shared/ui/sprite'
import './housing.css'

const pct = (share: number) => Math.round(share * 100)
const KIND_ICON: Record<HomeKind, typeof Home> = { APARTMENT: Building2, HOUSE: Home }
const FLATS_PER_BLOCK = 8
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function HousingPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const query = useQuery({ queryKey: ['housing'], queryFn: housingApi.view })
  const done = (text: string) => { setMsg({ text, bad: false }); void qc.invalidateQueries({ queryKey: ['housing'] }); void qc.invalidateQueries({ queryKey: ['character'] }) }
  const fail = (e: Error) => setMsg({ text: e.message, bad: true })

  const buy = useMutation({ mutationFn: housingApi.buy, onSuccess: r => { setPicked(null); done(`Жильё ваше. Списано ${r.cost} $.`) }, onError: fail })
  const tunnel = useMutation({ mutationFn: housingApi.tunnel, onSuccess: () => done('Туннель прорыт.'), onError: fail })
  const repair = useMutation({ mutationFn: housingApi.repair, onSuccess: r => done(`Отремонтировано за ${r.cost.toLocaleString('ru')} ₽.`), onError: fail })
  const raid = useMutation({ mutationFn: housingApi.raid, onSuccess: r => navigate(`/battle/${r.battleId}`), onError: fail })
  const busy = buy.isPending || tunnel.isPending || repair.isPending || raid.isPending

  const data = query.data
  const lot = data && picked ? data.lots[picked - 1] : null

  return (
    <div className="housing">
      <img className="brigade-scene" src={SCENES.housing} alt="Жилой сектор" draggable={false} />
      {msg && <p className={'housing__msg' + (msg.bad ? ' is-bad' : '')} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      {query.isLoading && <p role="status">Загрузка…</p>}
      {query.isError && <p role="alert">Сектор не загрузился. <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Повторить</button></p>}
      {data && <>
        {data.home && <MyHome data={data} busy={busy} onTunnel={code => tunnel.mutate(code)} onRepair={() => repair.mutate()} onGo={to => navigate(to)} />}
        <section className="housing__block">
          <h3>План сектора</h3>
          <SectorPlan lots={data.lots} picked={picked} onPick={setPicked} />
          {lot
            ? <LotCard lot={lot} data={data} busy={busy} onBuy={() => buy.mutate(lot.lot)} onRaid={id => raid.mutate(id)} />
            : <p className="housing__muted">{data.home ? 'Выберите чужое жильё для налёта.' : `Выберите свободное жильё. Покупка только за доллары, у вас ${data.wallet.dollars} $.`}</p>}
        </section>
      </>}
    </div>
  )
}

/** Две многоэтажки и улица домов; каждый участок — кнопка. */
function SectorPlan({ lots, picked, onPick }: { lots: HousingLot[]; picked: number | null; onPick: (lot: number) => void }) {
  const flats = lots.filter(l => l.kind === 'APARTMENT')
  const houses = lots.filter(l => l.kind === 'HOUSE')
  const blocks = Array.from({ length: Math.ceil(flats.length / FLATS_PER_BLOCK) }, (_, i) => flats.slice(i * FLATS_PER_BLOCK, (i + 1) * FLATS_PER_BLOCK))
  const cell = (l: HousingLot) => {
    const state = !l.home ? 'free' : l.home.mine ? 'mine' : 'taken'
    return (
      <button
        key={l.lot} type="button"
        className={`housing-lot housing-lot--${state}` + (picked === l.lot ? ' is-picked' : '')}
        aria-pressed={picked === l.lot}
        aria-label={`${l.label}: ${!l.home ? 'свободно' : l.home.mine ? 'ваше' : l.home.owner}`}
        onClick={() => onPick(l.lot)}
      >
        <b>{l.label}</b>
        <span>{!l.home ? 'свободно' : l.home.mine ? 'ваше' : l.home.owner}</span>
      </button>
    )
  }
  return (
    <div className="housing-plan">
      <div className="housing-plan__blocks">
        {blocks.map((block, i) => (
          <div key={i} className="housing-plan__block">
            <div className="housing-plan__roof">Многоэтажка {i + 1}</div>
            {/* Верхний этаж — сверху: квартиры идут снизу вверх, как в подъезде. */}
            <div className="housing-plan__floors">{[...block].reverse().map(cell)}</div>
          </div>
        ))}
      </div>
      <div className="housing-plan__street">
        <div className="housing-plan__roof">Частные дома</div>
        <div className="housing-plan__houses">{houses.map(cell)}</div>
      </div>
    </div>
  )
}

function LotCard({ lot, data, busy, onBuy, onRaid }: {
  lot: HousingLot; data: HousingView; busy: boolean; onBuy: () => void; onRaid: (homeId: string) => void
}) {
  const p = data.prices[lot.kind]
  const Icon = KIND_ICON[lot.kind]
  const kindName = p.name.toLowerCase()
  if (!lot.home) {
    const mine = data.home
    // Квартиру можно сменить на дом доплатой; вторую квартиру или из дома — нельзя.
    const blocked = mine && (mine.kind === 'HOUSE' || lot.kind === 'APARTMENT')
    const cost = mine && !blocked ? p.priceDollars - data.prices[mine.kind].priceDollars : p.priceDollars
    return (
      <article className="housing__offer">
        <h4><Icon size={16} /> {lot.label} · {kindName}, свободно</h4>
        <p>+{pct(p.expBonus)}% к опыту за бой · вход на склад · туннели</p>
        {blocked
          ? <p className="housing__muted">{mine.kind === 'HOUSE' ? 'У вас уже есть дом.' : 'У вас уже есть квартира, переехать можно только в дом.'}</p>
          : <button type="button" className="btn" disabled={busy || data.wallet.dollars < cost} onClick={onBuy}>
              {mine ? `Переехать за ${cost} $` : `Купить за ${cost} $`}</button>}
      </article>
    )
  }
  if (lot.home.mine) {
    return <article className="housing__offer"><h4><Icon size={16} /> {lot.label} · ваше жильё</h4></article>
  }
  const wait = lot.home.canRaidAt && new Date(lot.home.canRaidAt).getTime() > Date.now()
  return (
    <article className="housing__offer">
      <h4><Icon size={16} /> {lot.label} · {kindName}</h4>
      <p>Хозяин <b>{lot.home.owner}</b>, ур. {lot.home.ownerLevel} · прочность {lot.home.durability}%</p>
      <button type="button" className="btn" disabled={busy || !!wait} onClick={() => onRaid(lot.home!.id)}
        title={wait ? `Снова — после ${when(lot.home.canRaidAt!)}` : 'Бой со сторожем дома'}>
        <Swords size={13} /> {wait ? `Уже нападали, снова после ${when(lot.home.canRaidAt!)}` : 'Напасть'}
      </button>
    </article>
  )
}

function MyHome({ data, busy, onTunnel, onRepair, onGo }: {
  data: HousingView; busy: boolean
  onTunnel: (code: 'pvp' | 'industrial' | 'farm') => void; onRepair: () => void; onGo: (to: string) => void
}) {
  const home = data.home!
  const Icon = KIND_ICON[home.kind]
  const repairCost = Math.ceil((100 - home.durability) / 10) * data.repairPer10
  return (
    <section className="housing__block">
      <h3><Icon size={16} /> {home.kind === 'HOUSE' ? 'Ваш дом' : 'Ваша квартира'}{home.label && ` · ${home.label}`}</h3>
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
      </div>
      {home.kind === 'APARTMENT' && <p className="housing__muted">Переехать в дом можно доплатой: выберите свободный дом на плане.</p>}
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
          {when(r.at)} · {r.attacker} · {r.won ? 'сторож проиграл, −10%' : 'сторож отбился'}
        </li>)}</ul>
      </>}
    </section>
  )
}
