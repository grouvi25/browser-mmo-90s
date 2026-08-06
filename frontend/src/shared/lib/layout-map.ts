// =============================================================
// Координаты элементов из PSD-макетов, пересчитанные в систему
// сцены (макет / 2). Единственный источник правды по раскладке:
// если макет поменяется — правим только этот файл.
//
// Макеты версии 3 (получены 05.08.2026) нарисованы в 16:9 вместо
// прежнего печатного A4, поэтому оба экрана теперь одной высоты
// и масштабируются одним правилом — привязывать профиль к меню,
// как раньше, больше не нужно.
//   меню    3100x1800 -> сцена 1550x900
//   профиль 3200x1800 -> сцена 1600x900
// =============================================================
import type { StageBox } from './stage'

export const MENU_STAGE = { w: 1550, h: 900 }
export const PROFILE_STAGE = { w: 1600, h: 900 }

const box = (x: number, y: number, w: number, h: number): StageBox => ({ x, y, w, h })

// ── Главный экран ────────────────────────────────────────────
export const MENU = {
  /** верхнее меню; reconnect — действие, а не раздел, подсветку не получает */
  nav: [
    { key: 'reconnect', label: 'переподключиться к игре', x: 44, y: 5, w: 251, to: '/', action: true },
    { key: 'news', label: 'новости', x: 362.5, y: 5.5, w: 77.5, to: '/news', action: false },
    { key: 'updates', label: 'обновления', x: 492, y: 5.5, w: 115, to: '/updates', action: false },
    { key: 'forum', label: 'форум', x: 654, y: 4, w: 65.5, to: '/forum', action: false },
    { key: 'profile', label: 'профиль', x: 789.5, y: 4, w: 86, to: '/profile', action: false },
  ],
  navExit: { label: 'выход', x: 1471.5, y: 5.5, w: 60 },
  navFontSize: 21.9,
  navDy: -2,

  /** районы города — переключают содержимое центрального вьюпорта */
  districts: [
    { key: 'center', label: 'центр', x: 372, y: 98, w: 56.5, to: '/' },
    { key: 'market', label: 'рынок', x: 500, y: 96.5, w: 62, to: '/market' },
    { key: 'industrial', label: 'промзона', x: 629.5, y: 97.5, w: 96, to: '/work' },
    { key: 'station', label: 'вокзал', x: 792, y: 98, w: 66.5, to: '/station' },
    { key: 'garages', label: 'гаражи', x: 933.5, y: 96.5, w: 69.5, to: '/garages' },
    { key: 'suburb', label: 'спальный район', x: 1068.5, y: 95, w: 158.5, to: '/pvp' },
  ],

  /** нижняя полоса — экономика Этапов 2–3 */
  bottomTabs: [
    { key: 'farms', label: 'фермы', x: 382.5, y: 629.5, w: 49, to: '/soon/farms' },
    { key: 'kolhoz', label: 'колхозы', x: 508, y: 630.5, w: 56, to: '/soon/kolhoz' },
    { key: 'resources', label: 'сырьё', x: 670, y: 628.5, w: 42.5, to: '/resources' },
    { key: 'products', label: 'продукты', x: 816.5, y: 630.5, w: 63.5, to: '/soon/products' },
    { key: 'storage', label: 'склад', x: 983, y: 631, w: 39.5, to: '/soon/storage' },
    { key: 'labour', label: 'дешёвая рабочая сила', x: 1118, y: 629.5, w: 153.5, to: '/work' },
  ],
  bottomFontSize: 15.1,
  bottomDy: -1,

  /** центральная область: сюда рендерится содержимое экрана */
  viewport: box(316.5, 122.5, 1000.5, 496),

  /** левая карточка «личное дело» */
  card: {
    paper: box(3.5, 98, 337, 570),
    tabs: [
      { key: 'overview', sprite: 'tab-eye', box: box(54, 73, 48, 25.5), label: 'Обзор' },
      { key: 'gear', sprite: 'tab-wrench', box: box(117.5, 69.5, 47, 30.5), label: 'Снаряжение' },
      { key: 'person', sprite: 'tab-person', box: box(185, 65, 37, 41.5), label: 'Личное дело' },
    ],
    portrait: box(99, 134, 159.5, 219.5),
    energyIcon: box(77, 150.5, 22.5, 30),
    hpIcon: box(252.5, 154.5, 31.5, 22.5),
    energyText: { x: 76.5, y: 189, w: 18.5 },
    hpText: { x: 240.5, y: 189, w: 39.5 },
    nickname: { x: 132.5, y: 377.5, w: 78, size: 22.7 },
    slots: [
      { key: 'weapon', box: box(57, 429, 78, 79), sprite: 'item-ak' },
      { key: 'offhand', box: box(220.5, 442, 77, 63.5), sprite: 'item-bat' },
      { key: 'pet', box: box(150.5, 527, 57.5, 83), sprite: 'item-dog' },
    ],
    /** свободное поле под ником: сюда ложатся вкладки «надето» и «личное дело».
        Рамки слотов напечатаны на подложке, поэтому лист кладём поверх них. */
    body: box(15.5, 406, 313, 252),
    /** подпись выбранной зоны — под слотами, ещё внутри бумаги */
    zoneNote: box(15.5, 618, 313, 26),
    /** полоска над портретом: клик по ней уводит в личное дело */
    topStrip: box(8, 100, 328, 30),
    /** зоны тела — те же пять, что в боевой системе */
    zones: [
      { key: 'HEAD', sprite: 'zone-head', box: box(172, 407, 15, 19), label: 'Голова' },
      { key: 'CHEST', sprite: 'zone-chest', box: box(165, 426.5, 27.5, 39), label: 'Корпус' },
      { key: 'LEFT_ARM', sprite: 'zone-left-arm', box: box(151.5, 432, 13.5, 41.5), label: 'Левая рука' },
      { key: 'RIGHT_ARM', sprite: 'zone-right-arm', box: box(192.5, 432, 14.5, 41.5), label: 'Правая рука' },
      { key: 'LEGS', sprite: 'zone-left-leg', box: box(165, 465, 14, 54.5), label: 'Ноги' },
      { key: 'LEGS_R', sprite: 'zone-right-leg', box: box(180, 465, 13.5, 54.5), label: 'Ноги' },
    ],
  },

  /** чат и онлайн */
  chat: { x: 23, y: 713, w: 969, size: 17.2, lineHeight: 20, rows: 6 },
  chatInput: box(30, 863, 1020, 20),
  onlineTitle: { x: 1263.5, y: 709.5, w: 183, size: 15.1 },
  onlineList: { x: 1207, y: 733.5, w: 134.5, size: 14.8, lineHeight: 17.2 },
} as const

// ── Экран профиля ────────────────────────────────────────────
export const PROFILE = {
  search: box(576.5, 30, 440, 24),
  sign: { x: 1340, y: 14.5, w: 218, size: 48.2, dy: -14 },
  portrait: box(146, 144, 139.5, 192.5),
  energyIcon: box(149, 162, 20, 34.5),
  hpIcon: box(266.5, 166.5, 27.5, 26),
  energyText: { x: 148.5, y: 202, w: 15 },
  hpText: { x: 261, y: 202, w: 32.5 },
  fields: [
    { key: 'name', label: 'Имя', x: 127.5, y: 374.5, w: 114 },
    { key: 'sex', label: 'Кто', x: 127.5, y: 417, w: 113 },
    { key: 'spouse', label: 'Жена', x: 126.5, y: 460, w: 143.5 },
    { key: 'account', label: 'Акаунт', x: 127.5, y: 491, w: 150 },
  ],
  fieldSize: 21.5,
  sheetTitle: { x: 428.5, y: 147.5, w: 217.5, size: 33.7 },
  dossier: { x: 354.5, y: 259, w: 354.5, size: 20.6, lineHeight: 23.7 },
  notepadTitle: { x: 852, y: 489, w: 277.5, size: 39.2 },
  notepad: box(800, 540, 400, 280),
  /** Рамки слотов нарисованы на подложке; здесь — габариты самих предметов,
      иначе спрайт растянется по рамке и вылезет за её края. */
  slots: [
    { key: 'weapon', box: box(106.5, 622.5, 91.5, 94), sprite: 'p-item-ak' },
    { key: 'offhand', box: box(223.5, 622.5, 84, 87.5), sprite: 'p-item-bat' },
    { key: 'pet', box: box(175.5, 757, 61.5, 93), sprite: 'p-item-dog' },
  ],
} as const

/** Пять боевых зон -> слоты брони, которые их прикрывают (зеркало backend zones.ts) */
export const ZONE_ARMOR_SLOTS: Record<string, string[]> = {
  HEAD: ['HEAD'],
  CHEST: ['CHEST', 'BACK', 'BELT'],
  LEGS: ['LEGS', 'FEET'],
  RIGHT_ARM: ['RIGHT_HAND', 'GLOVES', 'HANDS'],
  LEFT_ARM: ['GLOVES', 'HANDS'],
}
