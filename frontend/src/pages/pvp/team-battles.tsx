// =============================================================
// Командные бои: сбор состава и старт. Сам бой идёт на том же
// экране, что и дуэль, — механика и сетка общие.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, Plus, Play, RefreshCw } from 'lucide-react'
import { battlesApi, type TeamBattleLobby } from '../../shared/api/battles.api'
import { charactersApi } from '../../shared/api/characters.api'
import { ApiError } from '../../shared/api/client'
import './team-battles.css'

const SIDE_LABEL: Record<number, string> = { 1: 'Наши', 2: 'Чужие' }

export function TeamBattles() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [perSide, setPerSide] = useState(2)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: me } = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe() })
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['team-battles', 'open'],
    queryFn: () => battlesApi.listTeamBattles(),
    refetchInterval: 5000,
  })

  const say = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }
  const fail = (err: unknown) =>
    say('error', err instanceof ApiError ? err.message : 'Не получилось')

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['team-battles'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }

  const create = useMutation({
    mutationFn: () => battlesApi.createTeamBattle(perSide),
    onSuccess: () => { refresh(); say('success', 'Бой собран, ждём бойцов') },
    onError: fail,
  })
  const join = useMutation({
    mutationFn: ({ battleId, side }: { battleId: string; side: 1 | 2 }) =>
      battlesApi.joinTeamBattle(battleId, side),
    onSuccess: () => { refresh(); say('success', 'Вы в составе') },
    onError: fail,
  })
  const start = useMutation({
    mutationFn: (battleId: string) => battlesApi.startTeamBattle(battleId),
    onSuccess: (result) => { refresh(); navigate(`/battle/${result.battleId}`) },
    onError: fail,
  })

  const lobbies = data?.items ?? []
  const inSome = (lobby: TeamBattleLobby) =>
    lobby.sides.some(side => side.members.some(m => m.id === me?.id))

  return (
    <section className="team-battles">
      <header>
        <h2><Users size={16} /> Командные бои</h2>
        <button className="btn btn-sm" onClick={() => refetch()} title="Обновить">
          <RefreshCw size={13} />
        </button>
      </header>

      {message && <div className={`alert alert-${message.type} mb8`}>{message.text}</div>}

      <div className="team-create">
        <label>
          Бойцов на сторону
          <select value={perSide} onChange={e => setPerSide(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} × {n}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus size={13} /> Собрать бой
        </button>
      </div>

      {isLoading ? (
        <div className="loading"><span className="spinner" />Загрузка…</div>
      ) : lobbies.length === 0 ? (
        <p className="team-empty">Открытых командных боёв нет. Соберите свой — противники подтянутся.</p>
      ) : (
        <ul className="team-list">
          {lobbies.map(lobby => {
            const mine = inSome(lobby)
            const ready = lobby.sides.every(side => side.members.length > 0)
            return (
              <li key={lobby.battleId} className={mine ? 'is-mine' : ''}>
                <div className="team-head">
                  <b>{lobby.perSide} × {lobby.perSide}</b>
                  <span className="muted">уровни {lobby.levelMin}–{lobby.levelMax}</span>
                </div>
                <div className="team-sides">
                  {lobby.sides.map(side => (
                    <div key={side.side} className="team-side">
                      <span className="team-side-name">
                        {SIDE_LABEL[side.side] ?? `Сторона ${side.side}`} {side.members.length}/{lobby.perSide}
                      </span>
                      <ul>
                        {side.members.map(m => <li key={m.id}>{m.nickname} <i>{m.battleLevel} ур.</i></li>)}
                        {side.members.length === 0 && <li className="muted">пусто</li>}
                      </ul>
                      {!mine && side.members.length < lobby.perSide && (
                        <button
                          className="btn btn-sm"
                          disabled={join.isPending}
                          onClick={() => join.mutate({ battleId: lobby.battleId, side: side.side as 1 | 2 })}
                        >
                          Встать
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {mine && (
                  <button
                    className="btn btn-primary"
                    disabled={!ready || start.isPending}
                    title={ready ? undefined : 'Нужен хотя бы один боец с каждой стороны'}
                    onClick={() => start.mutate(lobby.battleId)}
                  >
                    <Play size={13} /> Начать бой
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
