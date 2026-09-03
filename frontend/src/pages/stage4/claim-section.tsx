// =============================================================
// Заявка на район: кто с кем и когда.
//
// Смысл экрана — показать состав ОБЕИХ сторон до боя. Это не удобство, а
// правило: внезапное нападение в асинхронной игре выигрывает тот, кто
// просто оказался онлайн, а не тот, кто лучше играет. Поэтому состав
// атакующего виден обороне с момента подачи, и наоборот.
//
// Второе, что экран обязан донести: что можно сделать прямо сейчас.
// Атакующий может отозвать заявку (взнос не вернётся), обороняющийся —
// выставить состав, пока не закрылось окно.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { Swords, Clock, ShieldAlert, Users } from 'lucide-react'
import { territoriesApi, type ClaimSide, type ClaimStatus } from '../../shared/api/strategy.api'
import { remaining, Skeleton, Fault, Note } from '../stage3/stage3-ui'
import { useMyClan } from '../stage3/use-my-clan'
import { RosterPicker } from './roster-picker'

const STATUS: Record<ClaimStatus, string> = {
  PENDING: 'заявка подана, бой назначен',
  BATTLE: 'бой идёт',
  WON: 'район взят',
  LOST: 'оборона выстояла',
  CANCELLED: 'заявка отозвана',
  EXPIRED: 'заявка истекла',
}

export function ClaimSection() {
  const { code = '', id = '' } = useParams()
  const qc = useQueryClient()
  const clan = useMyClan()
  const [picking, setPicking] = useState(false)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const query = useQuery({
    queryKey: ['claim', code, id],
    queryFn: () => territoriesApi.claimView(code, id),
    // Пока идёт отсчёт до боя, страница должна оживать сама: обороне важно
    // видеть, что состав атакующего изменился, не нажимая обновление.
    refetchInterval: 15_000,
  })

  const finish = (text: string) => {
    setBad(false); setMsg(text); setPicking(false)
    void qc.invalidateQueries({ queryKey: ['claim', code, id] })
    void qc.invalidateQueries({ queryKey: ['territories'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const defence = useMutation({
    mutationFn: (roster: string[]) => territoriesApi.defence(code, id, roster),
    onSuccess: () => finish('Состав обороны выставлен.'),
    onError: fail,
  })
  const cancel = useMutation({
    mutationFn: () => territoriesApi.cancelClaim(code, id),
    onSuccess: () => finish('Заявка отозвана. Взнос не возвращается.'),
    onError: fail,
  })

  if (query.isLoading) return <Skeleton rows={4} />
  if (query.isError) return <Fault retry={() => query.refetch()} />
  const claim = query.data
  if (!claim) return null

  const myTag = clan.clan?.tag
  const iAttack = myTag === claim.attacker.clanTag
  const iDefend = !!claim.defender && myTag === claim.defender.clanTag
  const live = claim.status === 'PENDING'
  const defenceSet = (claim.defender?.roster.length ?? 0) > 0
  const busy = defence.isPending || cancel.isPending

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <div className="s4-summary">
        <div className="s4-stat">
          <span className="s4-stat__label">Район</span>
          <b>{claim.territory.name}</b>
        </div>
        <div className="s4-stat">
          <span className="s4-stat__label">Состояние</span>
          <b>{STATUS[claim.status]}</b>
        </div>
        {live && (
          <div className="s4-stat">
            <span className="s4-stat__label"><Clock size={13} /> До боя</span>
            <b>{remaining(claim.battleStartsAt)}</b>
          </div>
        )}
      </div>

      {claim.walkover && (
        <p className="s4-note-box">
          Обороняющиеся никого не выставили — победа без боя. Район всё равно
          уходит под защиту на двое суток: безответная война не должна быть
          быстрее честной.
        </p>
      )}

      <div className="s4-sides">
        <Side title="Нападение" side={claim.attacker} tone="attack" mine={iAttack} />
        {claim.defender
          ? <Side title="Оборона" side={claim.defender} tone="defence" mine={iDefend} />
          : (
            <section className="s4-side">
              <header><h4>Оборона</h4></header>
              <p className="s4-muted">
                Район ничей — обороняться некому. Если никто не перебьёт заявку
                до боя, он отойдёт без сражения.
              </p>
            </section>
          )}
      </div>

      {claim.battleId && (
        <p className="s4-note-box">
          <Swords size={13} /> Бой назначен.{' '}
          <Link to={`/battle/${claim.battleId}`}>Перейти в бой</Link>
        </p>
      )}

      {/* Что можно сделать прямо сейчас — под составами, а не в шапке:
          сначала человек смотрит, с кем дело, потом решает. */}
      {/* Состав можно переставить, пока окно открыто, — и подпись обязана
          это показывать: одинаковая кнопка до и после отправки читается как
          «ничего не произошло». */}
      {live && iDefend && !picking && (
        <button type="button" disabled={busy} onClick={() => setPicking(true)}>
          <Users size={13} /> {defenceSet ? 'Изменить состав обороны' : 'Выставить состав обороны'}
        </button>
      )}
      {live && iDefend && picking && (
        <RosterPicker
          members={clan.clan?.members ?? []}
          minSize={1}
          busy={busy}
          submitLabel="Выставить оборону"
          note="Состав закрывается за 10 минут до боя."
          onCancel={() => setPicking(false)}
          onSubmit={roster => defence.mutate(roster)}
        />
      )}
      {live && iAttack && (
        <button
          type="button"
          className="s4-ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Отозвать заявку? Взнос 10 000 ₽ не вернётся.')) cancel.mutate()
          }}
        >
          <ShieldAlert size={13} /> Отозвать заявку
        </button>
      )}
    </>
  )
}

function Side({ title, side, tone, mine }: {
  title: string
  side: ClaimSide
  tone: 'attack' | 'defence'
  mine: boolean
}) {
  return (
    <section className={`s4-side s4-side--${tone}${mine ? ' is-mine' : ''}`}>
      <header>
        <h4>{title}{mine && <span className="s4-side__mine">это вы</span>}</h4>
        <b>[{side.clanTag}] {side.name}</b>
      </header>
      {side.roster.length === 0
        ? <p className="s4-muted">Состав не выставлен.</p>
        : (
          <ol className="s4-list">
            {side.roster.map((fighter, index) => (
              <li key={index}>
                <span>{fighter.nickname}</span>
                <span className="s4-muted">ур. {fighter.battleLevel}</span>
              </li>
            ))}
          </ol>
        )}
    </section>
  )
}
