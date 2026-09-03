// =============================================================
// Налёты — диверсия и ограбление чужих объектов.
//
// Объект нельзя разрушить: война двигает экономические потоки, но не
// стирает чужой прогресс. Повреждённый объект чинится восстановительными
// работами Этапа 3, то есть налёт создаёт работу у пострадавшего.
//
// Точный баланс чужого объекта наружу не отдаётся — только полоса.
// Это разведка, и она не должна быть бесплатной.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bomb, HandCoins, Clock, ShieldOff } from 'lucide-react'
import { objectWarApi, type AttackTarget } from '../../shared/api/strategy.api'
import { fmt, remaining, Skeleton, Fault, Empty, Note } from '../stage3/stage3-ui'

const BLOCKED: Record<string, string> = {
  NO_CLAN: 'вы не в бригаде',
  NO_PERMISSION: 'нет права на военные операции',
  COOLDOWN: 'объект уже трогали, идёт откат',
  NOT_AT_WAR: 'с владельцем нет вражды',
  OWNER_SOLO: 'владелец не в бригаде — одиночек не трогают',
  TOO_POOR: 'на объекте слишком мало денег',
  NO_AUTHORITY: 'не хватает авторитета',
  OWN_OBJECT: 'это объект вашей бригады',
}

const BAND: Record<AttackTarget['balanceBand'], string> = {
  LOW: 'пусто',
  NORMAL: 'есть чем поживиться',
  HIGH: 'набито',
}

export function RaidsSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const query = useQuery({
    queryKey: ['attackable'],
    queryFn: objectWarApi.attackable,
    refetchInterval: 30_000,
  })

  const done = (text: string) => {
    setBad(false)
    setMsg(text)
    void qc.invalidateQueries({ queryKey: ['attackable'] })
    void qc.invalidateQueries({ queryKey: ['clan'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const sabotage = useMutation({
    mutationFn: objectWarApi.sabotage,
    onSuccess: result => done(
      `Диверсия удалась: −${result.durabilityLost} прочности, объект встал.`
      + (result.cancelledCycleId ? ' Цикл прерван, сырьё вернулось владельцу.' : ''),
    ),
    onError: fail,
  })
  const rob = useMutation({
    mutationFn: objectWarApi.rob,
    onSuccess: result => done(`Взяли ${fmt(result.moneyTaken)} ₽ в общак.`),
    onError: fail,
  })

  if (query.isLoading) return <Skeleton rows={4} />
  if (query.isError) return <Fault retry={() => query.refetch()} />

  const items = query.data?.items ?? []
  const busy = sabotage.isPending || rob.isPending

  if (items.length === 0) {
    return (
      <Empty
        title="Целей нет"
        hint={
          query.data?.blockedReason === 'NO_CLAN'
            ? 'Налёты доступны только бригаде. Вступите в бригаду или создайте свою.'
            : 'Бить можно только в своём районе или в районе врага. Возьмите район или объявите вражду.'
        }
      />
    )
  }

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <p className="s4-lead">
        Бить можно только в своём районе или в районе врага. Объект не
        разрушается — его повреждают или обирают, а чинят потом
        восстановительными работами. Один объект — не чаще раза в трое суток.
      </p>

      <ul className="s4-targets">
        {items.map(target => (
          <li key={target.objectId} className="s4-target">
            <div className="s4-target__head">
              <b>{target.name}</b>
              <span className="s4-muted">{target.districtCode ?? 'без района'}</span>
            </div>

            <div className="s4-target__facts">
              {/* Полоса вместо суммы: точный баланс — это разведка. */}
              <span>Касса: {BAND[target.balanceBand]}</span>
              {target.status === 'DAMAGED' && <span className="s4-warn"><ShieldOff size={12} /> уже повреждён</span>}
              {target.cooldownUntil && (
                <span><Clock size={12} /> откат ещё {remaining(target.cooldownUntil)}</span>
              )}
            </div>

            <div className="s4-target__actions">
              <button
                type="button"
                disabled={!target.canSabotage || busy}
                onClick={() => sabotage.mutate(target.objectId)}
              >
                <Bomb size={13} /> Диверсия
              </button>
              <button
                type="button"
                disabled={!target.canRob || busy}
                onClick={() => rob.mutate(target.objectId)}
              >
                <HandCoins size={13} /> Ограбить
              </button>
            </div>

            {target.blockedReason && (
              <p className="s4-target__blocked">
                Нельзя: {BLOCKED[target.blockedReason] ?? target.blockedReason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
