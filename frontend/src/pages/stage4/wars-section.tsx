// =============================================================
// Войны бригады — районы во владении, авторитет и история.
//
// Авторитет здесь главное число: он не покупается и не передаётся, а
// набирается в основном производством. Клан, который только дерётся, не
// наберёт темпа заявок — поэтому строка «откуда он берётся» стоит рядом,
// а не спрятана в справку.
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { Landmark, Coins, Swords, ShieldCheck } from 'lucide-react'
import { territoriesApi } from '../../shared/api/strategy.api'
import { fmt, Skeleton, Fault, Empty } from '../stage3/stage3-ui'
import { useMyClan } from '../stage3/use-my-clan'

const AUTHORITY_REASON: Record<string, string> = {
  TERRITORY_WON: 'взяли район',
  TERRITORY_DEFENDED: 'отбили район',
  TERRITORY_HELD: 'владение районом',
  CYCLE_COMPLETED: 'закрыт цикл',
  SHIFT_COMPLETED: 'смена на объекте',
  CLAIM_FILED: 'заявка на район',
  SABOTAGE_FILED: 'диверсия',
  ROBBERY_FILED: 'ограбление',
  ADMIN_ADJUST: 'правка администратора',
}

const WAR_RESULT: Record<string, string> = {
  WON: 'победа', LOST: 'поражение', CANCELLED: 'отозвана', EXPIRED: 'истекла',
  PENDING: 'ждёт боя', BATTLE: 'бой идёт',
}

export function WarsSection() {
  const clan = useMyClan()
  const clanId = clan.clan?.id ?? ''

  const territories = useQuery({
    queryKey: ['clan-territories', clanId],
    queryFn: () => territoriesApi.clanTerritories(clanId),
    enabled: !!clanId,
  })
  const authority = useQuery({
    queryKey: ['clan-authority', clanId],
    queryFn: () => territoriesApi.authority(clanId),
    enabled: !!clanId,
  })
  const wars = useQuery({
    queryKey: ['clan-wars', clanId],
    queryFn: () => territoriesApi.clanWars(clanId),
    enabled: !!clanId,
  })

  if (clan.isLoading) return <Skeleton rows={3} />
  if (!clanId) {
    return (
      <Empty
        title="Вы не в бригаде"
        hint="Районы берёт бригада, а не одиночка. Вступите в бригаду или создайте свою."
      />
    )
  }
  if (territories.isError) return <Fault retry={() => territories.refetch()} />

  const held = territories.data
  const auth = authority.data

  return (
    <>
      <div className="s4-summary">
        <div className="s4-stat">
          <span className="s4-stat__label"><Landmark size={13} /> Районов</span>
          <b>{held ? `${held.items.length} из ${held.limit}` : '—'}</b>
        </div>
        <div className="s4-stat">
          <span className="s4-stat__label"><Coins size={13} /> Содержание</span>
          <b>{held ? `${fmt(held.upkeepPerDay)} ₽/сутки` : '—'}</b>
        </div>
        <div className="s4-stat">
          <span className="s4-stat__label"><ShieldCheck size={13} /> Авторитет</span>
          <b>{auth ? Math.round(auth.current) : '—'}</b>
        </div>
        {held && held.totalDebt > 0 && (
          <div className="s4-stat s4-stat--warn">
            <span className="s4-stat__label">Долг содержания</span>
            <b>{fmt(held.totalDebt)} ₽</b>
          </div>
        )}
      </div>

      <p className="s4-lead">
        Авторитет набирается сменами и закрытыми циклами, а тратится на заявки
        и налёты. Заявка стоит дороже, чем даёт победа, — поэтому воевать может
        только та бригада, которая что-то производит.
      </p>

      <h4>Наши районы</h4>
      {!held || held.items.length === 0
        ? <p className="s4-muted">Пока ни одного. Возьмите район на карте.</p>
        : (
          <ul className="s4-list">
            {held.items.map(row => (
              <li key={row.code}>
                <span>{row.name}</span>
                <span className="s4-muted">{row.bonus.text}</span>
              </li>
            ))}
          </ul>
        )}

      <h4><Swords size={12} /> История войн</h4>
      {!wars.data || wars.data.items.length === 0
        ? <p className="s4-muted">Войн ещё не было.</p>
        : (
          <ul className="s4-list s4-list--log">
            {wars.data.items.map((row, index) => (
              <li key={index}>
                <span className="s4-muted">{new Date(row.at).toLocaleDateString('ru-RU')}</span>
                <span>
                  {row.role === 'ATTACK' ? 'нападение' : 'оборона'} · {row.territoryCode}
                  {' · '}{WAR_RESULT[row.result] ?? row.result}
                </span>
                <span className={row.authorityDelta >= 0 ? 's4-plus' : 's4-minus'}>
                  {row.authorityDelta >= 0 ? '+' : ''}{row.authorityDelta}
                </span>
              </li>
            ))}
          </ul>
        )}

      {auth && auth.log.length > 0 && (
        <>
          <h4>Авторитет: откуда и куда</h4>
          <ul className="s4-list s4-list--log">
            {auth.log.slice(0, 12).map((row, index) => (
              <li key={index}>
                <span className="s4-muted">{new Date(row.at).toLocaleDateString('ru-RU')}</span>
                <span>{AUTHORITY_REASON[row.reason] ?? row.reason}</span>
                <span className={row.amount >= 0 ? 's4-plus' : 's4-minus'}>
                  {row.amount >= 0 ? '+' : ''}{Math.round(row.amount * 10) / 10}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
