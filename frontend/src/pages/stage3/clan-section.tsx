import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, ShieldAlert, UserPlus, LogOut } from 'lucide-react'
import { clansApi, type ClanObject, type ClanTerritory } from '../../shared/api/clans.api'
import { fmt, Skeleton, Fault, Note } from './stage3-ui'
import { useMyClan } from './use-my-clan'
import { IncomingInvites } from './clan-invites'
import { ClanIconEditor } from './clan-icon-upload'

/** embedded — внутри «Домов бригад»: название там уже стоит в карточке дома. */
export function ClanSection({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient()
  const { me, clan, member, can, isLoading, isError, refetch, hasClan } = useMyClan()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const done = (text: string) => {
    setBad(false)
    setMsg(text)
    void qc.invalidateQueries({ queryKey: ['clan'] })
    void qc.invalidateQueries({ queryKey: ['clans'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const leave = useMutation({ mutationFn: clansApi.leave, onSuccess: () => done('Вы вышли из бригады'), onError: fail })

  if (isLoading) return <Skeleton rows={3} />
  if (isError) return <Fault retry={refetch} />
  if (!hasClan) return <ClanDirectory onDone={done} onFail={fail} msg={msg} bad={bad} />
  if (!clan) return <Skeleton rows={3} />

  return (
    <>
      {/* Тег не показываем (правка заказчика: «только название»). */}
      {(!embedded || clan.isFrozen) && <header className="clan-head">
        {!embedded && <h2>{clan.name}</h2>}
        {clan.isFrozen && <b className="frozen"><ShieldAlert /> заморожен</b>}
      </header>}

      {clan.isFrozen && (
        <p className="s3-hint s3-hint--warn">
          Долг по содержанию от 1 500 ₽: со склада можно только забирать, приглашать нельзя.
          Погасите долг в общаке — заморозка снимется сама.
        </p>
      )}

      <Note text={msg} kind={bad ? 'bad' : 'ok'} />

      <div className="clan-ledger">
        <div><span>Общак</span><b>{fmt(clan.treasury)} ₽</b></div>
        <div><span>Долг</span><b>{fmt(clan.maintenanceDebt)} ₽</b></div>
        <div><span>Состав</span><b>{clan.members?.length ?? 0}/{clan.memberCapacity}</b></div>
        <div><span>Склад</span><b>{clan.storage?.length ?? 0}/{clan.storageCapacity}</b></div>
        <div><span>Объекты</span><b>{clan.objects?.length ?? 0}/{clan.objectLimit ?? 0}</b></div>
      </div>

      {can('INVITE') && !clan.isFrozen && <InviteBox onDone={done} onFail={fail} />}

      <h3>Состав</h3>
      <div className="s3-scroll">
        <table className="s3-table">
          <thead>
            <tr><th>Боец</th><th>Уровень</th><th>Роль</th><th /></tr>
          </thead>
          <tbody>
            {clan.members?.map(row => (
              <MemberRow
                key={row.id}
                member={row}
                roles={clan.roles ?? []}
                isSelf={row.characterId === me?.id}
                canAssign={can('ASSIGN_ROLE')}
                canKick={can('KICK') && (member?.role?.rank ?? 0) > row.role.rank}
                onDone={done}
                onFail={fail}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ClanHoldings objects={clan.objects ?? []} territories={clan.territories ?? []} />

      {can('EDIT') && <ClanIconEditor clanId={clan.id} iconVersion={clan.iconVersion ?? 0} />}

      {member?.role?.code !== 'boss' && (
        <div className="clan-leave">
          <button
            className="danger"
            onClick={() => { if (window.confirm('Выйти из бригады? Вернуться можно будет через 48 часов.')) leave.mutate() }}
            disabled={leave.isPending}
          >
            <LogOut size={15} /> Выйти из бригады
          </button>
        </div>
      )}
    </>
  )
}

const OBJECT_STATUS: Record<ClanObject['status'], string> = {
  ACTIVE: 'работает', DISABLED: 'остановлен', HIDDEN: 'скрыт', DAMAGED: 'повреждён',
}
const TERRITORY_STATUS: Record<ClanTerritory['status'], string> = {
  CONTROLLED: 'под контролем', PROTECTED: 'под защитой', CONTESTED: 'назначен бой', UNDER_ATTACK: 'идёт бой',
}

/** Что принадлежит бригаде: переданные объекты и районы. */
function ClanHoldings({ objects, territories }: { objects: ClanObject[]; territories: ClanTerritory[] }) {
  return (
    <>
      <h3>Объекты бригады</h3>
      {objects.length === 0 ? (
        <p className="s3-hint">Пока пусто. Свой объект можно передать бригаде в разделе <Link to="/objects">Мои объекты</Link>.</p>
      ) : (
        <div className="s3-scroll">
          <table className="s3-table clan-objects">
            <thead>
              <tr><th>Объект</th><th>Уровень</th><th>Состояние</th><th>Касса</th></tr>
            </thead>
            <tbody>
              {objects.map(row => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.level}</td>
                  <td className={row.status === 'DAMAGED' ? 'bad' : undefined}>{OBJECT_STATUS[row.status]}</td>
                  <td>{fmt(row.balance)} ₽</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {objects.length > 0 && (
        <p className="s3-hint">
          Управлять объектами бригады — пополнять кассу из общака, выводить прибыль в общак, забирать выпуск
          на склад бригады — могут главарь и бригадир: <Link to="/objects">Мои объекты</Link>.
        </p>
      )}
      {territories.length > 0 && (
        <>
          <h3>Районы</h3>
          <div className="s3-scroll">
            <table className="s3-table clan-objects">
              <thead><tr><th>Район</th><th>Состояние</th></tr></thead>
              <tbody>
                {territories.map(row => (
                  <tr key={row.id}><td>{row.name}</td><td>{TERRITORY_STATUS[row.status]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/** Игрок без клана: список бригад города и создание своей. */
function ClanDirectory({ onDone, onFail, msg, bad }: {
  onDone: (text: string) => void
  onFail: (e: Error) => void
  msg: string
  bad: boolean
}) {
  const [name, setName] = useState('')
  const list = useQuery({ queryKey: ['clans'], queryFn: clansApi.list })

  const create = useMutation({
    mutationFn: () => clansApi.create(name.trim()),
    onSuccess: () => onDone('Бригада создана'),
    onError: onFail,
  })

  return (
    <div className="clan-layout">
      <aside>
        <div className="create-clan">
          <h2>Новая бригада</h2>
          <input placeholder="Название" value={name} onChange={e => setName(e.target.value)} />
          <button
            disabled={create.isPending || name.trim().length < 3}
            onClick={() => create.mutate()}
          >
            Создать · 1 000 $
          </button>
          <small className="muted">Нужен 5-й боевой уровень. Содержание 500 ₽ в сутки из общака.</small>
          <Note text={msg} kind={bad ? 'bad' : 'ok'} />
        </div>
        <h3>Бригады города</h3>
        {list.data?.items?.map(clan => (
          <div key={clan.id} className="clan-row">
            <b>{clan.name}</b>
            <span>{clan.isFrozen ? 'заморожен' : clan.level + ' ур.'}</span>
          </div>
        ))}
      </aside>
      <section className="clan-sheet">
        <IncomingInvites />
        <div className="clan-empty">
          <Users />
          <h2>Вы не в бригаде</h2>
          <p>Создайте свою или дождитесь приглашения. Клан даёт общий склад, общак и скидку на рынке.</p>
        </div>
      </section>
    </div>
  )
}

function InviteBox({ onDone, onFail }: { onDone: (t: string) => void; onFail: (e: Error) => void }) {
  const [target, setTarget] = useState('')
  const invite = useMutation({
    mutationFn: () => clansApi.invite(target.trim()),
    onSuccess: r => { setTarget(''); onDone(`Приглашение отправлено: ${r.nickname}. Оно ждёт бойца 48 часов в Домах бригад`) },
    onError: onFail,
  })
  return (
    <form className="s3-toolbar" onSubmit={e => { e.preventDefault(); invite.mutate() }}>
      <label>
        Пригласить бойца по нику
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="Ник бойца" maxLength={30} />
      </label>
      <button type="submit" disabled={target.trim().length < 2 || invite.isPending}>
        <UserPlus size={15} /> Пригласить
      </button>
    </form>
  )
}

function MemberRow({ member, roles, isSelf, canAssign, canKick, onDone, onFail }: {
  member: { id: string; characterId: string; role: { id: string; name: string }; character?: { nickname: string; battleLevel: number } }
  roles: Array<{ id: string; name: string }>
  isSelf: boolean
  canAssign: boolean
  canKick: boolean
  onDone: (t: string) => void
  onFail: (e: Error) => void
}) {
  // Правка заказчика 22.10: «Роли и права дублируются кучу раз — оставить
  // в одном месте, где список игроков, и ровные кнопки для смены
  // должности». Редактор прав ролей убран. Случайный клик не должен
  // менять должность и слать уведомление, поэтому смена — с подтверждением.
  const assign = useMutation({
    mutationFn: (roleId: string) => clansApi.assignRole(member.characterId, roleId),
    onSuccess: () => onDone('Должность сохранена. Игроку пришло уведомление в чат.'),
    onError: onFail,
  })
  const kick = useMutation({
    mutationFn: () => clansApi.kick(member.characterId),
    onSuccess: () => onDone('Боец исключён'),
    onError: onFail,
  })

  return (
    <tr>
      <td><b>{member.character?.nickname ?? member.characterId}</b>{isSelf && <span className="muted"> · вы</span>}</td>
      <td>{member.character?.battleLevel ?? '—'}</td>
      <td>
        {canAssign && !isSelf ? (
          <span className="role-buttons" role="group" aria-label={'Должность: ' + (member.character?.nickname ?? '')}
            style={{ gridTemplateColumns: `repeat(${roles.length}, 1fr)` }}>
            {roles.map(role => (
              <button key={role.id} type="button" aria-pressed={role.id === member.role.id}
                className={role.id === member.role.id ? 'is-current' : ''}
                disabled={role.id === member.role.id || assign.isPending}
                onClick={() => {
                  if (window.confirm(`Назначить ${member.character?.nickname ?? 'бойца'} на должность «${role.name}»?`)) assign.mutate(role.id)
                }}>
                {role.name}
              </button>
            ))}
          </span>
        ) : member.role.name}
      </td>
      <td>
        {canKick && !isSelf && (
          <button className="danger" onClick={() => kick.mutate()} disabled={kick.isPending}>Исключить</button>
        )}
      </td>
    </tr>
  )
}
