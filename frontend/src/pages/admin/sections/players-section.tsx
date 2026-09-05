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
import { adminApi, REASON_MIN, type PlayerRow } from '../admin-api'
import { Skeleton, Fault, Note } from '../../stage3/stage3-ui'
import { ReasonForm, Table, rub, when } from '../admin-ui'

type Sort = 'money' | 'level' | 'new'

const SORTS: { key: Sort; title: string }[] = [
  { key: 'money', title: 'По деньгам' },
  { key: 'level', title: 'По уровню' },
  { key: 'new', title: 'Новые' },
]

export function PlayersSection({ focusId, onTrace }: {
  focusId?: string
  /** Переход в «Цепочку» с подставленным идентификатором. */
  onTrace?: (id: string) => void
}) {
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
            onTrace={onTrace}
            onToggle={() => setOpenId(openId === pinnedRow.id ? null : pinnedRow.id)}
          />
        )}
        {items.map(player => (
          <PlayerLine
            key={player.id}
            player={player}
            open={openId === player.id}
            onTrace={onTrace}
            onToggle={() => setOpenId(openId === player.id ? null : player.id)}
          />
        ))}
      </Table>

      {items.length === 0 && <p className="adm-hint">Никого не нашлось.</p>}
    </>
  )
}

function PlayerLine({
  player, open, onToggle, onTrace,
}: {
  player: PlayerRow; open: boolean; onToggle: () => void
  onTrace?: (id: string) => void
}) {
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
          <td colSpan={8}><PlayerCard player={player} onTrace={onTrace} /></td>
        </tr>
      )}
    </>
  )
}

/** Всё, что карточка знает об игроке. Собирается одной ручкой: гонять
 *  восемь запросов ради одного экрана незачем. */
interface PlayerDetail {
  character?: {
    battleExp: number; economicExp: number; productionExp: number
    productionLevel: number; hpCurrent: number; hpMax: number
    battlesTotal: number; battlesWon: number; status: string
    isPremium: boolean; premiumExpiresAt: string | null
    alcoholLevel: number; lastActiveAt: string
    stats?: {
      str: number; agi: number; rea: number; acc: number
      end: number; luck: number; agr: number; pointsAvailable: number
    } | null
    user?: { email: string | null; lastIp: string | null; registeredAt: string; banReason: string | null }
    weaponSkills?: { weaponType: string; level: number; exp: number }[]
  }
  money?: { createdAt: string; amount: number; balanceAfter: number; reasonCode: string; reasonTitle: string; note: string | null }[]
  items?: {
    id: string; isEquipped: boolean; status: string; quality: string
    durabilityCurrent: number; durabilityMax: number; upgradeLevel: number
    template: { code: string; name: string; type: string; priceBase: number }
  }[]
  resources?: { code: string; name: string; amount: number; reserved: number; worth: number }[]
  professions?: { code: string; name: string; level: number; exp: number }[]
  shifts?: { id: string; status: string; statusTitle: string; objectName: string; startedAt: string; endsAt: string }[]
  adminActions?: { id: string; kind: string; reason: string; createdAt: string; rolledBackAt: string | null }[]
  upgrades?: { result: string; count: number }[]
  battles?: number
  clan?: { role: string; clan: { name: string; tag: string } } | null
}

const EXP_TRACKS: { key: 'battle' | 'economic' | 'production'; title: string }[] = [
  { key: 'battle', title: 'боевой' },
  { key: 'economic', title: 'экономический' },
  { key: 'production', title: 'производственный' },
]

const STAT_TITLE: Record<string, string> = {
  str: 'Сила', agi: 'Ловкость', rea: 'Реакция', acc: 'Меткость',
  end: 'Выносливость', luck: 'Удача', agr: 'Агрессия',
}

/**
 * Карточка игрока.
 *
 * Сюда приходят из улик алерта, из разбивки обзора и из жалобы, и вопрос
 * всегда один: что с этим человеком происходит и что с ним сделать.
 * Поэтому здесь и всё состояние — деньги, опыт, характеристики, вещи,
 * ресурсы, смены, — и все меры рядом, а не в другом разделе.
 */
function PlayerCard({ player, onTrace }: {
  player: PlayerRow
  onTrace?: (id: string) => void
}) {
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

  if (card.isLoading) return <Skeleton rows={3} />

  const data = card.data as PlayerDetail | undefined
  const money = data?.money ?? []
  const items = data?.items ?? []
  const resources = data?.resources ?? []
  const character = data?.character
  const stats = character?.stats
  const wealth = resources.reduce((sum, row) => sum + row.worth, 0)
  const gear = items.reduce((sum, row) => sum + row.template.priceBase, 0)

  return (
    <div className="adm-player">
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      {/* Состояние в цифрах. Полное состояние игрока — это не только
          деньги: вещи и ресурсы на руках часто стоят дороже кошелька, и
          при разборе расслоения смотреть надо на сумму. */}
      <div className="adm-player__facts">
        <span>Деньги: <b>{rub(player.money)} ₽</b></span>
        <span>Вещи: <b>{rub(gear)} ₽</b></span>
        <span>Ресурсы: <b>{rub(wealth)} ₽</b></span>
        <span>Всего: <b>{rub(player.money + gear + wealth)} ₽</b></span>
        <span>HP: <b>{character?.hpCurrent ?? '—'}/{character?.hpMax ?? '—'}</b></span>
        <span>Боёв: <b>{data?.battles ?? 0}</b> (побед {character?.battlesWon ?? 0})</span>
        <span>Бригада: <b>{data?.clan ? `[${data.clan.clan.tag}] ${data.clan.clan.name}` : '—'}</b></span>
        <span>Зарегистрирован: <b>{when(player.createdAt)}</b></span>
        <span>Был активен: <b>{when(character?.lastActiveAt ?? null)}</b></span>
        {character?.isPremium && <span className="adm-ok">Премиум до {when(character.premiumExpiresAt)}</span>}
        {character?.user?.lastIp && <span>IP: <b>{character.user.lastIp}</b></span>}
        {onTrace && (
          <button type="button" className="adm-link" onClick={() => onTrace(player.id)}>
            цепочка операций
          </button>
        )}
      </div>

      <div className="adm-player__cols">
        <div>
          <h5>Опыт и уровни</h5>
          <Table head={['Ветка', 'Уровень', 'Опыт']}>
            <tr><td>Боевой</td><td className="num">{player.battleLevel}</td><td className="num">{rub(character?.battleExp)}</td></tr>
            <tr><td>Экономический</td><td className="num">{player.economicLevel}</td><td className="num">{rub(character?.economicExp)}</td></tr>
            <tr><td>Производственный</td><td className="num">{character?.productionLevel ?? 0}</td><td className="num">{rub(character?.productionExp)}</td></tr>
            {(data?.professions ?? []).map(row => (
              <tr key={row.code}>
                <td>{row.name}<em className="adm-row__hint">профессия</em></td>
                <td className="num">{row.level}</td>
                <td className="num">{rub(row.exp)}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div>
          <h5>Характеристики</h5>
          {stats ? (
            <Table head={['Характеристика', 'Значение']}>
              {Object.entries(STAT_TITLE).map(([key, title]) => (
                <tr key={key}>
                  <td>{title}</td>
                  <td className="num">{(stats as unknown as Record<string, number>)[key]}</td>
                </tr>
              ))}
              <tr>
                <td>Нераспределённых очков</td>
                <td className={stats.pointsAvailable > 0 ? 'num adm-warn' : 'num'}>{stats.pointsAvailable}</td>
              </tr>
            </Table>
          ) : <p className="adm-hint">Характеристик нет.</p>}
        </div>
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
          <Table head={['Предмет', 'Тип', 'Кач.', 'Прочн.', 'Цена', '']}>
            {items.slice(0, 20).map(item => (
              <tr key={item.id}>
                <td>
                  {item.template.name}
                  {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ''}
                  {item.isEquipped ? ' (надето)' : item.status === 'ON_MARKET' ? ' (на рынке)' : ''}
                </td>
                <td>{item.template.type}</td>
                <td>{item.quality}</td>
                <td className={item.durabilityCurrent < item.durabilityMax * 0.3 ? 'num adm-bad' : 'num'}>
                  {item.durabilityCurrent}/{item.durabilityMax}
                </td>
                <td className="num">{rub(item.template.priceBase)}</td>
                <td>
                  {/* Цепочка по вещи — то, чем ловят дюп: две копии совпадают
                      по истории до момента раздвоения. */}
                  {onTrace && <button type="button" className="adm-link" onClick={() => onTrace(item.id)}>цепочка</button>}
                </td>
              </tr>
            ))}
          </Table>
          {items.length === 0 && <p className="adm-hint">Вещей нет.</p>}
        </div>
      </div>

      <div className="adm-player__cols">
        <div>
          <h5>Ресурсы на руках</h5>
          {resources.length === 0 ? <p className="adm-hint">Ресурсов нет.</p> : (
            <Table head={['Ресурс', 'Сколько', 'В резерве', 'На сумму']}>
              {resources.slice(0, 15).map(row => (
                <tr key={row.code}>
                  <td>{row.name}<em className="adm-row__hint">{row.code}</em></td>
                  <td className="num">{rub(row.amount)}</td>
                  <td className="num">{row.reserved || '—'}</td>
                  <td className="num">{rub(row.worth)} ₽</td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <div>
          <h5>Последние смены</h5>
          {(data?.shifts ?? []).length === 0 ? <p className="adm-hint">Смен не было.</p> : (
            <Table head={['Объект', 'Состояние', 'Начата']}>
              {(data?.shifts ?? []).map(row => (
                <tr key={row.id}>
                  <td>{row.objectName}</td>
                  <td>{row.statusTitle}</td>
                  <td>{when(row.startedAt)}</td>
                </tr>
              ))}
            </Table>
          )}

          {(data?.adminActions ?? []).length > 0 && (
            <>
              {/* Что с игроком уже делали. Без этого разбор жалобы
                  начинается с вопроса «а его вообще трогали?». */}
              <h5>Что с ним уже делали</h5>
              <Table head={['Когда', 'Действие', 'Причина']}>
                {(data?.adminActions ?? []).map(row => (
                  <tr key={row.id} className={row.rolledBackAt ? 'adm-dead' : undefined}>
                    <td>{when(row.createdAt)}</td>
                    <td>{row.kind}{row.rolledBackAt ? ' (откачено)' : ''}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </div>
      </div>

      {/* Меры. Деньги и опыт выдаются отсюда же: уходить за этим в другой
          раздел, держа в голове идентификатор персонажа, — ровно та
          работа, которой в панели быть не должно. */}
      <h5>Выдать или забрать</h5>
      <div className="adm-player__grants">
        <GrantMoney characterId={player.id} onDone={done} onFail={fail} />
        <GrantExp characterId={player.id} onDone={done} onFail={fail} />
      </div>

      <h5>Меры</h5>
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

/** Выдача и списание денег: знак задаёт направление. */
function GrantMoney({ characterId, onDone, onFail }: {
  characterId: string
  onDone: (text: string) => void
  onFail: (error: Error) => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const grant = useMutation({
    mutationFn: () => adminApi.grantMoney(characterId, Number(amount), reason.trim()),
    onSuccess: () => {
      onDone(`Деньги ${Number(amount) > 0 ? 'выданы' : 'списаны'}. Отменяется из журнала.`)
      setAmount(''); setReason('')
    },
    onError: onFail,
  })

  const value = Number(amount)
  const ready = amount !== '' && Number.isInteger(value) && value !== 0 && reason.trim().length >= REASON_MIN

  return (
    <div className="adm-grant">
      <h6>Деньги</h6>
      <label>
        <span>Сколько (минус — забрать)</span>
        <input type="number" value={amount} onChange={event => setAmount(event.target.value)}
          placeholder="напр. 5000 или -5000" aria-label="Сумма" />
      </label>
      <input value={reason} onChange={event => setReason(event.target.value)}
        placeholder={`Причина, от ${REASON_MIN} символов`} aria-label="Причина выдачи денег" />
      <button type="button" disabled={!ready || grant.isPending} onClick={() => grant.mutate()}>
        {value < 0 ? 'Забрать' : 'Выдать'}
      </button>
    </div>
  )
}

/** Выдача опыта. Уровень пересчитывает сервер — иначе опыт и уровень
 *  разъедутся, и персонаж останется с телом первого уровня. */
function GrantExp({ characterId, onDone, onFail }: {
  characterId: string
  onDone: (text: string) => void
  onFail: (error: Error) => void
}) {
  const [track, setTrack] = useState<'battle' | 'economic' | 'production'>('battle')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const grant = useMutation({
    mutationFn: () => adminApi.grantExp(characterId, track, Number(amount), reason.trim()),
    onSuccess: () => {
      onDone('Опыт записан, уровень пересчитан. Отменяется из журнала.')
      setAmount(''); setReason('')
    },
    onError: onFail,
  })

  const value = Number(amount)
  const ready = amount !== '' && Number.isInteger(value) && value !== 0 && reason.trim().length >= REASON_MIN

  return (
    <div className="adm-grant">
      <h6>Опыт</h6>
      <label>
        <span>Ветка</span>
        <select value={track} onChange={event => setTrack(event.target.value as typeof track)}>
          {EXP_TRACKS.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
        </select>
      </label>
      <label>
        <span>Сколько (минус — забрать)</span>
        <input type="number" value={amount} onChange={event => setAmount(event.target.value)}
          placeholder="напр. 1500" aria-label="Опыт" />
      </label>
      <input value={reason} onChange={event => setReason(event.target.value)}
        placeholder={`Причина, от ${REASON_MIN} символов`} aria-label="Причина выдачи опыта" />
      <button type="button" disabled={!ready || grant.isPending} onClick={() => grant.mutate()}>
        {value < 0 ? 'Забрать' : 'Выдать'}
      </button>
    </div>
  )
}
