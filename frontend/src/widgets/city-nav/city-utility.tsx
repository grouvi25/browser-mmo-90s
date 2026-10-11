import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'
export function CityUtility() {
  const { signOut } = useAuth(); const navigate = useNavigate()
  async function logout() { try { await authApi.logout() } finally { signOut(); navigate('/login') } }
  return <nav className="city-utility" aria-label="Личное меню"><Link to="/profile">Профиль</Link><Link to="/radio">Радио</Link><button type="button" onClick={() => void logout().catch(() => undefined)}>Выход</button></nav>
}
