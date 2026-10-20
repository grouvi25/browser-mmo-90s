import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes } from 'lucide-react'
import { clansApi } from '../../shared/api/clans.api'
import { resourcesApi } from '../../shared/api/resources.api'
import { fmt, Skeleton, Fault, Empty, Note } from './stage3-ui'
import { useMyClan } from './use-my-clan'

/** Клановый склад: предметы и ресурсы в одной таблице с единым лимитом. */
export function ClanStorageSection() {
  const qc = useQueryClient()
  const { me, clan, can, isLoading, isError, refetch, hasClan } = useMyClan()
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState(1)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const mine = useQuery({ queryKey: ['resources'], queryFn: resourcesApi.list })
  // Журнал видят главарь и бригадир; остальным запрос не шлём.
  const canSeeLog = (clan?.members?.find(m => m.characterId === me?.id)?.role?.rank ?? 0) >= 70
  const [logPage, setLogPage] = useState(1)
  const log = useQuery({ queryKey: ['clan', 'storage-log', logPage], queryFn: () => clansApi.storageLog(logPage), enabled: canSeeLog, retry: false, placeholderData: prev => prev })

  const done = (text: string) => {
    setBad(false)
    setMsg(text)
    void qc.invalidateQueries({ queryKey: ['clan'] })
    void qc.invalidateQueries({ queryKey: ['resources'] })
    void qc.invalidateQueries({ queryKey: ['clan', 'storage-log'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const put = useMutation({ mutationFn: () => clansApi.storageDeposit(code, amount), onSuccess: () => done('Положено на склад'), onError: fail })
  const take = useMutation({ mutationFn: () => clansApi.storageWithdraw(code, amount), onSuccess: () => done('Взято со склада'), onError: fail })

  if (isLoading) return <Skeleton rows={3} />
  if (isError) return <Fault retry={refetch} />
  if (!hasClan) return <Empty title="Вы не в бригаде" hint="Склад открывается вместе с вступлением в бригаду." />
  if (!clan) return <Skeleton rows={3} />

  const rows = clan.storage ?? []
  const myStacks = mine.data?.items ?? []

  return (
    <>
      <div className="clan-ledger">
        <div><span>Занято мест</span><b>{rows.length}/{clan.storageCapacity}</b></div>
        <div><span>Уровень бригады</span><b>{clan.level}</b></div>
      </div>

      {clan.isFrozen && (
        <p className="s3-hint s3-hint--warn">
          Бригада заморожена: со склада можно только забирать, пока не погашен долг.
        </p>
      )}

      <section className="s3-toolbar">
        <label>
          Ресурс
          <select value={code} onChange={e => setCode(e.target.value)}>
            <option value="">— выберите —</option>
            {myStacks.map(stack => (
              <option key={stack.id} value={stack.template.code}>
                {stack.template.name} · у вас {stack.amount}
              </option>
            ))}
            {rows.filter(row => !myStacks.some(s => s.template.code === row.resourceCode)).map(row => (
              <option key={row.resourceCode} value={row.resourceCode}>{row.resourceName ?? row.resourceCode} · на складе {row.amount}</option>
            ))}
          </select>
        </label>
        <label>
          Сколько
          <input type="number" min={1} value={amount} onChange={e => setAmount(Number(e.target.value))} />
        </label>
        <button onClick={() => put.mutate()} disabled={!code || put.isPending || !can('STORAGE_PUT') || clan.isFrozen}>
          Положить
        </button>
        <button onClick={() => take.mutate()} disabled={!code || take.isPending || !can('STORAGE_TAKE')}>
          Забрать
        </button>
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </section>

      {!can('STORAGE_TAKE') && (
        <p className="s3-hint">Ваша роль не может брать со склада — только класть.</p>
      )}

      {rows.length === 0 ? (
        <Empty title="Склад пуст" hint="Положите на склад сырьё — оно станет общим для бригады." />
      ) : (
        <div className="s3-scroll">
          <table className="s3-table">
            <thead><tr><th>Ресурс</th><th>Количество</th></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.resourceCode}>
                  <td><Boxes size={15} /> {row.resourceName ?? row.resourceCode}</td>
                  <td>{fmt(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSeeLog && (
        <section className="storage-log">
          <h3>Журнал склада</h3>
          {log.isLoading && <p role="status">Загрузка…</p>}
          {log.data && log.data.items.length === 0 && <p className="muted">Движений пока не было.</p>}
          {log.data && log.data.items.length > 0 && (
            <div className="s3-scroll">
              <table className="s3-table">
                <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Сколько</th></tr></thead>
                <tbody>
                  {log.data.items.map(row => (
                    <tr key={row.id}>
                      <td>{new Date(row.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>{row.nickname}</td>
                      <td>{row.resource}</td>
                      <td className={row.amount > 0 ? 'log-in' : 'log-out'}>{row.amount > 0 ? `положил ${fmt(row.amount)}` : `взял ${fmt(-row.amount)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {log.data && log.data.pages > 1 && (
            <nav className="storage-log__pages" aria-label="Страницы журнала">
              {Array.from({ length: log.data.pages }, (_, index) => index + 1).map(page => (
                <button key={page} type="button" aria-current={page === log.data.page ? 'page' : undefined}
                  className={page === log.data.page ? 'is-active' : ''} onClick={() => setLogPage(page)}>
                  {page}
                </button>
              ))}
            </nav>
          )}
        </section>
      )}
    </>
  )
}
