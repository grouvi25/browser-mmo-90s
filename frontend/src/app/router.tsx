import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './providers/auth-provider'
import { PublicLayout } from './layouts/public-layout'
import { GameLayout } from './layouts/game-layout'

import { LoginPage }          from '../pages/auth/login-page'
import { RegisterPage }       from '../pages/auth/register-page'
import { CreateCharacterPage } from '../pages/character/create-character-page'
import { ProfilePage }        from '../pages/character/profile-page'
import { InventoryPage }      from '../pages/inventory/inventory-page'
import { GovernmentShopPage } from '../pages/shop/government-shop-page'
import { BattlePage }         from '../pages/battle/battle-page'
import { RepairPage }         from '../pages/repair/repair-page'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  if (!isAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  if (isAuth) return <Navigate to="/profile" replace />
  return <>{children}</>
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public routes */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={
          <RequireGuest><LoginPage /></RequireGuest>
        } />
        <Route path="/register" element={
          <RequireGuest><RegisterPage /></RequireGuest>
        } />
      </Route>

      {/* Game routes */}
      <Route element={<RequireAuth><GameLayout /></RequireAuth>}>
        <Route path="/character/create" element={<CreateCharacterPage />} />
        <Route path="/profile"          element={<ProfilePage />} />
        <Route path="/inventory"        element={<InventoryPage />} />
        <Route path="/shop"             element={<GovernmentShopPage />} />
        <Route path="/battle/:id"       element={<BattlePage />} />
        <Route path="/repair"           element={<RepairPage />} />
      </Route>

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/profile" replace />} />
      <Route path="*" element={<Navigate to="/profile" replace />} />
    </Routes>
  )
}
