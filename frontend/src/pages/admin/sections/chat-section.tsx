// Чат игроков за срок (просьба заказчика 22.10): прочитать, что пишут в
// общем эфире и в районах, и выгрузить файлом. В игре лента показывает
// только сегодняшний день, здесь — всё, что лежит в базе. Бригадные и
// личные сообщения сюда не попадают.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type ChatLogRow } from '../admin-api'
import { Skeleton, Fault, Empty } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'

const PERIODS = [1, 3, 7, 30, 90]

function line(row: ChatLogRow): string {
  const where = row.channel === 'GLOBAL' ? 'общий' : `район ${row.district}`
  return `[${new Date(row.at).toLocaleString('ru-RU')}] (${where}) ${row.author} [${row.level}]: ${row.text}${row.hidden ? '  (спрятано модератором)' : ''}`
}

export function ChatSection() {
  const [days, setDays] = useState(7)
  const [filter, setFilter] = useState('')
  const log = useQuery({ queryKey: ['admin', 'chat', days], queryFn: () => adminApi.chatLog(days) })
  const needle = filter.trim().toLowerCase()
  const items = (log.data?.items ?? []).filter(r => !needle || r.text.toLowerCase().includes(needle) || r.author.toLowerCase().includes(needle))

  const download = () => {
    const text = items.map(line).join('\n') + '\n'
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-${new Date().toISOString().slice(0, 10)}-${days}d.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="adm-switch">
        {PERIODS.map(d => (
          <button key={d} type="button" className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
            {d === 1 ? 'Сутки' : `${d} дн.`}
          </button>
        ))}
      </div>
      <div className="s3-toolbar">
        <label>Поиск по тексту или нику<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="например: правка" /></label>
        <button type="button" disabled={items.length === 0} onClick={download}>Скачать файлом ({items.length})</button>
      </div>
      {log.isLoading && <Skeleton rows={6} />}
      {log.isError && <Fault retry={() => log.refetch()} />}
      {log.data && (items.length === 0
        ? <Empty title="Сообщений нет" hint="За выбранный срок в общем чате пусто." />
        : <div className="s3-scroll">
            <table className="s3-table">
              <thead><tr><th>Когда</th><th>Где</th><th>Кто</th><th>Сообщение</th></tr></thead>
              <tbody>{items.map(r => (
                <tr key={r.id} className={r.hidden ? 'muted' : undefined}>
                  <td>{when(r.at)}</td>
                  <td>{r.channel === 'GLOBAL' ? 'общий' : r.district}</td>
                  <td>{r.author} <small>[{r.level}]</small></td>
                  <td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.text}{r.hidden && <i> — спрятано</i>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>)}
    </>
  )
}
