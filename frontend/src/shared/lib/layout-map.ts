// =============================================================
// Координаты элементов из PSD-макета, пересчитанные в систему
// сцены (макет / 2). Единственный источник правды по раскладке:
// если макет поменяется — правим только этот файл.
// =============================================================
import type { StageBox } from './stage'

export const MENU_STAGE = { w: 1754, h: 1240 }
export const PROFILE_STAGE = { w: 1240, h: 1754 }

const box = (x: number, y: number, w: number, h: number): StageBox => ({ x, y, w, h })

// ── Главный экран ────────────────────────────────────────────
export const MENU = {
  /** верхнее меню: плашки идут подряд, подписи внутри них */
  nav: [
    // reconnect — действие, а не раздел: подсветку активности не получает
    { key: 'reconnect', label: 'переподключиться к игре', x: 50, y: 8, w: 284, to: '/', action: true },
    { key: 'news', label: 'новости', x: 410, y: 8, w: 88, to: '/news', action: false },
    { key: 'updates', label: 'обновления', x: 557, y: 7.5, w: 130, to: '/updates', action: false },
    { key: 'forum', label: 'форум', x: 740, y: 5.5, w: 74.5, to: '/forum', action: false },
    { key: 'profile', label: 'профиль', x: 893.5, y: 5.5, w: 97.5, to: '/profile', action: false },
  ],
  navExit: { label: 'выход', x: 1665.5, y: 7.5, w: 68.5 },
  navFontSize: 30.2,
  navDy: -3,

  /** районы города — переключают содержимое центрального вьюпорта */
  districts: [
    { key: 'center', label: 'центр', x: 404, y: 135, w: 64, to: '/' },
    { key: 'market', label: 'рынок', x: 566, y: 133, w: 70, to: '/shop' },
    { key: 'industrial', label: 'промзона', x: 712.5, y: 134.5, w: 108.5, to: '/work' },
    { key: 'station', label: 'вокзал', x: 896.5, y: 135, w: 75.5, to: '/station' },
    { key: 'garages', label: 'гаражи', x: 1057, y: 133, w: 78, to: '/repair' },
    { key: 'suburb', label: 'спальный район', x: 1209.5, y: 131, w: 179.5, to: '/pvp' },
  ],

  /** нижняя полоса — экономика Этапа 2–3 */
  bottomTabs: [
    { key: 'farms', label: 'фермы', x: 404.5, y: 867.5, w: 55.5, stage: 3 },
    { key: 'kolhoz', label: 'колхозы', x: 586.5, y: 869, w: 63.5, stage: 3 },
    { key: 'resources', label: 'сырьё', x: 764, y: 866.5, w: 48.5, stage: 2 },
    { key: 'products', label: 'продукты', x: 924, y: 869, w: 72, stage: 3 },
    { key: 'storage', label: 'склад', x: 1112.5, y: 870, w: 45, stage: 2 },
    { key: 'labour', label: 'дешёвая рабочая сила', x: 1265.5, y: 867.5, w: 174, stage: 2 },
  ],
  bottomFontSize: 20.8,
  bottomDy: -2,

  /** центральная область: сюда рендерится содержимое экрана */
  viewport: box(358.5, 169.5, 1132, 682.5),

  /** левая карточка «личное дело» */
  card: {
    tabs: [
      { key: 'overview', sprite: 'tab-eye', box: box(61.5, 114.5, 53.5, 34.5), label: 'Обзор' },
      { key: 'gear', sprite: 'tab-wrench', box: box(140, 111, 52.5, 41.5), label: 'Снаряжение' },
      { key: 'person', sprite: 'tab-person', box: box(219.5, 103.5, 46.5, 57.5), label: 'Личное дело' },
    ],
    portrait: box(90.5, 193, 206, 279.5),
    energyIcon: box(87.5, 207.5, 25, 41),
    hpIcon: box(286, 213, 35, 30.5),
    energyText: { x: 86.5, y: 255, w: 21 },
    hpText: { x: 272, y: 255, w: 45 },
    nickname: { x: 150, y: 487, w: 88.5, size: 31 },
    slots: [
      { key: 'weapon', box: box(54.5, 548, 109, 110), sprite: 'item-ak' },
      { key: 'offhand', box: box(241, 548, 109, 110), sprite: 'item-bat' },
      { key: 'pet', box: box(148, 681, 109, 110), sprite: 'item-dog' },
    ],
    /** зоны тела — те же пять, что в боевой системе */
    zones: [
      { key: 'HEAD', sprite: 'zone-head', box: box(196, 539.5, 13, 20), label: 'Голова' },
      { key: 'CHEST', sprite: 'zone-chest', box: box(190, 560.5, 24.5, 42), label: 'Корпус' },
      { key: 'LEFT_ARM', sprite: 'zone-left-arm', box: box(177.5, 566.5, 12, 45), label: 'Левая рука' },
      { key: 'RIGHT_ARM', sprite: 'zone-right-arm', box: box(215, 566.5, 12, 45), label: 'Правая рука' },
      { key: 'LEGS', sprite: 'zone-left-leg', box: box(190, 602.5, 11.5, 59.5), label: 'Ноги' },
      { key: 'LEGS_R', sprite: 'zone-right-leg', box: box(203.5, 602.5, 11.5, 59.5), label: 'Ноги' },
    ],
  },

  /** чат и онлайн */
  chat: { x: 26, y: 980, w: 1148, size: 20.8, lineHeight: 24.1, rows: 6 },
  chatInput: box(34, 1189, 1120, 26),
  onlineTitle: { x: 1430, y: 974, w: 207, size: 20.8 },
  onlineList: { x: 1366, y: 1006, w: 152, size: 20.8, lineHeight: 25.4 },
  onlineLevels: [
    { x: 1471.5, y: 1005, tone: 'r' }, { x: 1479, y: 1030, tone: 'r' },
    { x: 1471.5, y: 1055, tone: 'c' }, { x: 1532.5, y: 1080, tone: 'c' },
    { x: 1516, y: 1105, tone: 'o' }, { x: 1516, y: 1131, tone: 'r' },
    { x: 1506.5, y: 1156, tone: 'r' }, { x: 1494.5, y: 1181, tone: 'c' },
  ],
} as const

// ── Экран профиля ────────────────────────────────────────────
export const PROFILE = {
  search: box(96, 52, 500, 34),
  sign: { x: 814, y: 19.5, w: 278.5, size: 49.1, dy: -10 },
  portrait: box(154.5, 364.5, 235, 318.5),
  energyIcon: box(153.5, 383, 26.5, 43.5),
  hpIcon: box(360, 388.5, 37, 32.5),
  energyText: { x: 152.5, y: 428, w: 21 },
  hpText: { x: 351.5, y: 428, w: 45.5 },
  fields: [
    { key: 'name', label: 'Имя', x: 125.5, y: 726, w: 190 },
    { key: 'sex', label: 'Пол', x: 124.5, y: 790, w: 189 },
    { key: 'spouse', label: 'Жена', x: 124, y: 858, w: 239 },
    { key: 'account', label: 'Акаунт', x: 125, y: 919, w: 251 },
  ],
  fieldSize: 31.3,
  sheetTitle: { x: 608.5, y: 358, w: 374, size: 52.1 },
  dossier: { x: 482, y: 498, w: 608.5, size: 31.3, lineHeight: 36 },
  notepadTitle: { x: 704.5, y: 1313, w: 345.5, size: 41.7 },
  notepad: box(700, 1360, 460, 300),
  slots: [
    { key: 'weapon', box: box(81, 1110, 157, 155), sprite: 'p-item-ak' },
    { key: 'offhand', box: box(277.5, 1110, 157, 155), sprite: 'p-item-bat' },
    { key: 'pet', box: box(148.5, 1343, 202, 193), sprite: 'p-item-dog' },
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
