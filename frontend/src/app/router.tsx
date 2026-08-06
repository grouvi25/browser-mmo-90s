import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuth } from './providers/auth-provider'
import { PublicLayout } from './layouts/public-layout'
import { GameShell } from './layouts/game-shell'
import { ViewportPanel, LockedSection } from '../shared/ui/viewport-panel'

import { LoginPage }           from '../pages/auth/login-page'
import { RegisterPage }        from '../pages/auth/register-page'
import { CreateCharacterPage } from '../pages/character/create-character-page'
import { HubPage }             from '../pages/hub/hub-page'
import { GaragesPage }         from '../pages/garages/garages-page'
import { DossierPage }         from '../pages/profile/dossier-page'
import { PublicProfilePage }   from '../pages/character/public-profile-page'
import { InventoryPage }       from '../pages/inventory/inventory-page'
import { GovernmentShopPage }  from '../pages/shop/government-shop-page'
import { BattlePage }          from '../pages/battle/battle-page'
import { BattleHistoryPage }   from '../pages/battles/battle-history-page'
import { RepairPage }          from '../pages/repair/repair-page'
import { SkillsPage }          from '../pages/skills/skills-page'
import { ArenaPage }           from '../pages/arena/arena-page'
import { AdminPage }           from '../pages/admin/admin-page'
import { StatsPage }           from '../pages/character/stats-page'
import { ResourcesPage }       from '../pages/resources/resources-page'
import { WorkPage }            from '../pages/work/work-page'
import { PrivateShopsPage }    from '../pages/private-shops/private-shops-page'
import { MarketPage }          from '../pages/market/market-page'
import { UpgradesPage }        from '../pages/upgrades/upgrades-page'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  if (!isAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  if (isAuth) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Разделы Этапов 2–3: место в интерфейсе есть, наполнение позже. */
const SOON: Record<string, { title: string; stage: number; what: string }> = {
  farms:     { title: 'Фермы', stage: 3, what: 'Личные участки: посадка, полив и урожай для баров и аптечек.' },
  kolhoz:    { title: 'Колхозы', stage: 3, what: 'Крупное производство сельхозсырья с рабочими местами.' },
  products:  { title: 'Продукты', stage: 3, what: 'Еда и напитки из баров, временные эффекты перед боем и работой.' },
  storage:   { title: 'Склад', stage: 2, what: 'Хранение ресурсов и деталей сверх носимого веса.' },
}

function SoonRoute() {
  const { key = '' } = useParams()
  const cfg = SOON[key] ?? { title: 'Раздел', stage: 2, what: 'Раздел ещё не открыт.' }
  return <LockedSection title={cfg.title} stage={cfg.stage} what={cfg.what} />
}

export function AppRouter() {
  return (
    <Routes>
      {/* ── Публичная часть ───────────────────────────────── */}
      <Route element={<PublicLayout />}>
        <Route path="/login"    element={<RequireGuest><LoginPage /></RequireGuest>} />
        <Route path="/register" element={<RequireGuest><RegisterPage /></RequireGuest>} />
      </Route>

      {/* ── Экраны без городской оболочки ─────────────────── */}
      <Route path="/character/create"
        element={<RequireAuth><CreateCharacterPage /></RequireAuth>} />
      <Route path="/profile"
        element={<RequireAuth><DossierPage /></RequireAuth>} />
      <Route path="/battle/:id"
        element={<RequireAuth><BattlePage /></RequireAuth>} />

      {/* ── Город: оболочка постоянна, меняется только вьюпорт ── */}
      <Route element={<RequireAuth><GameShell /></RequireAuth>}>
        <Route path="/" element={<HubPage />} />
        <Route path="/garages" element={<GaragesPage />} />

        <Route path="/shop" element={
          <ViewportPanel title="Рынок" subtitle="Государственные цены">
            <GovernmentShopPage />
          </ViewportPanel>} />

        <Route path="/repair" element={
          <ViewportPanel title="Гаражи" subtitle="Мастерская: ремонт снаряжения">
            <RepairPage />
          </ViewportPanel>} />

        <Route path="/inventory" element={
          <ViewportPanel title="Снаряжение" subtitle="Инвентарь и экипировка">
            <InventoryPage />
          </ViewportPanel>} />

        <Route path="/upgrades" element={
          <ViewportPanel title="Улучшения" subtitle="Риск: усиление вещей навсегда">
            <UpgradesPage />
          </ViewportPanel>} />

        <Route path="/market" element={
          <ViewportPanel title="Рынок игроков" subtitle="Объявления: вещи и сырьё">
            <MarketPage />
          </ViewportPanel>} />

        <Route path="/shops/private" element={
          <ViewportPanel title="Частные лавки" subtitle="Снаряжение 2-го уровня и детали">
            <PrivateShopsPage />
          </ViewportPanel>} />

        <Route path="/resources" element={
          <ViewportPanel title="Сырьё" subtitle="Материалы, детали и общий вес">
            <ResourcesPage />
          </ViewportPanel>} />

        <Route path="/skills" element={
          <ViewportPanel title="Владение оружием">
            <SkillsPage />
          </ViewportPanel>} />

        <Route path="/stats" element={
          <ViewportPanel title="Характеристики">
            <StatsPage />
          </ViewportPanel>} />

        <Route path="/pvp" element={
          <ViewportPanel title="Спальный район" subtitle="Бои с ботами и стрелки">
            <ArenaPage />
          </ViewportPanel>} />

        <Route path="/battles/history" element={
          <ViewportPanel title="История боёв">
            <BattleHistoryPage />
          </ViewportPanel>} />

        <Route path="/u/:nickname" element={
          <ViewportPanel title="Личное дело">
            <PublicProfilePage />
          </ViewportPanel>} />

        <Route path="/admin" element={
          <ViewportPanel title="Администрирование">
            <AdminPage />
          </ViewportPanel>} />

        <Route path="/soon/:key" element={<SoonRoute />} />
        <Route path="/work" element={
          <ViewportPanel title="Работа" subtitle="Смены, зарплата и производственный уровень">
            <WorkPage />
          </ViewportPanel>} />
        <Route path="/station" element={<LockedSection title="Вокзал" stage={2}
          what="Логистика и перевозки между районами." />} />
        <Route path="/news"    element={<LockedSection title="Новости" stage={2}
          what="Лента новостей проекта." />} />
        <Route path="/updates" element={<LockedSection title="Обновления" stage={2}
          what="История изменений и патчей." />} />
        <Route path="/forum"   element={<LockedSection title="Форум" stage={3}
          what="Общение, объявления и торговые темы." />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
