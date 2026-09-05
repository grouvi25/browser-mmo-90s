// =============================================================
// Разбор алерта.
//
// Было: строка «HIGH_MONEY_GINI» и кнопка, ведущая на вкладку баланса —
// то есть в никуда: что искать среди 29 формул, администратор угадывал
// сам.
//
// Стало: что случилось числом, чем грозит, какой порог пробит и где он
// лежит, УЛИКИ — конкретные игроки и причины начислений из базы, — и
// кнопки, каждая из которых ведёт ровно туда, где с этим что-то делают.
// =============================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw, User } from 'lucide-react'
import { adminApi, type AlertCard } from '../admin-api'

export function AlertsPanel({
  onGo, openPlayers,
}: {
  onGo: (tab: string, focus?: string) => void
  openPlayers: (characterId: string) => void
}) {
  const qc = useQueryClient()
  const alerts = useQuery({ queryKey: ['admin', 'alerts'], queryFn: adminApi.alerts })
  const recheck = useMutation({
    mutationFn: adminApi.recheckAlerts,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
  })

  const cards = alerts.data?.cards ?? []

  if (alerts.isLoading) return null

  if (cards.length === 0) {
    return (
      <div className="adm-verdict adm-verdict--ok">
        <p>
          <CheckCircle2 size={15} />
          Экономика в норме — ни один порог не пробит
          {alerts.data?.snapshotDate && <> (снимок за {alerts.data.snapshotDate})</>}.
        </p>
        <RecheckButton busy={recheck.isPending} onClick={() => recheck.mutate()} />
      </div>
    )
  }

  return (
    <section className="adm-alerts">
      <div className="adm-alerts__head">
        <h4><AlertTriangle size={15} /> Требует внимания: {cards.length}</h4>
        <RecheckButton busy={recheck.isPending} onClick={() => recheck.mutate()} />
      </div>
      {cards.map(card => (
        <AlertBlock key={card.code} card={card} onGo={onGo} openPlayers={openPlayers} />
      ))}
    </section>
  )
}

function RecheckButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="adm-link" onClick={onClick} disabled={busy}
      title="Пересчитать метрики сейчас, не дожидаясь ночного воркера">
      <RefreshCw size={12} /> {busy ? 'Считаю…' : 'Пересчитать сейчас'}
    </button>
  )
}

function AlertBlock({
  card, onGo, openPlayers,
}: {
  card: AlertCard
  onGo: (tab: string, focus?: string) => void
  openPlayers: (characterId: string) => void
}) {
  // Тяжёлые открыты сразу: если экономику печатает, читать про это надо
  // не после клика.
  const [open, setOpen] = useState(card.severity === 'act')

  return (
    <article className={`adm-alert adm-alert--${card.severity}`}>
      <button type="button" className="adm-alert__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{card.title}</b>
        <code>{card.code}</code>
      </button>

      {open && (
        <div className="adm-alert__body">
          <p className="adm-alert__what">{card.what}</p>
          <p className="adm-alert__why">{card.why}</p>

          <p className="adm-alert__threshold">
            Порог <code>{card.threshold.path}</code>: норма {card.threshold.limit},
            сейчас <b>{card.threshold.actual}</b>
          </p>

          <h5>{card.evidenceTitle}</h5>
          <ul className="adm-alert__evidence">
            {card.evidence.map((row, index) => (
              <li key={index}>
                <span>{row.label}</span>
                <b>{row.value}</b>
                {/* Улика про конкретного игрока открывается одним нажатием:
                    иначе его пришлось бы искать в списке руками. */}
                {row.characterId && (
                  <button type="button" className="adm-link" onClick={() => openPlayers(row.characterId!)}>
                    <User size={11} /> открыть
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="adm-alert__actions">
            {card.actions.map((action, index) => (
              <button key={index} type="button" className="adm-link"
                onClick={() => onGo(action.tab, action.focus)}>
                {action.label} <ArrowRight size={11} />
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}
