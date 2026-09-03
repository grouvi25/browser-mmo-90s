// =============================================================
// Карта территорий — шесть районов города как объект владения.
//
// Главное на экране не бонус, а ПРИЧИНА ОТКАЗА. Проверок у заявки восемь,
// и игрок обязан понимать, чего именно не хватает, не заглядывая в
// документацию. Причину считает сервер, клиент только показывает её
// словами: любое расхождение выглядело бы как сломанная кнопка.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, Swords, ShieldCheck, Clock, Users } from 'lucide-react'
import {
  territoriesApi, type TerritoryRow, type ClaimBlockedReason,
} from '../../shared/api/strategy.api'
import { fmt, remaining, Skeleton, Fault, Empty, Note } from '../stage3/stage3-ui'
import { useMyClan } from '../stage3/use-my-clan'
import { RosterPicker } from './roster-picker'

/** Причина отказа — словами. Требование раздела «Что появится в интерфейсе». */
const BLOCKED: Record<ClaimBlockedReason, string> = {
  NO_CLAN: 'вы не в бригаде',
  NO_PERMISSION: 'нет права на военные операции',
  PROTECTED: 'район под защитой после захвата',
  CONTESTED: 'на район уже подана заявка',
  LIMIT_REACHED: 'у бригады уже предел районов',
  NOT_ENOUGH_AUTHORITY: 'не хватает авторитета',
  NOT_ENOUGH_MONEY: 'в общаке не хватает денег',
  CLAN_COOLDOWN: 'бригада подавала заявку меньше суток назад',
  ALLY_OWNED: 'район у союзной бригады',
}

const STATUS_TEXT: Record<TerritoryRow['status'], string> = {
  NEUTRAL: 'ничей',
  CONTROLLED: 'под контролем',
  CONTESTED: 'подана заявка',
  UNDER_ATTACK: 'идёт бой',
  PROTECTED: 'под защитой',
}

export function TerritoryMapSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [openCode, setOpenCode] = useState('')

  // Какой район сейчас собирает состав: заявка или оборона.
  const [rosterFor, setRosterFor] = useState<{ code: string; mode: 'claim' | 'defence'; claimId?: string } | null>(null)

  const query = useQuery({
    queryKey: ['territories'],
    queryFn: territoriesApi.list,
    refetchInterval: 30_000,
  })
  // Состав собирается из бригады: сервер требует пятерых своих бойцов от
  // третьего уровня, и подставлять одного себя значило бы гарантированный
  // отказ на каждой заявке.
  const clan = useMyClan()
  const members = clan.clan?.members ?? []

  const finish = (text: string) => {
    setBad(false); setMsg(text); setRosterFor(null)
    void qc.invalidateQueries({ queryKey: ['territories'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const claim = useMutation({
    mutationFn: ({ code, roster }: { code: string; roster: string[] }) =>
      territoriesApi.claim(code, roster),
    onSuccess: () => finish('Заявка подана. Бой назначен, обороняющиеся уже видят ваш состав.'),
    onError: fail,
  })
  const defence = useMutation({
    mutationFn: ({ code, claimId, roster }: { code: string; claimId: string; roster: string[] }) =>
      territoriesApi.defence(code, claimId, roster),
    onSuccess: () => finish('Состав обороны выставлен.'),
    onError: fail,
  })

  if (query.isLoading) return <Skeleton rows={6} />
  if (query.isError) return <Fault retry={() => query.refetch()} />

  const items = query.data?.items ?? []
  const busy = claim.isPending || defence.isPending
  if (items.length === 0) {
    return <Empty title="Районов нет" hint="Карта районов ещё не заполнена сидом." />
  }

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <p className="s4-lead">
        Шесть районов города. Район даёт бонус всей бригаде, стоит содержания
        каждые сутки и берётся боем — до пяти на пять на обычном поле.
      </p>

      <div className="s4-map">
        {items.map(territory => {
          const mine = territory.owner !== null
          const open = openCode === territory.code
          const blocked = territory.myClan.blockedReason
          return (
            <article
              key={territory.code}
              className={`s4-district s4-district--${territory.status.toLowerCase()}`}
            >
              <header>
                <h3>{territory.name}</h3>
                <span className="s4-district__status">{STATUS_TEXT[territory.status]}</span>
              </header>

              <dl className="s4-district__facts">
                <div>
                  <dt>Владелец</dt>
                  <dd>{mine ? `[${territory.owner!.tag}] ${territory.owner!.name}` : '—'}</dd>
                </div>
                <div>
                  <dt>Бонус</dt>
                  {/* Строка приходит с сервера готовой: иначе клиент повторял
                      бы таблицу бонусов и расходился с ней при первой правке. */}
                  <dd>{territory.bonus.text}</dd>
                </div>
                <div>
                  <dt>Объектов в районе</dt>
                  <dd>{territory.objectCount}</dd>
                </div>
                {territory.protectedUntil && (
                  <div>
                    <dt><Clock size={12} /> Защита до</dt>
                    <dd>{remaining(territory.protectedUntil)}</dd>
                  </div>
                )}
              </dl>

              {territory.activeClaim && (
                <p className="s4-district__claim">
                  <Swords size={13} /> Заявка от [{territory.activeClaim.attackerTag}],
                  бой через {remaining(territory.activeClaim.battleStartsAt)}
                </p>
              )}

              <div className="s4-district__actions">
                <button
                  type="button"
                  disabled={!territory.myClan.canClaim || busy}
                  onClick={() => setRosterFor({ code: territory.code, mode: 'claim' })}
                >
                  <Flag size={13} /> Подать заявку
                </button>
                {/* Оборона своего района: состав выставляет владелец, и
                    только пока заявка ещё не ушла в бой. */}
                {mine && territory.owner!.clanId === clan.clan?.id && territory.activeClaim && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRosterFor({
                      code: territory.code, mode: 'defence', claimId: territory.activeClaim!.id,
                    })}
                  >
                    <Swords size={13} /> Выставить оборону
                  </button>
                )}
                <button type="button" className="s4-ghost" onClick={() => setOpenCode(open ? '' : territory.code)}>
                  {open ? 'Свернуть' : 'Подробнее'}
                </button>
              </div>

              {rosterFor?.code === territory.code && (
                <RosterPicker
                  members={members}
                  // У обороны нижней границы нет: выставить одного честнее,
                  // чем не выставить никого и получить техническое поражение.
                  minSize={rosterFor.mode === 'claim' ? 5 : 1}
                  busy={busy}
                  submitLabel={rosterFor.mode === 'claim' ? 'Подать заявку' : 'Выставить оборону'}
                  note={rosterFor.mode === 'claim'
                    ? 'Взнос 10 000 ₽ из общака не возвращается: иначе заявка стала бы бесплатной разведкой чужой обороны.'
                    : 'Состав закрывается за 10 минут до боя.'}
                  onCancel={() => setRosterFor(null)}
                  onSubmit={roster => rosterFor.mode === 'claim'
                    ? claim.mutate({ code: territory.code, roster })
                    : defence.mutate({ code: territory.code, claimId: rosterFor.claimId!, roster })}
                />
              )}

              {/* Почему нельзя — словами и всегда, а не тултипом на
                  выключенной кнопке: игрок должен понимать без наведения. */}
              {blocked && (
                <p className="s4-district__blocked">Нельзя: {BLOCKED[blocked]}</p>
              )}

              {open && <DistrictDetails code={territory.code} />}
            </article>
          )
        })}
      </div>
    </>
  )
}

/** Подробности района: объекты внутри и последние события. */
function DistrictDetails({ code }: { code: string }) {
  const card = useQuery({ queryKey: ['territory', code], queryFn: () => territoriesApi.card(code) })
  if (card.isLoading) return <Skeleton rows={2} />
  if (card.isError) return <Fault retry={() => card.refetch()} />
  const data = card.data
  if (!data) return null

  return (
    <div className="s4-district__details">
      {data.upkeep && (
        <p className="s4-upkeep">
          <ShieldCheck size={13} /> Содержание {fmt(data.upkeep.perDay)} ₽/сутки
          {data.upkeep.debt > 0 && <> · долг {fmt(data.upkeep.debt)} ₽</>}
          {data.upkeep.bonusSuspended && <strong> · бонус отключён за долг</strong>}
        </p>
      )}

      <h4><Users size={12} /> Объекты района</h4>
      {data.objects.length === 0
        ? <p className="s4-muted">В районе нет объектов.</p>
        : (
          <ul className="s4-list">
            {data.objects.map(object => (
              <li key={object.id}>
                <span>{object.name}</span>
                <span className="s4-muted">
                  {object.ownerTag ? `[${object.ownerTag}]` : 'государственный'}
                  {object.status === 'DAMAGED' && ' · повреждён'}
                </span>
              </li>
            ))}
          </ul>
        )}

      {data.history.length > 0 && (
        <>
          <h4>Последние события</h4>
          <ul className="s4-list s4-list--log">
            {data.history.map((row, index) => (
              <li key={index}>
                <span className="s4-muted">{new Date(row.at).toLocaleString('ru-RU')}</span>
                <span>{row.event} · [{row.clanTag}]</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
