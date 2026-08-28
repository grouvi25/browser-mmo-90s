import { useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import { useAuth } from './providers/auth-provider'
import { PublicLayout } from './layouts/public-layout'
import { GameShell } from './layouts/game-shell'
import { ViewportPanel, LockedSection } from '../shared/ui/viewport-panel'

import { LoginPage }           from '../pages/auth/login-page'
import { RegisterPage }        from '../pages/auth/register-page'
import { CreateCharacterPage } from '../pages/character/create-character-page'
import { HubPage }             from '../pages/hub/hub-page'
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
import { BalanceSandboxPage }   from '../pages/balance-sandbox/balance-sandbox-page'
import { LocationHubPage, type DistrictKey } from '../pages/locations/location-hub-page'
import { Stage3Page }           from '../pages/stage3/stage3-page'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuth } = useAuth()
  if (!isAuth) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireGuest({ children, authenticatedTo = '/' }: { children: React.ReactNode; authenticatedTo?: string }) {
  const { isAuth } = useAuth()
  if (isAuth) return <Navigate to={authenticatedTo} replace />
  return <>{children}</>
}

/** Разделы Этапов 2–3: место в интерфейсе есть, наполнение позже. */
const SOON: Record<string, { title: string; stage: number; what: string }> = {
  storage:   { title: 'Склад', stage: 2, what: 'Хранение ресурсов и деталей сверх носимого веса.' },
  'equipment-production': { title: 'Производство шмота', stage: 3, what: 'Изготовление снаряжения в отдельной комнате Промзоны.' },
  logistics: { title: 'Перевозки', stage: 4, what: 'Доставка груза между районами и склад на станции.' },
}

function SoonRoute() {
  const { key = '' } = useParams()
  const cfg = SOON[key] ?? { title: 'Раздел', stage: 2, what: 'Раздел ещё не открыт.' }
  return <LockedSection title={cfg.title} stage={cfg.stage} what={cfg.what} />
}

/** Посадочная района: /district/<ключ>. Ключ неизвестен — уводим в Центр. */
const DISTRICTS: DistrictKey[] = ['market', 'industrial', 'agriculture', 'station', 'garages', 'suburb']

function DistrictRoute() {
  const { kind = '' } = useParams()
  if (!DISTRICTS.includes(kind as DistrictKey)) return <Navigate to="/" replace />
  return <LocationHubPage kind={kind as DistrictKey} />
}

function MetrikaTracker() {
  const location = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const ym = (window as typeof window & { ym?: (id:number, action:string, url:string, options:Record<string,string>) => void }).ym
    ym?.(111441325, 'hit', location.pathname + location.search, { title: document.title, referer: document.referrer })
  }, [location.pathname, location.search])
  return null
}

export function AppRouter() {
  return (
    <>
    <MetrikaTracker />
    <Routes>
      {/* ── Публичная часть ───────────────────────────────── */}
      <Route element={<PublicLayout />}>
        <Route path="/login"    element={<RequireGuest authenticatedTo="/profile"><LoginPage /></RequireGuest>} />
        <Route path="/register" element={<RequireGuest authenticatedTo="/character/create"><RegisterPage /></RequireGuest>} />
      </Route>

      {/* ── Экраны без городской оболочки ─────────────────── */}
      <Route path="/character/create"
        element={<RequireAuth><CreateCharacterPage /></RequireAuth>} />
      <Route path="/profile"
        element={<RequireAuth><DossierPage /></RequireAuth>} />
      <Route path="/battle/:id"
        element={<RequireAuth><BattlePage /></RequireAuth>} />
      <Route path="/balance-sandbox"
        element={<RequireAuth><BalanceSandboxPage /></RequireAuth>} />

      {/* ── Город: оболочка постоянна, меняется только вьюпорт ── */}
      <Route element={<RequireAuth><GameShell /></RequireAuth>}>
        <Route path="/" element={<HubPage />} />
        <Route path="/district/:kind" element={<DistrictRoute />} />
        {/* Прежние адреса посадочных остаются рабочими: на них есть ссылки
            в чужих закладках и в истории Метрики. */}
        <Route path="/garages" element={<Navigate to="/district/garages" replace />} />
        <Route path="/industrial" element={<Navigate to="/district/industrial" replace />} />
        <Route path="/agriculture" element={<Navigate to="/district/agriculture" replace />} />
        {/* Этап 3: одиннадцать разделов вместо прежних заглушек. */}
        <Route path="/farm" element={<Stage3Page section="farm" />} />
        <Route path="/plants" element={<Stage3Page section="plants" />} />
        <Route path="/objects" element={<Stage3Page section="objects" />} />
        <Route path="/recipes" element={<Stage3Page section="recipes" />} />
        <Route path="/bars" element={<Stage3Page section="bars" />} />
        <Route path="/bars/mine" element={<Stage3Page section="mybar" />} />
        <Route path="/clans" element={<Stage3Page section="clan" />} />
        <Route path="/clans/storage" element={<Stage3Page section="clan-storage" />} />
        <Route path="/clans/treasury" element={<Stage3Page section="clan-treasury" />} />
        <Route path="/clans/relations" element={<Stage3Page section="clan-relations" />} />

        <Route path="/shop" element={
          <ViewportPanel title="Госмагазин" subtitle="Государственные цены">
            <GovernmentShopPage />
          </ViewportPanel>} />

        <Route path="/repair" element={
          <ViewportPanel title="Мастерская" subtitle="Ремонт снаряжения">
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
          <ViewportPanel title="Барахолка" subtitle="Объявления игроков: вещи и сырьё">
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
          <ViewportPanel title="Стрелки" subtitle="Бои с ботами, дуэли и командные">
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
          <ViewportPanel title="Работа" subtitle="Смены, зарплата и профессии">
            <WorkPage />
          </ViewportPanel>} />
        <Route path="/station" element={<Navigate to="/district/station" replace />} />
        {/* Радио есть в макете верхнего меню, но что за ним стоит —
            заказчиком не описано. Держим место, как и другие разделы,
            у которых интерфейс есть, а наполнение впереди. */}
        <Route path="/radio" element={<LockedSection title="Радио" stage={4}
          what="Городская радиостанция: музыка и объявления." />} />
        <Route path="/news"    element={<LockedSection title="Новости" stage={2}
          what="Лента новостей проекта." />} />
        <Route path="/updates" element={<LockedSection title="Обновления" stage={2}
          what="История изменений и патчей." />} />
        <Route path="/forum"   element={<LockedSection title="Форум" stage={3}
          what="Общение, объявления и торговые темы." />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
