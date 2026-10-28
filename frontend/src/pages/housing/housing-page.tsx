// =============================================================
// Жилой сектор (правка заказчика 21.10.2026): квартира или дом за доллары,
// прибавка к опыту за бой, вход на склад из дома, туннели на Стрелки,
// Промзону и Фермы, налёты на чужие дома (−10% прочности).
//
// Жильё стоит заранее: план сектора — две многоэтажки по 8 квартир и улица
// из 8 домов. Свободный участок покупается, по чужому — налёт.
//
// Уточнение 22.10: налёт — заявка и бой ровно через 72 часа, до 10 человек
// в нападение и до 10 в оборону, на дом раз в неделю; из туннеля можно
// вернуться в дом тем же туннелем (вкладка «В дом» внизу); у жилья свой
// склад — ящики, которых не видно из центра; квартира даёт только опыт и
// склад, туннели — только у дома.
// =============================================================
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Home, Building2, Hammer, Package, Shovel, Swords } from 'lucide-react'
import { housingApi, type HomeKind, type HomeRaid, type HousingLot, type HousingView } from '../../shared/api/housing.api'
import { resourcesApi } from '../../shared/api/resources.api'
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
  const fileRaid = useMutation({ mutationFn: housingApi.fileRaid, onSuccess: r => done(`Налёт объявлен: бой ${when(r.startsAt)} по Москве. Записывайтесь в нападение.`), onError: fail })
  const raidAction = useMutation({
    mutationFn: ({ raidId, side }: { raidId: string; side: 1 | 2 | null }) => side ? housingApi.signupRaid(raidId, side) : housingApi.unsignRaid(raidId),
    onSuccess: (_r, v) => done(v.side === 1 ? 'Вы в нападении.' : v.side === 2 ? 'Вы в обороне.' : 'Вы выписались.'),
    onError: fail,
  })
  const go = useMutation({ mutationFn: housingApi.go, onSuccess: r => { void qc.invalidateQueries({ queryKey: ['housing', 'exit'] }); navigate(r.to) }, onError: fail })
  const busy = buy.isPending || tunnel.isPending || repair.isPending || fileRaid.isPending || raidAction.isPending || go.isPending

  const data = query.data
  const lot = data && picked ? data.lots[picked - 1] : null
  // Правка заказчика 28.10: при входе — картинка и список жилья, управление
  // своим открывается только по нажатию на него, а не висит сверху сразу.
  const myLot = data?.lots.find(l => l.home?.mine) ?? null

  return (
    <div className="housing">
      <img className="brigade-scene" src={SCENES.housing} alt="Жилой сектор" draggable={false} />
      {msg && <p className={'housing__msg' + (msg.bad ? ' is-bad' : '')} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      {query.isLoading && <p role="status">Загрузка…</p>}
      {query.isError && <p role="alert">Сектор не загрузился. <button type="button" className="btn btn-sm" onClick={() => void query.refetch()}>Повторить</button></p>}
      {data && <>
        <section className="housing__block">
          <h3>Недвижимость</h3>
          {myLot && (
            <div className="housing__actions">
              <button type="button" className="btn" aria-pressed={picked === myLot.lot} onClick={() => setPicked(myLot.lot)}>
                <Home size={13} /> Моё жильё · {myLot.label}
              </button>
            </div>
          )}
          <SectorPlan lots={data.lots} picked={picked} onPick={setPicked} />
          {lot && lot.home?.mine && data.home
            ? <MyHome data={data} busy={busy} onTunnel={code => tunnel.mutate(code)} onRepair={() => repair.mutate()} onGo={to => navigate(to)} onWalk={code => go.mutate(code)} />
            : lot
              ? <LotCard lot={lot} data={data} busy={busy} onBuy={() => buy.mutate(lot.lot)} onRaid={id => fileRaid.mutate(id)}
                  onSide={(raidId, side) => raidAction.mutate({ raidId, side })} />
              : <p className="housing__muted">{data.home ? 'Нажмите на своё жильё, чтобы им управлять, или на чужое — для налёта.' : `Выберите свободное жильё. Покупка только за доллары, у вас ${data.wallet.dollars} $.`}</p>}
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

function LotCard({ lot, data, busy, onBuy, onRaid, onSide }: {
  lot: HousingLot; data: HousingView; busy: boolean; onBuy: () => void; onRaid: (homeId: string) => void
  onSide: (raidId: string, side: 1 | 2 | null) => void
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
        <p>+{pct(p.expBonus)}% к опыту за бой · {data.storageBoxes[lot.kind]} ящиков склада{data.tunnelKinds.includes(lot.kind) ? ' · туннели' : ''}</p>
        {blocked
          ? <p className="housing__muted">{mine.kind === 'HOUSE' ? 'У вас уже есть дом.' : 'У вас уже есть квартира, переехать можно только в дом.'}</p>
          : <button type="button" className="btn" disabled={busy || data.wallet.dollars < cost} onClick={onBuy}>
              {mine ? `Переехать за ${cost} $` : `Купить за ${cost} $`}</button>}
      </article>
    )
  }
  const r = data.raidRules
  const home = lot.home
  return (
    <article className="housing__offer">
      <h4><Icon size={16} /> {lot.label} · {kindName}</h4>
      <p>Хозяин <b>{home.owner}</b>, ур. {home.ownerLevel} · прочность {home.durability}%</p>
      {home.raid
        ? <RaidBlock raid={home.raid} busy={busy} onSide={onSide} max={r.maxPerSide} />
        : home.raidBlocked
          ? <p className="housing__muted">Налёт: {home.raidBlocked}</p>
          : <>
              <p className="housing__muted">Налёт: бой ровно через {r.leadHours} ч после заявки, до {r.maxPerSide} человек в нападение и в оборону. Победа снимает {r.durabilityLoss}% прочности; на дом — раз в неделю.</p>
              <button type="button" className="btn" disabled={busy}
                onClick={() => { if (window.confirm(`Объявить налёт на ${lot.label.toLowerCase()} (${home.owner})? Бой через ${r.leadHours} ч.`)) onRaid(home.id) }}>
                <Swords size={13} /> Объявить налёт
              </button>
            </>}
    </article>
  )
}

/** Объявленный налёт: время, кто записан, кнопки записи. */
function RaidBlock({ raid, busy, onSide, max }: {
  raid: HomeRaid; busy: boolean; max: number; onSide: (raidId: string, side: 1 | 2 | null) => void
}) {
  return (
    <div className="housing-raid">
      <p className="housing-raid__when">
        <Swords size={13} /> {raid.status === 'IN_BATTLE' ? 'Идёт бой.' : `Налёт: бой ${when(raid.startsAt)} по Москве.`}
      </p>
      <div className="housing-raid__sides">
        <div><b>Нападение · {raid.attackers.length}/{max}</b><ul>{raid.attackers.map(f => <li key={f.id}>{f.nickname} <i>{f.battleLevel} ур.</i></li>)}</ul></div>
        <div><b>Оборона · {raid.defenders.length}/{max}</b><ul>{raid.defenders.map(f => <li key={f.id}>{f.nickname} <i>{f.battleLevel} ур.</i></li>)}</ul></div>
      </div>
      {raid.status === 'PENDING' && (
        <div className="housing__actions">
          {raid.mySide === null && <>
            <button type="button" className="btn" disabled={busy || raid.attackers.length >= max} onClick={() => onSide(raid.id, 1)}>В нападение</button>
            <button type="button" className="btn" disabled={busy || raid.defenders.length >= max} onClick={() => onSide(raid.id, 2)}>В оборону</button>
          </>}
          {raid.canUnsign && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSide(raid.id, null)}>Выписаться</button>}
        </div>
      )}
      {raid.status === 'IN_BATTLE' && raid.battleId && raid.canEnterBattle && <Link to={`/battle/${raid.battleId}`}>К бою →</Link>}
      {raid.status === 'IN_BATTLE' && raid.mySide && !raid.canEnterBattle && <p className="housing__muted">Вы не попали в бой: к старту были офлайн, заняты или травмированы.</p>}
      <p className="housing__muted">В бой попадают те, кто к началу в игре и свободен. Оборона не вышла — дом взят без боя.</p>
    </div>
  )
}

function MyHome({ data, busy, onTunnel, onRepair, onGo, onWalk }: {
  data: HousingView; busy: boolean
  onTunnel: (code: 'pvp' | 'industrial' | 'farm') => void; onRepair: () => void; onGo: (to: string) => void
  onWalk: (code: 'pvp' | 'industrial' | 'farm') => void
}) {
  const home = data.home!
  const Icon = KIND_ICON[home.kind]
  const repairCost = Math.ceil((100 - home.durability) / 10) * data.repairPer10
  return (
    <section className="housing__mine">
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
      <HomeStorage />
      {data.tunnelKinds.includes(home.kind) ? <>
        <h4 className="housing__sub">Туннели из дома</h4>
        <div className="housing__actions">
          {data.tunnels.map(t => home.tunnels.includes(t.code)
            ? <button key={t.code} type="button" className="btn" disabled={busy} onClick={() => onWalk(t.code)}><Shovel size={13} /> Пройти {t.where}</button>
            : <button key={t.code} type="button" className="btn btn-ghost" disabled={busy || data.wallet.dollars < data.tunnelPrice} onClick={() => onTunnel(t.code)}>
                <Shovel size={13} /> Прорыть ход {t.where} — {data.tunnelPrice} $</button>)}
        </div>
      </> : <p className="housing__muted">Туннели роют только из дома: квартира даёт опыт и склад.</p>}
      <p className="housing__muted">В доме на вас напасть нельзя. Напасть можно на сам дом: налёт объявляют за {data.raidRules.leadHours} ч, вы в обороне, зовите своих — до {data.raidRules.maxPerSide} человек. Победа нападавших снимает {data.raidRules.durabilityLoss}% прочности.</p>
      {home.raid && <><h4 className="housing__sub">Налёт на ваш дом</h4><RaidBlock raid={home.raid} busy={busy} onSide={() => undefined} max={data.raidRules.maxPerSide} /></>}
      {home.raids.length > 0 && <>
        <h4 className="housing__sub">Налёты на ваш дом</h4>
        <ul className="housing__raids">{home.raids.map((r, i) => <li key={i}>
          {when(r.at)} · {r.attacker} · {r.won ? 'сторож проиграл, −10%' : 'сторож отбился'}
        </li>)}</ul>
      </>}
    </section>
  )
}

/** Ящики в доме (правка заказчика 22.10): сюда выгружают ресурсы, из
    центра этот склад не виден. Ящик — один вид ресурса. */
function HomeStorage() {
  const qc = useQueryClient()
  const box = useQuery({ queryKey: ['housing', 'storage'], queryFn: housingApi.storage })
  const mine = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState(1)
  const [error, setError] = useState('')
  const move = useMutation({
    mutationFn: (v: { put: boolean; code: string; amount: number }) => v.put ? housingApi.storagePut(v.code, v.amount) : housingApi.storageTake(v.code, v.amount),
    onSuccess: () => { setError(''); void qc.invalidateQueries({ queryKey: ['housing', 'storage'] }); void qc.invalidateQueries({ queryKey: ['resources'] }) },
    onError: (e: Error) => setError(e.message),
  })
  const own = (mine.data?.items ?? []).filter(s => s.availableAmount > 0)
  const items = box.data?.items ?? []
  return (
    <>
      <h4 className="housing__sub"><Package size={14} /> Ящики в доме {box.data && `· занято ${items.length} из ${box.data.boxes}`}</h4>
      <p className="housing__muted">Дополнительный склад: из центра его не видно. В ящик — один вид ресурса, до {box.data?.boxCapacity ?? 100} штук.</p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {items.length > 0 && <ul className="housing__boxes">{items.map(i => <li key={i.code}>
        <span>{i.name}</span><b>{i.amount}</b>
        <button type="button" className="btn btn-sm" disabled={move.isPending} onClick={() => move.mutate({ put: false, code: i.code, amount: i.amount })}>Забрать всё</button>
      </li>)}</ul>}
      <form className="housing__actions" onSubmit={e => { e.preventDefault(); if (code) move.mutate({ put: true, code, amount }) }}>
        <select value={code} onChange={e => setCode(e.target.value)} aria-label="Ресурс со склада">
          <option value="">Что выгрузить…</option>
          {own.map(s => <option key={s.id} value={s.template.code}>{s.template.name} ({s.availableAmount})</option>)}
        </select>
        <input type="number" min={1} max={1000} value={amount} aria-label="Сколько" onChange={e => setAmount(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
        <button type="submit" className="btn" disabled={!code || move.isPending}>Выгрузить в ящик</button>
      </form>
    </>
  )
}
