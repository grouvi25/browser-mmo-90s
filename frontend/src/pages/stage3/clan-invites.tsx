// =============================================================
// Входящие приглашения в бригаду.
//
// Правка заказчика «в бригаду не работают приглашения»: сервер
// приглашения создавал, но приглашённый нигде их не видел, и принять
// было негде. Список показывается всем, кто ещё не в бригаде.
// =============================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clansApi } from '../../shared/api/clans.api'
import { ApiError } from '../../shared/api/client'

export function IncomingInvites() {
  const qc = useQueryClient()
  const invites = useQuery({ queryKey: ['clan', 'invites'], queryFn: clansApi.myInvites, refetchInterval: 30_000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['clan'] })
    void qc.invalidateQueries({ queryKey: ['clans'] })
    void qc.invalidateQueries({ queryKey: ['character'] })
  }
  const accept = useMutation({ mutationFn: clansApi.accept, onSuccess: refresh })
  const decline = useMutation({ mutationFn: clansApi.decline, onSuccess: refresh })
  const items = invites.data?.items ?? []
  const error = accept.error ?? decline.error
  if (items.length === 0 && !error) return null

  return (
    <section className="clan-invites" aria-label="Приглашения в бригаду">
      <h3>Вас зовут в бригаду</h3>
      {error && <p className="alert alert-error" role="alert">{error instanceof ApiError ? error.message : 'Не получилось'}</p>}
      <ul>
        {items.map(invite => (
          <li key={invite.id}>
            <span>
              <b>«{invite.clan.name}»</b>
              {invite.invitedBy && <> · зовёт {invite.invitedBy}</>}
              <small className="muted"> · до {new Date(invite.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
            </span>
            <span className="clan-invites__actions">
              <button className="btn btn-primary btn-sm" disabled={accept.isPending || decline.isPending}
                onClick={() => accept.mutate(invite.id)}>Вступить</button>
              <button className="btn btn-sm" disabled={accept.isPending || decline.isPending}
                onClick={() => decline.mutate(invite.id)}>Отказаться</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
