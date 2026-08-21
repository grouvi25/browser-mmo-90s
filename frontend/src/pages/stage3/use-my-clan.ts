import { useQuery } from '@tanstack/react-query'
import { charactersApi } from '../../shared/api/characters.api'
import { clansApi, type ClanPermission } from '../../shared/api/clans.api'

/**
 * Клан текущего игрока и его права.
 *
 * Права проверяются по роли, а не по её названию: главарь может
 * перенастроить набор прав под свой клан, и интерфейс обязан идти за
 * правами, иначе кнопки разойдутся с тем, что разрешает сервер.
 */
export function useMyClan() {
  const me = useQuery({ queryKey: ['character'], queryFn: charactersApi.getMe })
  const clanId = me.data?.clanId ?? ''
  const clan = useQuery({
    queryKey: ['clan', clanId],
    queryFn: () => clansApi.get(clanId),
    enabled: Boolean(clanId),
  })

  const member = clan.data?.members?.find(row => row.characterId === me.data?.id)
  const permissions = member?.role.permissions ?? []

  return {
    me: me.data,
    clan: clan.data,
    member,
    can: (permission: ClanPermission) => permissions.includes(permission),
    isLoading: me.isLoading || (Boolean(clanId) && clan.isLoading),
    isError: clan.isError,
    refetch: () => clan.refetch(),
    hasClan: Boolean(clanId),
  }
}
