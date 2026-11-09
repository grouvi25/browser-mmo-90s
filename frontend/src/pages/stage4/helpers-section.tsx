// =============================================================
// Помощники.
//
// Помощник — второй работник под управлением игрока. Работает на 60% от
// смены игрока того же уровня и упирается в свой потолок профессии: два
// помощника дают ровно нижнюю границу дохода владельца объекта, поэтому
// нанимать живых людей остаётся выгоднее.
//
// Без подписки помощник остаётся в профиле, но не работает. Экран это
// показывает прямо, а не прячет кнопку.
// =============================================================
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Hammer, Moon, Trash2 } from 'lucide-react'
import { helpersApi, type Helper, type HelperObject } from '../../shared/api/strategy.api'
import { fmt, remaining, Skeleton, Fault, Empty, Note } from '../stage3/stage3-ui'
import { CombatHelperFacts } from './combat-helper-facts'

export function HelpersSection() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [pickedProfession, setProfession] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const [kind, setKind] = useState<'WORK' | 'COMBAT'>('WORK')
  const query = useQuery({ queryKey: ['helpers'], queryFn: helpersApi.list, refetchInterval: 30_000 })
  // Список считает сервер, чтобы экран и мутация не разошлись.
  const objects = useQuery({ queryKey: ['helpers', 'objects'], queryFn: helpersApi.objects })

  const done = (text: string) => {
    setBad(false); setMsg(text)
    void qc.invalidateQueries({ queryKey: ['helpers'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  // Список профессий даёт сервер: новая профессия появляется здесь сама.
  const professions = query.data?.professions ?? []
  const profession = professions.some(row => row.code === pickedProfession) ? pickedProfession : professions[0]?.code ?? ''

  const hire = useMutation({
    mutationFn: () => helpersApi.hire(name, profession, kind),
    onSuccess: () => { setName(''); done('Помощник нанят') },
    onError: fail,
  })
  const dismiss = useMutation({ mutationFn: helpersApi.dismiss, onSuccess: () => done('Помощник уволен, его прогресс потерян'), onError: fail })
  // Правка заказчика 21.10: двое — боевой и рабочий или два рабочих.
  const hasCombat = (query.data?.items ?? []).some(h => h.kind === 'COMBAT')
  const work = useMutation({
    mutationFn: ({ id, objectId }: { id: string; objectId: string }) => helpersApi.work(id, objectId),
    onSuccess: () => done('Помощник вышел на смену'),
    onError: fail,
  })
  const claim = useMutation({
    mutationFn: helpersApi.claim,
    onSuccess: result => done(`Смена закрыта: ${fmt(result.salary)} ₽`),
    onError: fail,
  })

  if (query.isLoading) return <Skeleton rows={3} />
  if (query.isError) return <Fault retry={() => query.refetch()} />

  const data = query.data
  const items = data?.items ?? []
  const slots = data?.slots ?? { used: 0, total: 0 }
  const noSubscription = slots.total === 0
  const busy = hire.isPending || dismiss.isPending || work.isPending || claim.isPending

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <p className="s4-lead">
        Помощник работает за вас, пока вас нет: смена идёт час реального
        времени, и тот, кто не может сидеть в игре весь день, иначе просто
        проигрывает по доступности. Он делает 60% от вашей смены и не растёт
        выше третьего уровня профессии — специалиста он не заменит.
      </p>
      <p className="s4-lead">
        Работает на ваших объектах, объектах бригады и на государственной работе.
        На госработу ему нужен ваш инструмент, каждая смена тратит одно
        использование. Норма — шесть смен в сутки.
      </p>

      <div className="s4-summary">
        <div className="s4-stat">
          <span className="s4-stat__label">Слотов занято</span>
          <b>{slots.used} из {slots.total}</b>
        </div>
      </div>

      {noSubscription && (
        <p className="s4-note-box">
          Помощники работают только при активной подписке. Уже нанятые
          остаются в профиле и ждут — увольнять их не нужно.
        </p>
      )}

      {slots.used < slots.total && (
        <form
          className="s4-hire"
          onSubmit={event => { event.preventDefault(); if (name.trim().length >= 2) hire.mutate() }}
        >
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Имя помощника"
            maxLength={24}
            aria-label="Имя помощника"
          />
          <select value={kind} onChange={event => setKind(event.target.value as 'WORK' | 'COMBAT')} aria-label="Вид помощника">
            <option value="WORK">Рабочий</option>
            <option value="COMBAT" disabled={hasCombat}>Боевой{hasCombat ? ' (уже есть)' : ''}</option>
          </select>
          {kind === 'WORK' && (
            <select value={profession} onChange={event => setProfession(event.target.value)} aria-label="Профессия">
              {professions.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          )}
          <button type="submit" disabled={busy || name.trim().length < 2}>
            <UserPlus size={13} /> Нанять{data?.prices ? ` · ${fmt(data.prices[kind])} $` : ''}
          </button>
        </form>
      )}

      {items.length === 0
        ? <Empty title="Помощников нет" hint="Двое: боевой и рабочий или два рабочих (два боевых нельзя). При увольнении прогресс рабочего теряется." />
        : (
          <ul className="s4-helpers">
            {items.map(helper => (
              <HelperCard
                key={helper.id}
                helper={helper}
                busy={busy}
                objects={objects.data?.items ?? []}
                onWork={objectId => work.mutate({ id: helper.id, objectId })}
                onClaim={() => claim.mutate(helper.id)}
                onDismiss={() => dismiss.mutate(helper.id)}
                onTacticError={fail}
              />
            ))}
          </ul>
        )}
    </>
  )
}

function HelperCard({
  helper, busy, objects, onWork, onClaim, onDismiss, onTacticError,
}: {
  helper: Helper
  busy: boolean
  objects: HelperObject[]
  onWork: (objectId: string) => void
  onClaim: () => void
  onDismiss: () => void
  onTacticError: (e: Error) => void
}) {
  // Показываем только те объекты, куда помощник в принципе пройдёт: профессия
  // совпадает с требованием объекта, и уровня хватает.
  const suitable = objects.filter(object =>
    object.requiredProfessionCode === helper.professionCode && object.requiredProfessionLevel <= helper.professionLevel)
  // Выбор не запоминаем с первой отрисовки: список объектов приходит позже,
  // и пустой выбор держал «На смену» серой до перезагрузки (правка 28.10).
  const [picked, setObjectId] = useState('')
  const objectId = suitable.some(object => object.id === picked) ? picked : suitable[0]?.id ?? ''
  const shift = helper.activeShift
  // Часы для таймера: смена кончилась — «Забрать» включается сразу, без ожидания опроса.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!shift) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [shift])
  const ready = shift && new Date(shift.endsAt).getTime() <= now
  const dormant = helper.status === 'DORMANT'

  return (
    <li className={`s4-helper ${dormant ? 's4-helper--dormant' : ''}`}>
      <div className="s4-helper__head">
        <b>{helper.name}</b>
        {dormant && <span className="s4-muted"><Moon size={12} /> спит без подписки</span>}
      </div>

      {helper.kind === 'COMBAT' ? (
        <CombatHelperFacts helper={helper} disabled={dormant} onError={onTacticError} />
      ) : <>
      <dl className="s4-helper__facts">
        <div><dt>Профессия</dt><dd>{helper.professionName ?? helper.professionCode}</dd></div>
        <div>
          <dt>Уровень</dt>
          <dd>{helper.professionLevel} из {helper.skillCap}</dd>
        </div>
        {helper.dailyShiftCap != null && <div>
          <dt>Смен сегодня</dt>
          <dd>{helper.shiftsToday ?? 0} из {helper.dailyShiftCap} · осталось {Math.max(0, helper.dailyShiftCap - (helper.shiftsToday ?? 0))}</dd>
        </div>}
      </dl>

      {shift ? (
        <div className="s4-helper__shift">
          <span><Hammer size={12} /> На смене · {ready ? 'готово' : remaining(shift.endsAt, now)}</span>
          <button type="button" disabled={busy || !ready} onClick={onClaim}>Забрать смену</button>
        </div>
      ) : (
        <div className="s4-helper__shift">
          <select
            value={objectId}
            onChange={event => setObjectId(event.target.value)}
            disabled={dormant || suitable.length === 0}
            aria-label={`Объект для ${helper.name}`}
          >
            {suitable.length === 0
              ? <option value="">нет работы под эту профессию и уровень</option>
              : suitable.map(object => (
                <option key={object.id} value={object.id}>
                  {object.name}{object.salary ? ` · ${fmt(object.salary)} ₽` : ''}{object.requiredToolName ? ` · ${object.requiredToolName}` : ''}
                </option>
              ))}
          </select>
          <button type="button" disabled={busy || dormant || !objectId} onClick={() => onWork(objectId)}>
            На смену
          </button>
        </div>
      )}

      </>}

      <button
        type="button"
        className="s4-ghost s4-helper__dismiss"
        disabled={busy || !!shift}
        onClick={() => { if (window.confirm(`Уволить ${helper.name}? Весь его прогресс пропадёт: новый помощник начнёт с нуля.`)) onDismiss() }}
        title={shift ? 'Сначала закройте смену' : 'Уволить'}
      >
        <Trash2 size={12} /> Уволить
      </button>
    </li>
  )
}
