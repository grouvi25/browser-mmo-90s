// Бригады: список и карточка. В карточке главное — сверка авторитета с
// журналом: расхождение означает либо дефект, либо правку мимо приложения.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { Table, Audit, ReasonForm, when, rub } from '../admin-ui'

export function ClansSection() {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['admin', 'clans', query], queryFn: () => adminApi.clans(query || undefined) })

  if (list.isLoading) return <Skeleton rows={5} />
  if (list.isError) return <Fault retry={() => list.refetch()} />
  const items = list.data?.items ?? []

  return (
    <>
      <input
        className="adm-search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Название или тег бригады"
        aria-label="Поиск бригады"
      />

      {items.length === 0
        ? <Empty title="Бригад нет" hint="Либо их ещё не создали, либо поиск слишком узкий." />
        : (
          <Table head={['Тег', 'Название', 'Состав', 'Общак', 'Авторитет', 'Районы', 'Долг', '']}>
            {items.map(clan => (
              <tr key={clan.id} className={clan.isFrozen ? 'adm-frozen' : ''}>
                <td><b>[{clan.tag}]</b></td>
                <td>{clan.name}</td>
                <td>{clan.members}</td>
                <td>{rub(clan.treasury)}</td>
                <td>{clan.authority}</td>
                <td>{clan.territories} / {clan.territoryLimit}</td>
                <td className={clan.maintenanceDebt > 0 ? 'adm-bad' : ''}>{rub(clan.maintenanceDebt)}</td>
                <td>
                  <button type="button" onClick={() => setOpenId(openId === clan.id ? null : clan.id)}>
                    {openId === clan.id ? 'Скрыть' : 'Открыть'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}

      {openId && <ClanCard clanId={openId} />}
    </>
  )
}

function ClanCard({ clanId }: { clanId: string }) {
  const qc = useQueryClient()
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const [amount, setAmount] = useState('10')
  const card = useQuery({ queryKey: ['admin', 'clan', clanId], queryFn: () => adminApi.clanCard(clanId) })

  const adjust = useMutation({
    mutationFn: (reason: string) => adminApi.adjustAuthority(clanId, Number(amount), reason),
    onSuccess: () => {
      setBad(false); setMsg('Авторитет поправлен, действие записано в журнал.')
      void qc.invalidateQueries({ queryKey: ['admin', 'clan', clanId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'clans'] })
    },
    onError: (error: Error) => { setBad(true); setMsg(error.message) },
  })

  if (card.isLoading) return <Skeleton rows={4} />
  if (card.isError) return <Fault retry={() => card.refetch()} />
  const data = card.data!

  return (
    <section className="adm-card-block">
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <h4>[{data.clan.tag}] {data.clan.name}</h4>

      <dl className="adm-facts">
        <div><dt>Общак</dt><dd>{rub(data.clan.treasury)} ₽</dd></div>
        <div><dt>Содержание</dt><dd>{rub(data.clan.upkeepPerDay)} ₽/сутки</dd></div>
        <div><dt>Долг</dt><dd className={data.clan.maintenanceDebt > 0 ? 'adm-bad' : ''}>{rub(data.clan.maintenanceDebt)} ₽</dd></div>
        <div><dt>Открытых заявок</dt><dd>{data.openClaims}</dd></div>
        <div><dt>Налётов сделано</dt><dd>{data.attacksMade}</dd></div>
        <div>
          <dt>Авторитет</dt>
          <dd><Audit ok={data.authorityAudit.matches} stored={data.authorityAudit.stored} fromLog={data.authorityAudit.fromLog} /></dd>
        </div>
      </dl>

      <ReasonForm
        label="Поправить авторитет"
        busy={adjust.isPending}
        onSubmit={reason => adjust.mutate(reason)}
      >
        <input
          className="adm-amount"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          aria-label="На сколько поправить авторитет"
        />
      </ReasonForm>

      <h5>Состав</h5>
      <Table head={['Ник', 'Уровень', 'Роль', 'Статус']}>
        {data.members.map(member => (
          <tr key={member.characterId}>
            <td>{member.nickname ?? '—'}</td>
            <td>{member.battleLevel ?? '—'}</td>
            <td>{member.role}</td>
            <td>{member.status}</td>
          </tr>
        ))}
      </Table>

      <h5>Журнал авторитета</h5>
      <Table head={['Когда', 'Сколько', 'Остаток', 'Причина']}>
        {data.authorityLog.slice(0, 15).map((row, index) => (
          <tr key={index}>
            <td>{when(row.createdAt)}</td>
            <td className={row.amount < 0 ? 'adm-bad' : 'adm-ok'}>{row.amount}</td>
            <td>{row.balanceAfter}</td>
            <td>{row.reason}</td>
          </tr>
        ))}
      </Table>
    </section>
  )
}
