// Сотрудники и роли (правка 30.10). Владелец назначает игрока по нику,
// меняет роль и выключает доступ; смена роли сразу закрывает его сессии.
// Ниже — что разрешено каждой роли и журнал входов и назначений.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type StaffRole } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table, when } from '../admin-ui'

const ACTIONS: Record<string, string> = {
  login: 'вошёл', login_failed: 'неверный ник или пароль', code_sent: 'код отправлен на почту', code_wrong: 'неверный код',
  code_failed: 'письмо с кодом не ушло', logout_all: 'вышел везде', staff_added: 'назначил сотрудника',
  staff_role: 'сменил роль', staff_disabled: 'выключил доступ', staff_enabled: 'вернул доступ',
}

export function StaffSection() {
  const qc = useQueryClient()
  const [nickname, setNickname] = useState('')
  const [role, setRole] = useState<StaffRole>('MODERATOR')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const list = useQuery({ queryKey: ['admin', 'staff'], queryFn: adminApi.staff })
  const events = useQuery({ queryKey: ['admin', 'staff', 'events'], queryFn: adminApi.staffEvents })
  const me = useQuery({ queryKey: ['admin', 'me'], queryFn: adminApi.me })

  const done = (text: string) => { setBad(false); setMsg(text); void qc.invalidateQueries({ queryKey: ['admin', 'staff'] }) }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }
  const add = useMutation({
    mutationFn: () => adminApi.staffAdd(nickname.trim(), role),
    onSuccess: () => { done(`${nickname.trim()} теперь в команде. Вход — его ник и пароль, код придёт на почту аккаунта.`); setNickname('') },
    onError: fail,
  })
  const update = useMutation({
    mutationFn: (v: { id: string; role?: StaffRole; isActive?: boolean; who: string }) => adminApi.staffUpdate(v.id, { role: v.role, isActive: v.isActive }),
    onSuccess: (_r, v) => done(v.isActive === false ? `${v.who}: доступ выключен, все его входы закрыты.` : v.isActive ? `${v.who}: доступ возвращён.` : `${v.who}: роль сменена, войдёт заново с новыми правами.`),
    onError: fail,
  })

  if (list.isLoading) return <Skeleton rows={4} />
  if (list.isError || !list.data) return <Fault retry={() => list.refetch()} />
  const roles = list.data.roles
  const titles = me.data?.permissionTitles

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <section className="adm-card-block">
        <h4>Добавить сотрудника</h4>
        <p className="adm-hint">Сотрудник — обычный игровой аккаунт. Он входит в панель своим ником и паролем, вторым шагом — код из письма на почту аккаунта.</p>
        <form className="admx-staff-add" onSubmit={e => { e.preventDefault(); if (nickname.trim()) add.mutate() }}>
          <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Ник игрока" aria-label="Ник игрока" maxLength={64} />
          <select value={role} onChange={e => setRole(e.target.value as StaffRole)} aria-label="Роль">
            {roles.map(r => <option key={r.role} value={r.role}>{r.title}</option>)}
          </select>
          <button type="submit" disabled={!nickname.trim() || add.isPending}>{add.isPending ? 'Добавляем…' : 'Добавить'}</button>
        </form>
      </section>

      {list.data.items.length === 0
        ? <Empty title="Сотрудников нет" hint="Добавьте первого по нику." />
        : <Table head={['Ник', 'Роль', 'Почта', 'Последний вход', 'Добавил', 'Доступ']}>
            {list.data.items.map(row => (
              <tr key={row.id} className={row.isActive ? undefined : 'is-muted'}>
                <td><b>{row.nickname}</b>{row.level != null && ` [${row.level}]`}</td>
                <td>
                  <select value={row.role} disabled={update.isPending || !row.isActive} aria-label={`Роль: ${row.nickname}`}
                    onChange={e => update.mutate({ id: row.id, role: e.target.value as StaffRole, who: row.nickname })}>
                    {roles.map(r => <option key={r.role} value={r.role}>{r.title}</option>)}
                  </select>
                </td>
                <td>{row.email}</td>
                <td>{when(row.lastLoginAt)}</td>
                <td>{row.createdBy ?? '—'}</td>
                <td>
                  <button type="button" disabled={update.isPending}
                    onClick={() => update.mutate({ id: row.id, isActive: !row.isActive, who: row.nickname })}>
                    {row.isActive ? 'Выключить' : 'Включить'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>}

      <section className="adm-card-block">
        <h4>Что может каждая роль</h4>
        <dl className="admx-roles">
          {roles.map(r => (
            <div key={r.role}>
              <dt>{r.title}</dt>
              <dd>{r.permissions.map(p => titles?.[p] ?? p).join('; ')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="adm-card-block">
        <h4>Журнал: входы и назначения</h4>
        {events.isLoading && <Skeleton rows={3} />}
        {events.data && (events.data.items.length === 0
          ? <p className="adm-hint">Пока пусто.</p>
          : <Table head={['Когда', 'Кто', 'Что', 'Подробности', 'Адрес']}>
              {events.data.items.map(ev => (
                <tr key={ev.id}>
                  <td>{when(ev.createdAt)}</td>
                  <td>{ev.label}</td>
                  <td className={ev.action.includes('failed') || ev.action === 'code_wrong' ? 'is-bad' : undefined}>{ACTIONS[ev.action] ?? ev.action}</td>
                  <td>{ev.details ? describe(ev.details) : '—'}</td>
                  <td>{ev.ip ?? '—'}</td>
                </tr>
              ))}
            </Table>)}
      </section>
    </>
  )
}

function describe(details: Record<string, unknown>): string {
  const roleTitle = (code: unknown) => ({ OWNER: 'владелец', ADMIN: 'администратор', GAMEDESIGNER: 'геймдизайнер', MODERATOR: 'модератор', SUPPORT: 'поддержка', FINANCE: 'финансы' } as Record<string, string>)[String(code)] ?? String(code)
  if (details.nickname && details.from && details.to && details.from !== details.to) return `${details.nickname}: ${roleTitle(details.from)} → ${roleTitle(details.to)}`
  if (details.nickname && details.role) return `${details.nickname}: ${roleTitle(details.role)}`
  if (details.nickname) return String(details.nickname)
  if (details.attempts) return `попытка ${details.attempts}`
  if (details.sessions !== undefined) return `закрыто входов: ${details.sessions}, устройств: ${details.devices}`
  if (details.via) return details.via === 'device' ? 'с запомненного устройства' : details.via === 'code+remember' ? 'с кодом, устройство запомнено' : 'с кодом из письма'
  return ''
}
