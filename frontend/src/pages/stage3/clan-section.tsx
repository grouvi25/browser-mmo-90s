import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, ShieldAlert, UserPlus, LogOut } from 'lucide-react'
import { clansApi, CLAN_PERMISSIONS, type ClanPermission } from '../../shared/api/clans.api'
import { fmt, Skeleton, Fault, Note } from './stage3-ui'
import { useMyClan } from './use-my-clan'

export function ClanSection() {
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
      <header className="clan-head">
        <div>
          <span className="clan-tag">[{clan.tag}]</span>
          <h2>{clan.name}</h2>
        </div>
        {clan.isFrozen && <b className="frozen"><ShieldAlert /> заморожен</b>}
      </header>

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
                canKick={can('KICK') && (member?.role.rank ?? 0) > row.role.rank}
                onDone={done}
                onFail={fail}
              />
            ))}
          </tbody>
        </table>
      </div>

      {can('ASSIGN_ROLE') && <RolesEditor roles={clan.roles ?? []} onDone={done} onFail={fail} />}

      {member?.role.code !== 'boss' && (
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

/** Игрок без клана: список бригад города и создание своей. */
function ClanDirectory({ onDone, onFail, msg, bad }: {
  onDone: (text: string) => void
  onFail: (e: Error) => void
  msg: string
  bad: boolean
}) {
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const list = useQuery({ queryKey: ['clans'], queryFn: clansApi.list })

  const create = useMutation({
    mutationFn: () => clansApi.create(name, tag),
    onSuccess: () => onDone('Бригада создана'),
    onError: onFail,
  })

  return (
    <div className="clan-layout">
      <aside>
        <div className="create-clan">
          <h2>Новая бригада</h2>
          <input placeholder="Название" value={name} onChange={e => setName(e.target.value)} />
          <input placeholder="Тег" maxLength={6} value={tag} onChange={e => setTag(e.target.value)} />
          <button
            disabled={create.isPending || name.trim().length < 3 || tag.trim().length < 2}
            onClick={() => create.mutate()}
          >
            Создать · 25 000 ₽
          </button>
          <small className="muted">Нужен 5-й боевой уровень. Содержание 500 ₽ в сутки из общака.</small>
          <Note text={msg} kind={bad ? 'bad' : 'ok'} />
        </div>
        <h3>Бригады города</h3>
        {list.data?.items.map(clan => (
          <div key={clan.id} className="clan-row">
            <b>[{clan.tag}]</b> {clan.name}
            <span>{clan.isFrozen ? 'заморожен' : clan.level + ' ур.'}</span>
          </div>
        ))}
      </aside>
      <section className="clan-sheet">
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
    mutationFn: () => clansApi.invite(target),
    onSuccess: () => { setTarget(''); onDone('Приглашение отправлено') },
    onError: onFail,
  })
  return (
    <div className="s3-toolbar">
      <label>
        Пригласить бойца (ID персонажа)
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="UUID персонажа" />
      </label>
      <button onClick={() => invite.mutate()} disabled={!target || invite.isPending}>
        <UserPlus size={15} /> Пригласить
      </button>
    </div>
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
  const assign = useMutation({
    mutationFn: (roleId: string) => clansApi.assignRole(member.characterId, roleId),
    onSuccess: () => onDone('Роль назначена'),
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
          <select
            value={member.role.id}
            aria-label={'Роль: ' + (member.character?.nickname ?? '')}
            onChange={e => assign.mutate(e.target.value)}
          >
            {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
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

/** Роль — это набор прав, который главарь может перенастроить. */
function RolesEditor({ roles, onDone, onFail }: {
  roles: Array<{ id: string; code: string; name: string; permissions: ClanPermission[] }>
  onDone: (t: string) => void
  onFail: (e: Error) => void
}) {
  const [openId, setOpenId] = useState('')
  const role = roles.find(r => r.id === openId)

  return (
    <section className="roles-editor">
      <h3>Роли и права</h3>
      <div className="s3-tabs">
        {roles.map(item => (
          <button
            key={item.id}
            className={openId === item.id ? 'active' : ''}
            onClick={() => setOpenId(openId === item.id ? '' : item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {role && <RoleForm key={role.id} role={role} onDone={onDone} onFail={onFail} />}
    </section>
  )
}

function RoleForm({ role, onDone, onFail }: {
  role: { id: string; code: string; name: string; permissions: ClanPermission[] }
  onDone: (t: string) => void
  onFail: (e: Error) => void
}) {
  const [name, setName] = useState(role.name)
  const [permissions, setPermissions] = useState<ClanPermission[]>(role.permissions)

  const save = useMutation({
    mutationFn: () => clansApi.updateRole(role.id, name, permissions),
    onSuccess: () => onDone('Права роли обновлены'),
    onError: onFail,
  })

  const toggle = (code: ClanPermission) =>
    setPermissions(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code])

  // Главарь не может отнять у себя право назначать роли — клан станет неуправляемым.
  const lockedOut = role.code === 'boss' && !permissions.includes('ASSIGN_ROLE')

  return (
    <div className="role-form">
      <label>
        Название роли
        <input value={name} onChange={e => setName(e.target.value)} />
      </label>
      <ul className="perm-list">
        {CLAN_PERMISSIONS.map(perm => (
          <li key={perm.code}>
            <label>
              <input
                type="checkbox"
                checked={permissions.includes(perm.code)}
                onChange={() => toggle(perm.code)}
              />
              {perm.label}
            </label>
          </li>
        ))}
      </ul>
      {lockedOut && <p className="s3-hint s3-hint--warn">Главарь обязан сохранить право «Назначать роли».</p>}
      <button onClick={() => save.mutate()} disabled={save.isPending || lockedOut || name.trim().length < 2}>
        Сохранить права
      </button>
    </div>
  )
}
