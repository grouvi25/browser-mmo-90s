// =============================================================
// Заявки на бой — общий список, как в «Королях» и на Апехе.
//
// Правка заказчика (октябрь 2026): поданная заявка не бросает в бой.
// Она висит в списке с таймером, к ней встают, а когда время выходит,
// бой открывается сам — и всех участников уводит на экран боя
// (это делает ApplicationWatcher в оболочке города).
// =============================================================
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Swords, Users, Shuffle, RefreshCw, Bot } from 'lucide-react'
import {
  battlesApi, type ApplicationKind, type BattleApplication, type ApplicationFighter,
} from '../../shared/api/battles.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'
import { PveStart } from '../../widgets/pve-start/pve-start'
import './applications.css'

const KIND_LABEL: Record<ApplicationKind | 'SIEGE', string> = { DUEL: 'Дуэль', GROUP: 'Групповой', CHAOTIC: 'Хаотичный', SIEGE: 'Осада дома' }
const KIND_HINT: Record<ApplicationKind, string> = {
  DUEL: 'Один на один.',
  GROUP: 'Две стороны: встаёте за любую.',
  CHAOTIC: 'Все в одной заявке, стороны делит жребий на старте.',
}
const DELAYS = [1, 3, 5, 10]
type Tab = 'ALL' | ApplicationKind | 'RUNNING'
// Виды списка выбираются в нижней полосе Стрелков (?tab=…): правка
// заказчика перенесла разделы локации вниз, под кнопку ЦЕНТР.
const TAB_LABEL: Record<Tab, string> = {
  ALL: 'Все заявки', DUEL: 'Дуэли', GROUP: 'Групповые', CHAOTIC: 'Хаотичные', RUNNING: 'Идут сейчас',
}
/** «Бой с ботом» — крайняя кнопка в ряду видов боя; он начинается сразу. */
type CreateKind = ApplicationKind | 'BOT'

function countdown(ms: number) {
  if (ms <= 0) return 'начинается…'
  const total = Math.ceil(ms / 1000)
  return `через ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Fighter({ fighter }: { fighter: ApplicationFighter }) {
  return <li><Link to={`/u/${encodeURIComponent(fighter.nickname)}`}>{fighter.nickname}</Link> <i>{fighter.level} ур.</i></li>
}

export function BattleApplications() {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && raw in TAB_LABEL ? raw : 'ALL'
  const [kind, setKind] = useState<CreateKind>('DUEL')
  const [teamSize, setTeamSize] = useState(2)
  const [delay, setDelay] = useState(5)
  const [levelMin, setLevelMin] = useState<number | ''>('')
  const [levelMax, setLevelMax] = useState<number | ''>('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [, tick] = useState(0)

  const me = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe() })
  const list = useQuery({ queryKey: ['battle-applications'], queryFn: battlesApi.listApplications, refetchInterval: 3000 })
  // Часы клиента и сервера расходятся: таймер считаем от времени сервера.
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (list.data) setOffset(new Date(list.data.serverTime).getTime() - Date.now())
  }, [list.data])
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(id) }, [])
  const now = Date.now() + offset

  const say = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }
  const fail = (err: unknown) => say('error', err instanceof ApiError ? err.message : 'Не получилось')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['battle-applications'] }) }

  const create = useMutation({
    mutationFn: () => battlesApi.createApplication({
      kind: kind as ApplicationKind, delayMinutes: delay,
      teamSize: kind === 'DUEL' ? undefined : teamSize,
      levelMin: levelMin === '' ? undefined : levelMin,
      levelMax: levelMax === '' ? undefined : levelMax,
    }),
    onSuccess: () => { refresh(); say('success', `Заявка подана. Бой начнётся через ${delay} мин., если найдутся соперники`) },
    onError: fail,
  })
  const join = useMutation({
    mutationFn: ({ battleId, side }: { battleId: string; side?: 1 | 2 }) => battlesApi.joinApplication(battleId, side),
    onSuccess: result => {
      refresh()
      // Набранная заявка стартует сразу — уводим в бой, не дожидаясь опроса.
      if (result.started) { void qc.invalidateQueries({ queryKey: ['battle', 'current'] }); say('success', 'Вызов принят — бой начинается') }
      else say('success', 'Вы в заявке. Бой начнётся, когда наберутся бойцы или выйдет время')
    },
    onError: fail,
  })
  const leave = useMutation({
    mutationFn: (battleId: string) => battlesApi.leaveApplication(battleId),
    onSuccess: result => { refresh(); say('success', result.cancelled ? 'Заявка снята' : 'Вы вышли из заявки') },
    onError: fail,
  })

  const applications = list.data?.applications ?? []
  const mine = applications.find(item => item.isMine)
  const shown = applications.filter(item => tab === 'ALL' || item.kind === tab)
  const inBattle = me.data?.status === 'IN_BATTLE'
  const level = me.data?.battleLevel ?? 1
  const busy = create.isPending || join.isPending || leave.isPending

  return (
    <section className="bapps">
      {message && <div className={`alert alert-${message.type} mb8`} role="status">{message.text}</div>}

      {me.data?.traumaUntil && new Date(me.data.traumaUntil).getTime() > Date.now() && (
        <div className="alert alert-error" role="status">
          Кровавая травма после проигранной осады: в бой можно после {new Date(me.data.traumaUntil).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} по Москве.
        </div>
      )}

      {mine && (
        <div className="bapps-mine" role="status">
          <span><b>Вы в заявке:</b> {KIND_LABEL[mine.kind]}, бой {countdown(new Date(mine.startsAt).getTime() - now)}</span>
          <button className="btn btn-sm" disabled={busy} onClick={() => leave.mutate(mine.battleId)}>
            {mine.isCreator ? 'Снять заявку' : 'Выйти из заявки'}
          </button>
        </div>
      )}

      <form className="bapps-create" onSubmit={event => { event.preventDefault(); if (kind !== 'BOT') create.mutate() }}>
        <fieldset className="bapps-kinds">
          <legend>Подать заявку</legend>
          {(['DUEL', 'GROUP', 'CHAOTIC', 'BOT'] as CreateKind[]).map(item => (
            <button type="button" key={item} aria-pressed={kind === item}
              className={'bapps-kind' + (kind === item ? ' is-active' : '')} onClick={() => setKind(item)}>
              {item === 'DUEL' ? <Swords size={13} /> : item === 'GROUP' ? <Users size={13} /> : item === 'CHAOTIC' ? <Shuffle size={13} /> : <Bot size={13} />}
              {item === 'BOT' ? 'Бой с ботом' : KIND_LABEL[item]}
            </button>
          ))}
        </fieldset>
        {kind === 'BOT' ? <PveStart embedded /> : <>
        <p className="bapps-hint">{KIND_HINT[kind]}</p>
        <div className="bapps-fields">
          {kind !== 'DUEL' && (
            <label htmlFor="bapps-team">Бойцов на сторону
              <select id="bapps-team" value={teamSize} onChange={e => setTeamSize(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].filter(n => kind !== 'CHAOTIC' || n >= 2).map(n => <option key={n} value={n}>{n} × {n}</option>)}
              </select>
            </label>
          )}
          <label htmlFor="bapps-delay">Начало через
            <select id="bapps-delay" value={delay} onChange={e => setDelay(Number(e.target.value))}>
              {DELAYS.map(n => <option key={n} value={n}>{n} мин.</option>)}
            </select>
          </label>
          <label htmlFor="bapps-lmin">Уровни
            <span className="bapps-levels">
              <input id="bapps-lmin" type="number" min={1} max={99} placeholder={String(Math.max(1, level - (kind === 'DUEL' ? 2 : 5)))}
                value={levelMin} onChange={e => setLevelMin(e.target.value ? Number(e.target.value) : '')} aria-label="Уровень от" />
              —
              <input type="number" min={1} max={99} placeholder={String(Math.min(99, level + (kind === 'DUEL' ? 2 : 5)))}
                value={levelMax} onChange={e => setLevelMax(e.target.value ? Number(e.target.value) : '')} aria-label="Уровень до" />
            </span>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !!mine || inBattle}
            title={mine ? 'Вы уже в заявке' : inBattle ? 'Вы в бою' : undefined}>
            {create.isPending ? 'Подаём…' : 'Подать заявку'}
          </button>
        </div>
        </>}
      </form>

      <div className="bapps-tabs">
        <b className="bapps-list-title">
          {TAB_LABEL[tab]} ({tab === 'RUNNING' ? list.data?.active.length ?? 0 : shown.length})
        </b>
        <button type="button" className="btn btn-sm bapps-refresh" onClick={() => list.refetch()} title="Обновить" aria-label="Обновить список">
          <RefreshCw size={13} />
        </button>
      </div>

      {list.isLoading && <p className="bapps-empty" role="status">Загружаем заявки…</p>}
      {list.isError && <p className="bapps-empty" role="alert">Список не загрузился. <button className="btn btn-sm" onClick={() => list.refetch()}>Повторить</button></p>}

      {tab !== 'RUNNING' && list.data && (shown.length === 0
        ? <p className="bapps-empty">Заявок нет. Подайте свою — соперники увидят её в списке.</p>
        : <ul className="bapps-list">{shown.map(item => (
          <ApplicationRow key={item.battleId} item={item} now={now} busy={busy || inBattle || !!mine} level={level}
            onJoin={side => join.mutate({ battleId: item.battleId, side })} />
        ))}</ul>)}

      {tab === 'RUNNING' && list.data && (list.data.active.length === 0
        ? <p className="bapps-empty">Сейчас никто не дерётся.</p>
        : <ul className="bapps-list">{list.data.active.map(battle => (
          <li key={battle.battleId} className="bapps-row">
            <div className="bapps-head"><b>{KIND_LABEL[battle.kind]}</b>
              <span className="muted">идёт{battle.startedAt ? ` с ${new Date(battle.startedAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
            <div className="bapps-sides">{battle.sides.map(side => (
              <div key={side.side} className="bapps-side"><ul>{side.members.map(f => <Fighter key={f.id ?? f.nickname} fighter={f} />)}</ul></div>
            ))}</div>
          </li>
        ))}</ul>)}
    </section>
  )
}

function ApplicationRow({ item, now, busy, level, onJoin }: {
  item: BattleApplication; now: number; busy: boolean; level: number; onJoin: (side?: 1 | 2) => void
}) {
  const left = new Date(item.startsAt).getTime() - now
  return (
    <li className={'bapps-row' + (item.isMine ? ' is-mine' : '')}>
      <div className="bapps-head">
        <b>{KIND_LABEL[item.kind]}{item.kind !== 'DUEL' ? ` ${item.teamSize}×${item.teamSize}` : ''}</b>
        <span className="muted">уровни {item.levelMin}–{item.levelMax} · подал {item.creator.nickname}</span>
        <strong className="bapps-timer">{countdown(left)}</strong>
      </div>
      <div className="bapps-sides">
        {item.sides.map(side => {
          const join = item.canJoin.find(c => c.side === side.side)
          const label = item.kind === 'CHAOTIC' ? `Участники ${side.members.length}/${item.teamSize * 2}`
            : `Сторона ${side.side} · ${side.members.length}/${item.teamSize}`
          return (
            <div key={side.side} className="bapps-side">
              <span className="bapps-side-name">{label}</span>
              <ul>{side.members.map(f => <Fighter key={f.id ?? f.nickname} fighter={f} />)}
                {side.members.length === 0 && <li className="muted">пусто</li>}</ul>
              {!item.isMine && join?.ok && (
                <button className="btn btn-sm" disabled={busy}
                  onClick={() => onJoin(item.kind === 'GROUP' ? side.side as 1 | 2 : undefined)}>
                  {item.kind === 'DUEL' ? 'Принять вызов' : 'Встать'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {/* Кнопки нет — объясняем почему, иначе кажется, что вызов «не принимается». */}
      {!item.isMine && !item.canJoin.some(c => c.ok) && (level < item.levelMin || level > item.levelMax) && (
        <p className="bapps-hint">Ваш {level}-й уровень не подходит: заявка для {item.levelMin}–{item.levelMax}.</p>
      )}
    </li>
  )
}
