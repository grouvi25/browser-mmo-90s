// Страница /novichok: письмо Бывалого с ником игрока (Дмитрий 09.11.2026).
import { useQuery } from '@tanstack/react-query'
import { charactersApi } from '../../shared/api/characters.api'
import { NewcomerLetterBody } from './newcomer-letter'

export function NewcomerLetterPage() {
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), retry: false })
  return <NewcomerLetterBody nick={me.data?.nickname} />
}
