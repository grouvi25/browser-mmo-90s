// =============================================================
// Дома бригад: общий список домов и осады.
//
// Правка заказчика (октябрь 2026): бригады — квадратиками, на дома можно
// нападать «как в Королях». Уточнение 22.10: осаду объявляют главарь или
// зам, бой ровно через 72 часа, нападения — раз в неделю, до 10 на сторону;
// взятый дом теряет прочность и стоит разгромленным, гости пишут на стене.
// =============================================================
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { charactersApi } from '../../shared/api/characters.api'
import { clansApi, type BrigadeHouse } from '../../shared/api/clans.api'
import { ApiError } from '../../shared/api/client'
import { ClanSection } from '../stage3/clan-section'
import { IncomingInvites } from '../stage3/clan-invites'
import { plural } from '../../shared/lib/plural'
import { SCENES } from '../../shared/ui/sprite'

const msk = (iso: string | Date) => new Date(iso).toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

/** Правка заказчика 21.10 (образец — «Замки кланов» в «5 королях»):
    картинка района, под ней кнопки «К дому …» всех бригад. Своя
    открывает управление бригадой, чужая — её дом: осада, стена. */
export function BrigadeHouses() {
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const list = useQuery({ queryKey: ['clans', 'list'], queryFn: clansApi.list, refetchInterval: 30_000 })
  const [pickedOther, setPickedOther] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const mine = me.data?.clan?.id ?? null
  // Своя бригада — в адресе (?brigade=mine): по нему внизу появляются её вкладки.
  const ownOpen = params.get('brigade') === 'mine' && !!mine
  const picked = ownOpen ? mine : pickedOther
  const setPicked = (id: string | null) => {
    if (id && id === mine) { setPickedOther(null); setParams({ brigade: 'mine' }) }
    else { setPickedOther(id); if (params.has('brigade')) setParams({}) }
  }
  const clans = list.data?.items ?? []
  const now = Date.now()

  if (picked) {
    const clan = clans.find(c => c.id === picked)
    return <>
      <button type="button" className="btn btn-sm brigade-back" onClick={() => setPicked(null)}>← К списку домов</button>
      {picked === mine && <h2 className="brigade-own-title">Ваша бригада{clan ? ` «${clan.name}»` : ''}</h2>}
      <House id={picked} />
      {picked === mine && <ClanSection embedded />}
    </>
  }

  return <>
    <img className="brigade-scene" src={SCENES['brigade-houses']} alt="Дома бригад" draggable={false} />
    {list.isLoading && <p role="status">Загрузка…</p>}
    {list.isError && <p role="alert">Список не загрузился. <button className="btn" onClick={() => list.refetch()}>Повторить</button></p>}
    {list.data && clans.length === 0 && <p>В городе пока нет бригад. Зарегистрировать свою можно в <Link to="/city-hall">Мэрии</Link>.</p>}
    <nav className="brigade-doors" aria-label="Дома бригад">{clans.map(clan => {
      const razed = !!clan.houseRazedUntil && new Date(clan.houseRazedUntil).getTime() > now
      const note = clan.id === mine ? 'ваша' : razed ? 'разгромлен'
        : clan.siege ? (clan.siege.status === 'IN_BATTLE' ? 'идёт осада' : `осада ${msk(clan.siege.startsAt)}`) : ''
      return <button type="button" key={clan.id} className={'brigade-door' + (clan.id === mine ? ' is-mine' : '')}
        title={`${clan._count?.members ?? 0} ${plural(clan._count?.members ?? 0, ['боец', 'бойца', 'бойцов'])} · дом ${clan.houseDurability ?? 100}%`}
        onClick={() => setPicked(clan.id)}>
        <ClanIcon clan={clan} />
        <span>{clan.id === mine ? 'Резиденция' : 'К дому'} «{clan.name}»</span>
        {note && <small>{note}</small>}
      </button>
    })}</nav>
    {!mine && <IncomingInvites />}
    {!mine && list.data && <p><Link to="/city-hall">Зарегистрировать свою бригаду в Мэрии →</Link></p>}
  </>
}

/** Иконка бригады (загружает глава); без неё — ничего. */
export function ClanIcon({ clan, size = 18 }: { clan: { id: string; iconVersion?: number | null }; size?: number }) {
  if (!clan.iconVersion) return null
  return <img className="clan-icon" src={clansApi.iconUrl(clan.id, clan.iconVersion)} alt="" width={size} height={size} />
}

function House({ id }: { id: string }) {
  const qc = useQueryClient()
  const house = useQuery({ queryKey: ['clans', 'house', id], queryFn: () => clansApi.house(id), refetchInterval: 30_000 })
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const done = (text: string) => {
    setMessage({ ok: true, text })
    void qc.invalidateQueries({ queryKey: ['clans'] })
  }
  const fail = (err: unknown) => setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Не получилось' })
  const action = useMutation({
    mutationFn: ({ siegeId, kind }: { siegeId: string; kind: 'signup' | 'unsign' | 'cancel' }) => clansApi.siegeAction(siegeId, kind),
    onSuccess: (_, v) => done(v.kind === 'signup' ? 'Вы записаны на осаду' : v.kind === 'unsign' ? 'Вы выписались' : 'Осада снята'),
    onError: fail,
  })
  const repair = useMutation({ mutationFn: clansApi.repairHouse, onSuccess: r => done(`Дом починен за ${r.cost.toLocaleString('ru')} ₽`), onError: fail })

  if (house.isLoading) return <p role="status">Загрузка дома…</p>
  if (house.isError || !house.data) return <p role="alert">Дом не загрузился. <button className="btn" onClick={() => house.refetch()}>Повторить</button></p>
  const h = house.data
  const siege = h.siege
  const busy = action.isPending || repair.isPending

  return <section className="house-card" aria-label={`Дом бригады ${h.name}`}>
    <header className="house-card__head">
      <h2>Дом бригады «{h.name}»</h2>
      <span>ур. {h.level}</span>
    </header>
    {message && <p className={`alert ${message.ok ? 'alert-success' : 'alert-error'}`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

    <div className="house-card__state">
      <div className="house-durability" aria-label={`Прочность дома ${h.durability}%`}>
        <span>Прочность</span><b>{h.durability}%</b>
        <span className="house-durability__bar"><i style={{ width: `${h.durability}%` }} /></span>
      </div>
      {h.razedUntil
        ? <p className="house-card__warn">Дом разгромлен до {msk(h.razedUntil)} по Москве: бонусы района не действуют, гости пишут на стене.</p>
        : h.bonusesOff && <p className="house-card__warn">Прочность 50% и ниже: бонусы района выключены до ремонта.</p>}
      {h.canRepair && <button className="btn" disabled={busy} onClick={() => repair.mutate()}>
        Починить дом за {h.repairCost.toLocaleString('ru')} ₽ из общака
      </button>}
    </div>

    {siege ? <SiegeBlock siege={siege} title={siege.status === 'IN_BATTLE' ? 'Идёт осада этого дома' : 'Дом в осаде'} busy={busy}
        onAction={(siegeId, kind) => action.mutate({ siegeId, kind })} />
      : !h.isMine && <SiegeForm house={h} onDone={done} onFail={fail} />}
    {h.outgoing && <SiegeBlock siege={h.outgoing} title={h.outgoing.status === 'IN_BATTLE' ? 'Бригада штурмует чужой дом' : 'Бригада объявила осаду'} busy={busy}
      onAction={(siegeId, kind) => action.mutate({ siegeId, kind })} />}

    {(h.wall.length > 0 || h.canWrite) && <div className="house-wall">
      <h3>Стена в прихожей</h3>
      {h.wall.length === 0 && <p className="muted">Пока пусто.</p>}
      <ul>{h.wall.map(note => <li key={note.id}><b>{note.author}:</b> {note.text} <i>{msk(note.createdAt)}</i></li>)}</ul>
      {h.canWrite && <WallForm clanId={h.id} onDone={done} onFail={fail} />}
    </div>}

    {/* Свой состав с должностями показывает управление бригадой ниже —
        второй список здесь был бы повтором (правка заказчика 22.10). */}
    {!h.isMine && <div className="house-members">
      <h3>Состав · {h.members.length}</h3>
      <ul>{h.members.map(m => <li key={m.id}>
        <Link to={`/u/${encodeURIComponent(m.nickname)}`}>{m.nickname}</Link> <i>{m.battleLevel} ур. · {m.role}</i>
      </li>)}</ul>
    </div>}
  </section>
}

type Siege = NonNullable<BrigadeHouse['siege']>
function SiegeBlock({ siege, title, busy, onAction }: {
  siege: Siege; title: string; busy: boolean; onAction: (siegeId: string, kind: 'signup' | 'unsign' | 'cancel') => void
}) {
  return <div className="house-siege">
    <h3>{title}</h3>
    <p>
      «{siege.attacker?.name}» осаждает дом «{siege.defender?.name}».
      {' '}{siege.status === 'IN_BATTLE' ? 'Бой идёт.' : `Начало ${msk(siege.startsAt)} по Москве.`}
    </p>
    <div className="house-siege__sides">
      <div><b>Нападение · записались {siege.attackers.length}</b>
        <ul>{siege.attackers.map(f => <li key={f.id}>{f.nickname} <i>{f.battleLevel} ур.</i></li>)}</ul></div>
      <div><b>Оборона · записались {siege.defenders.length}</b>
        <ul>{siege.defenders.map(f => <li key={f.id}>{f.nickname} <i>{f.battleLevel} ур.</i></li>)}</ul>
        <small>В оборону войдут и все остальные бойцы бригады, кто к началу будет в игре и свободен.</small></div>
    </div>
    <p className="house-siege__hint">В бой попадают те, кто в момент начала в игре и ничем не занят. Запись не держит: до начала можно драться и работать.</p>
    {siege.status === 'SCHEDULED' && siege.mySide && <div className="house-siege__actions">
      {siege.signedUp
        ? <button className="btn" disabled={busy} onClick={() => onAction(siege.id, 'unsign')}>Выписаться</button>
        : <button className="btn btn-primary" disabled={busy} onClick={() => onAction(siege.id, 'signup')}>
            {siege.mySide === 1 ? 'Записаться в нападение' : 'Записаться в оборону'}
          </button>}
      {siege.canCancel && <button className="btn" disabled={busy} onClick={() => onAction(siege.id, 'cancel')}>Снять осаду</button>}
    </div>}
    {siege.status === 'IN_BATTLE' && siege.battleId && siege.mySide && <Link to={`/battle/${siege.battleId}`}>К бою →</Link>}
  </div>
}

function SiegeForm({ house, onDone, onFail }: { house: BrigadeHouse; onDone: (text: string) => void; onFail: (e: unknown) => void }) {
  const r = house.rules
  const file = useMutation({
    mutationFn: () => clansApi.fileSiege(house.id),
    onSuccess: r => onDone(`Осада объявлена на ${msk(r.startsAt)} по Москве. Город узнает об этом из объявлений.`),
    onError: onFail,
  })
  if (!house.canFile) return <p className="house-siege__blocked">Осада: {house.fileBlocked}</p>
  return <div className="house-siege house-siege--form">
    <h3>Объявить осаду</h3>
    <p>
      Бой — ровно через {r.leadHours} ч после заявки. В нападение и в оборону записываются до {r.maxPerSide} бойцов.
      Возьмёте дом — он потеряет {r.durabilityLoss}% прочности и {r.razedDays} суток простоит разгромленным.
      Отобьются — все нападавшие получат кровавую травму на {r.traumaHours} ч.
      Нападать можно раз в неделю: следующую осаду бригада объявит через {r.cooldownDays} суток, и на этот дом столько же никто не нападёт.
    </p>
    <div className="house-siege__fields">
      <button type="button" className="btn btn-primary" disabled={file.isPending}
        onClick={() => { if (window.confirm(`Объявить осаду дома «${house.name}»? Бой начнётся через ${r.leadHours} ч.`)) file.mutate() }}>
        {file.isPending ? 'Объявляем…' : 'Объявить осаду'}
      </button>
    </div>
  </div>
}

function WallForm({ clanId, onDone, onFail }: { clanId: string; onDone: (text: string) => void; onFail: (e: unknown) => void }) {
  const [text, setText] = useState('')
  const write = useMutation({
    mutationFn: () => clansApi.writeOnWall(clanId, text.trim()),
    onSuccess: () => { setText(''); onDone('Надпись оставлена') },
    onError: onFail,
  })
  return <form className="house-wall__form" onSubmit={e => { e.preventDefault(); if (text.trim()) write.mutate() }}>
    <label htmlFor="wall-text" className="visually-hidden">Надпись на стене</label>
    <input id="wall-text" value={text} maxLength={200} placeholder="Надпись на стене, до 200 знаков" onChange={e => setText(e.target.value)} />
    <button className="btn" disabled={write.isPending || !text.trim()}>Написать</button>
  </form>
}
