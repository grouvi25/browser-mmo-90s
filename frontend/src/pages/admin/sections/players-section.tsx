// =============================================================
// Игроки.
//
// Раздел, которого не хватало сильнее всего: алерт показывал, что деньги
// скопились у немногих, а посмотреть на этих немногих было негде.
//
// Список ведёт к карточке, карточка — к действиям. Каждое действие идёт
// через журнал с причиной и обратной операцией: бан снимается разбаном,
// немота — прежним сроком.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Search } from 'lucide-react'
import { adminApi, type PlayerRow } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'
import { ReasonForm, Table, rub, when } from '../admin-ui'

type Sort = 'money' | 'level' | 'new'

const SORTS: { key: Sort; title: string }[] = [
  { key: 'money', title: 'По деньгам' },
  { key: 'level', title: 'По уровню' },
  { key: 'new', title: 'Новые' },
]

export function PlayersSection({ focusId }: { focusId?: string }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('money')
  const [openId, setOpenId] = useState<string | null>(focusId ?? null)

  const players = useQuery({
    queryKey: ['admin', 'players', search, sort],
    queryFn: () => adminApi.players({ search, sort }),
  })

  const items = players.data?.items ?? []
  const inList = items.some(player => player.id === focusId)

  // Список — первая полусотня по деньгам, и игрок из улик алерта в неё
  // обычно не попадает. Раньше переход «открыть» просто высаживал на
  // список без него — то же самое, за что ругали кнопку «к порогам».
  // Поэтому недостающего догружаем отдельно и прикалываем сверху.
  const pinned = useQuery({
    queryKey: ['admin', 'player', 'pinned', focusId],
    queryFn: () => adminApi.player(focusId!),
    enabled: Boolean(focusId) && !inList && !players.isLoading,
  })
  const pinnedRow = (pinned.data as { character?: PlayerRow } | undefined)?.character ?? null

  if (players.isLoading) return <Skeleton rows={5} />
  if (players.isError) return <Fault retry={() => players.refetch()} />

  return (
    <>
      <p className="s4-lead">
        Кто играет, сколько у кого денег и что с ними происходило. Отсюда же —
        бан, немота и разбор цепочки операций: всё с причиной и с возможностью
        отменить.
      </p>

      <div className="adm-players__filters">
        <label className="adm-find">
          <Search size={13} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Ник или логин"
            aria-label="Поиск игрока"
          />
        </label>
        <div className="s3-tabs">
          {SORTS.map(option => (
            <button key={option.key} type="button"
              className={sort === option.key ? 'active' : ''}
              onClick={() => setSort(option.key)}>
              {option.title}
            </button>
          ))}
        </div>
      </div>

      {pinnedRow && (
        <p className="adm-hint">
          {pinnedRow.nickname} — из перехода по улике; в текущей сортировке его нет,
          поэтому он показан отдельной строкой сверху.
        </p>
      )}

      <Table head={['Ник', 'Логин', 'Деньги', 'Бой', 'Эконом.', 'Состояние', 'Заходил', '']}>
        {pinnedRow && (
          <PlayerLine
            key={pinnedRow.id}
            player={pinnedRow}
            open={openId === pinnedRow.id}
            onToggle={() => setOpenId(openId === pinnedRow.id ? null : pinnedRow.id)}
          />
        )}
        {items.map(player => (
          <PlayerLine
            key={player.id}
            player={player}
            open={openId === player.id}
            onToggle={() => setOpenId(openId === player.id ? null : player.id)}
          />
        ))}
      </Table>

      {items.length === 0 && <p className="adm-hint">Никого не нашлось.</p>}
    </>
  )
}

function PlayerLine({
  player, open, onToggle,
}: { player: PlayerRow; open: boolean; onToggle: () => void }) {
  const muted = player.user.mutedUntil && new Date(player.user.mutedUntil) > new Date()
  const state = player.user.status === 'BANNED'
    ? <span className="adm-bad">забанен</span>
    : muted ? <span className="adm-warn">немота</span> : <span className="adm-ok">играет</span>

  return (
    <>
      <tr>
        <td>{player.nickname}</td>
        <td><code>{player.user.login}</code></td>
        <td className="num">{rub(player.money)} ₽</td>
        <td className="num">{player.battleLevel}</td>
        <td className="num">{player.economicLevel}</td>
        <td>{state}</td>
        <td>{when(player.user.lastLoginAt)}</td>
        <td>
          <button type="button" className="adm-link" onClick={onToggle}>
            {open ? 'свернуть' : 'разобрать'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="adm-players__card">
          <td colSpan={8}><PlayerCard player={player} /></td>
        </tr>
      )}
    </>
  )
}

function PlayerCard({ player }: { player: PlayerRow }) {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const card = useQuery({
    queryKey: ['admin', 'player', player.id],
    queryFn: () => adminApi.player(player.id),
  })

  const done = (text: string) => {
    setBad(false); setMsg(text)
    void qc.invalidateQueries({ queryKey: ['admin'] })
  }
  const fail = (error: Error) => { setBad(true); setMsg(error.message) }

  const ban = useMutation({ mutationFn: (reason: string) => adminApi.banPlayer(player.user.id, reason), onSuccess: () => done('Забанен. Отменяется разбаном из журнала.'), onError: fail })
  const unban = useMutation({ mutationFn: (reason: string) => adminApi.unbanPlayer(player.user.id, reason), onSuccess: () => done('Разбанен.'), onError: fail })
  const mute = useMutation({ mutationFn: (reason: string) => adminApi.mutePlayer(player.user.id, reason, 24), onSuccess: () => done('Немота на сутки.'), onError: fail })

  if (card.isLoading) return <Skeleton rows={2} />

  const data = card.data as {
    money?: { createdAt: string; amount: number; balanceAfter: number; reasonCode: string; reasonTitle: string; note: string | null }[]
    items?: { id: string; isEquipped: boolean; status: string; quality: string; durabilityCurrent: number; template: { name: string; type: string; priceBase: number } }[]
    battles?: number
    clan?: { role: string; clan: { name: string; tag: string } } | null
  } | undefined

  const money = data?.money ?? []
  const items = data?.items ?? []

  return (
    <div className="adm-player">
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <div className="adm-player__facts">
        <span>Боёв: <b>{data?.battles ?? 0}</b></span>
        <span>Предметов: <b>{items.length}</b></span>
        <span>Бригада: <b>{data?.clan ? `[${data.clan.clan.tag}] ${data.clan.clan.name}` : '—'}</b></span>
        <span>Зарегистрирован: <b>{when(player.createdAt)}</b></span>
      </div>

      <div className="adm-player__cols">
        <div>
          {/* Последние движения денег — первое, на что смотрят, когда игрок
              попал в улики алерта про расслоение. */}
          <h5>Последние операции с деньгами</h5>
          <Table head={['Когда', 'Сколько', 'Остаток', 'Причина']}>
            {money.slice(0, 12).map((row, index) => (
              <tr key={index}>
                <td>{when(row.createdAt)}</td>
                <td className={row.amount >= 0 ? 'num adm-ok' : 'num adm-bad'}>
                  {row.amount >= 0 ? '+' : ''}{rub(row.amount)}
                </td>
                <td className="num">{rub(row.balanceAfter)}</td>
                <td>
                  {row.reasonTitle || row.reasonCode}
                  <em className="adm-row__hint">{row.reasonCode}{row.note ? ` · ${row.note}` : ''}</em>
                </td>
              </tr>
            ))}
          </Table>
          {money.length === 0 && <p className="adm-hint">Движений денег нет.</p>}
        </div>

        <div>
          <h5>Снаряжение и вещи</h5>
          <Table head={['Предмет', 'Тип', 'Качество', 'Прочн.', 'Цена']}>
            {items.slice(0, 12).map(item => (
              <tr key={item.id}>
                <td>
                  {item.template.name}
                  {item.isEquipped ? ' (надето)' : item.status === 'ON_MARKET' ? ' (на рынке)' : ''}
                </td>
                <td>{item.template.type}</td>
                <td>{item.quality}</td>
                <td className="num">{item.durabilityCurrent}</td>
                <td className="num">{rub(item.template.priceBase)}</td>
              </tr>
            ))}
          </Table>
          {items.length === 0 && <p className="adm-hint">Вещей нет.</p>}
        </div>
      </div>

      <div className="adm-player__actions">
        {player.user.status === 'BANNED' ? (
          <ReasonForm label="Разбанить" busy={unban.isPending} onSubmit={reason => unban.mutate(reason)} />
        ) : (
          <>
            <ReasonForm label="Забанить" danger busy={ban.isPending} onSubmit={reason => ban.mutate(reason)} />
            <ReasonForm label="Немота на сутки" busy={mute.isPending}
              onSubmit={reason => mute.mutate(reason)} />
          </>
        )}
      </div>
      <p className="adm-hint">
        <Ban size={11} /> Любое из этих действий записывается в журнал с причиной и
        отменяется оттуда же.
      </p>
    </div>
  )
}
