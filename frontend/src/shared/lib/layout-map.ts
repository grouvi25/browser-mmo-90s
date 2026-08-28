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
    // Радио стоит между профилем и выходом. Координаты сняты со слоя
    // «Радио» макета «Фон основного мнею Магазин» (холст 2078,11 · 114×34).
    { key: 'radio', label: 'радио', x: 1039, y: 5.5, w: 57, to: '/radio', action: false },
  ],
  navExit: { label: 'выход', x: 1471.5, y: 5.5, w: 60 },
  navFontSize: 21.9,
  navDy: -2,

  /** районы города — переключают содержимое центрального вьюпорта */
  // Полоса от левого края первой плашки макета (холст 681) до правого края
  // последней (холст 2490): 1809 холста -> 904.5 сцены. Раньше стояло 976.5 —
  // ширина от старого макета, где вьюпорт был на 72 px шире.
  districtStrip: box(340.5, 91.5, 904.5, 27),
  districtGap: 8,
  districts: [
    { key: 'center', label: 'Центр', to: '/' },
    { key: 'market', label: 'Рынок', to: '/market' },
    { key: 'industrial', label: 'Промзона', to: '/industrial' },
    { key: 'agriculture', label: 'Фермы и колхозы', to: '/agriculture' },
    { key: 'station', label: 'Вокзал', to: '/station' },
    { key: 'garages', label: 'Гаражи', to: '/garages' },
    { key: 'suburb', label: 'Спальный район', to: '/pvp' },
  ],

  /** Нижняя полоса показывает комнаты выбранного района, без повторов из самой сцены. */
  // Этой полосы в макете нет: между низом вьюпорта (618.5) и плашкой чата
  // (704.5) там чистое поле. Ряд придуман разработкой, поэтому привязан к
  // вьюпорту — правый край совпадает с его правым краем (1245).
  bottomStrip: box(356, 623, 889, 28),
  bottomGap: 10,
  rooms: {
    center: [
      { key: 'inventory', label: 'Снаряжение', to: '/inventory' },
      { key: 'skills', label: 'Оружейные навыки', to: '/skills' },
      { key: 'stats', label: 'Характеристики', to: '/stats' },
      { key: 'history', label: 'История боёв', to: '/battles/history' },
      { key: 'clan', label: 'Бригада', to: '/clans' },
    ],
    market: [
      { key: 'shop', label: 'Госмагазин', to: '/shop' },
      { key: 'private', label: 'Частные лавки', to: '/shops/private' },
      { key: 'bars', label: 'Бары', to: '/bars' },
    ],
    industrial: [
      { key: 'work', label: 'Работа', to: '/work' },
      { key: 'objects', label: 'Мои объекты', to: '/objects' },
      { key: 'recipes', label: 'Рецепты', to: '/recipes' },
      { key: 'resources', label: 'Запчасти', to: '/resources' },
    ],
    agriculture: [
      { key: 'farms', label: 'Ферма', to: '/farm' },
      { key: 'kolhoz', label: 'Колхозы', to: '/work?from=agriculture' },
      { key: 'plants', label: 'Растения', to: '/plants' },
    ],
    garages: [
      { key: 'repair', label: 'Мастерская', to: '/repair' },
      { key: 'upgrades', label: 'Улучшения', to: '/upgrades' },
    ],
  } as Record<string, readonly { key:string;label:string;to:string }[]>,
  bottomFontSize: 15.1,
  bottomDy: -1,

  /** Центральная область: сюда рендерится содержимое экрана.
      Габариты — слой «Слой 15» макета «Фон основного мнею Магазин»
      (холст 633,245 · 1857×992), то есть ровно родной размер
      viewport-frame.png. Раньше стояло 1000.5: ширина от прежнего
      макета, из-за неё рамка растягивалась на 72 px и всё внутри
      вьюпорта уезжало вправо относительно рисунка. */
  viewport: box(316.5, 122.5, 928.5, 496),

  /** левая карточка «личное дело» */
  card: {
    paper: box(3.5, 98, 337, 570),
    /** Область выреза для мобильной шторки: бумага плюс полка вкладок
        над ней — без вкладок карточку нечем переключать. */
    cutout: box(-2.5, 58, 349, 616),
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
    /** Этап 3: значок градуса — под числом ХП, на свободном поле бумаги.
        Рисуется только когда персонаж пьян или в похмелье, поэтому в
        трезвом состоянии карточка выглядит ровно как раньше. */
    intoxication: box(228, 214, 72, 34),
    nickname: { x: 132.5, y: 377.5, w: 78, size: 22.7 },
    /** frame — рамка слота, вырезанная из подложки отдельным спрайтом:
        на вкладках со списками её нужно убирать, иначе текст ложится на неё.
        box — габариты самого предмета внутри рамки. */
    slots: [
      { key: 'weapon', frame: box(47.5, 424, 97.5, 91), box: box(57, 429, 78, 79), sprite: 'item-ak' },
      { key: 'offhand', frame: box(213, 425.5, 96.5, 89), box: box(220.5, 442, 77, 63.5), sprite: 'item-bat' },
      { key: 'pet', frame: box(130.5, 525, 96.5, 87), box: box(150.5, 527, 57.5, 83), sprite: 'item-dog' },
    ],
    /** свободное поле под ником: сюда ложатся вкладки «надето» и «личное дело».
        Границы взяты по реальному контуру бумаги: край рваный, и в самом
        узком месте она сходится к 33.5…323.5, поэтому поле уже, чем бумага. */
    body: box(36, 406, 282, 236),
    /** подпись выбранной зоны — под слотами, ещё внутри бумаги */
    zoneNote: box(36, 620, 282, 24),
    /** зоны тела — те же пять, что в боевой системе */
    zones: [
      { key: 'HEAD', sprite: 'zone-head', box: box(172, 407, 15, 19), label: 'Голова' },
      { key: 'CHEST', sprite: 'zone-chest', box: box(165, 426.5, 27.5, 39), label: 'Корпус' },
      { key: 'LEFT_ARM', sprite: 'zone-left-arm', box: box(151.5, 432, 13.5, 41.5), label: 'Левая рука' },
      { key: 'RIGHT_ARM', sprite: 'zone-right-arm', box: box(192.5, 432, 14.5, 41.5), label: 'Правая рука' },
      { key: 'LEGS', sprite: 'zone-left-leg', box: box(165, 465, 14, 54.5), label: 'Левая нога' },
      { key: 'LEGS_R', sprite: 'zone-right-leg', box: box(180, 465, 13.5, 54.5), label: 'Правая нога' },
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
