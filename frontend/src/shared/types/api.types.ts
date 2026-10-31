// =============================================================
// API types — mirrors backend Prisma/DTO shapes
// =============================================================

export interface User {
  id: string
  login: string
  email: string
}

export interface CharacterStats {
  str: number
  agi: number
  rea: number
  acc: number
  end: number
  luck: number
  agr: number
  auth: number
  pointsAvailable: number
  respecScrolls?: number
}

export interface Character {
  id: string
  userId: string
  nickname: string
  avatar?: string | null
  archetype: string
  battleLevel: number
  battleExp: number
  economicLevel: number
  economicExp: number
  /** Рейтинг (книга заказчика 23.10): статы с весами + надетые вещи. */
  rating?: number
  productionLevel: number
  productionExp: number
  money: number
  /** Игровые доллары — донатная валюта, покупаются у дилера. */
  dollars?: number
  isDealer?: boolean
  /** Модератор игры («Красные»): удаляет реплики в эфире. */
  isModerator?: boolean
  /** Кровавая травма после отбитой осады: до этого времени в бой нельзя. */
  traumaUntil?: string | null
  hpCurrent: number
  hpMax: number
  status: string
  battlesTotal: number
  battlesWon: number
  lastLocation?: string
  jailedUntil?: string | null
  jailReason?: string | null
  location: string | null
  isInvisible: boolean
  isPremium: boolean
  /** Этап 3: приходят в профиле как обычные поля персонажа. */
  clanId?: string | null
  clan?: { id: string; name: string; tag: string } | null
  gender?: 'MALE' | 'FEMALE'
  /** Собака из Зоомагазина: бонус к характеристикам, пока сыта. */
  dog?: { id: string; code: string; name: string; role: string; fedUntil: string | null; fed: boolean; bonus: Record<string, number> } | null
  alcoholLevel?: number
  hangoverUntil?: string | null
  stats: CharacterStats | null
  weaponSkills?: WeaponSkill[]
  /** Прибавки и обереги от надетого — тем же расчётом, что в бою (26.10). */
  gear?: {
    stats: Record<'str' | 'end' | 'luck' | 'agi' | 'acc' | 'agr' | 'rea', number>
    antiDodge: number; antiLuck: number; antiCrit: number; antiCounter: number; hp: number
    /** Мастерства и минус-мастерства, доли (правка 31.10). */
    mastery?: Record<'fist' | 'defense' | 'weapon' | 'accuracy', number>
    minusMastery?: Record<'fist' | 'defense' | 'weapon' | 'accuracy', number>
    /** Минус-обереги: на сколько срезают тот же оберег противника. */
    minus?: { antiDodge: number; antiLuck: number; antiCrit: number; antiCounter: number }
  }
  /** Сколько опыта нужно для следующего боевого уровня; null — последний. */
  nextLevelExp?: number | null
  economy?: {
    productionLevel: number
    productionExp: number
    professions: Array<{ id:string; professionCode:string; name?:string; level:number; exp:number; unlockedAt:string; updatedAt:string }>
    economicLevel: number
    economicExp: number
    activeShift: { id: string; status: string; startedAt: string; endsAt: string } | null
  }
  createdAt: string
  lastActiveAt: string
}

export type ItemStatKey = 'DAMAGE' | 'ACCURACY' | 'CRIT' | 'ARMOR' | 'DURABILITY' | 'ANTI_CRIT'

export interface ItemTemplate {
  battleExpBonus?: number
  id: string
  code: string
  name: string
  description: string | null
  type: string
  weaponType: string | null
  armorSlot: string | null
  // Weapon stats
  minDamage: number | null
  maxDamage: number | null
  weaponAccuracy: number | null
  /** Дальность в клетках поля боя: у ближнего оружия 1. */
  maxRange?: number | null
  critBonus: number | null
  // Armor stats
  armor: number | null
  dodgeBonus: number | null
  antiCrit: number | null
  /** Обереги: срезают у противника уворот, удачу и ответку (могут быть в минус). */
  antiDodge?: number | null
  antiLuck?: number | null
  antiCounter?: number | null
  /** Прибавки к характеристикам персонажа, пока вещь надета. */
  statBonuses?: Partial<Record<'str' | 'end' | 'luck' | 'agi' | 'acc' | 'agr' | 'rea', number>> | null
  /** Минус-обереги и мастерства вещи, проценты (правка 31.10). */
  extraBonuses?: Partial<Pick<ItemBonuses, 'mastery' | 'minusMastery' | 'minusCharms'>> | null
  blockBonus: number | null
  // Consumable
  hpBonus: number | null
  // Physical
  weight: number
  durabilityMax: number
  qualityBase: string
  priceBase: number
  // Requirements
  levelReq: number
  skillReq: number
  strReq: number
  sourceType: string
  isEquippable: boolean
  statBudget: number
  statAllocation: Partial<Record<ItemStatKey, number>> | null
  allocationMode: 'FIXED' | 'MASTER' | 'PLAYER'
}

/** Что записано на вещи сверх базовых полей. Проценты: 5 = 5%. */
export interface ItemBonuses {
  stats: Partial<Record<'str' | 'end' | 'luck' | 'agi' | 'acc' | 'agr' | 'rea', number>>
  mastery: Partial<Record<'fist' | 'defense' | 'weapon' | 'accuracy', number>>
  minusMastery: Partial<Record<'fist' | 'defense' | 'weapon' | 'accuracy', number>>
  charms: Partial<Record<'antiDodge' | 'antiLuck' | 'antiCrit' | 'antiCounter', number>>
  minusCharms: Partial<Record<'antiDodge' | 'antiLuck' | 'antiCrit' | 'antiCounter', number>>
}

export interface ItemInstance {
  id: string
  templateId: string
  ownerId: string
  quality: string
  durabilityCurrent: number
  durabilityMax: number
  upgradeLevel: number
  status: string
  isEquipped: boolean
  armorSlot: string | null
  weight: number
  template: ItemTemplate
  statAllocation: Partial<Record<ItemStatKey, number>> | null
  freePoints: number
  /** Что игрок вписал в именную вещь. */
  bonuses?: Partial<ItemBonuses> | null
  /** Всего очков на вещи: её бюджет плюс очки за уровни. */
  budget?: number
  namedLevel?: number
  iconVersion?: number
  canSetIcon?: boolean
  percentPerPoint?: number
  /** Условия следующего уровня, если вещь его поддерживает. */
  levelUp?: { priceUsd: number; points: number; maxLevel: number } | null
  /** Итог с сервера: база + очки + улучшения + камни (как считает бой). */
  effective?: { minDamage: number; maxDamage: number; weaponAccuracy: number; critBonus: number; armor: number; durabilityMax: number; antiCrit: number }
}

export interface ShopItem {
  id: string
  templateId: string
  isAvailable: boolean
  overridePrice: number | null
  template: ItemTemplate
}

export interface BattleParticipant {
  id: string
  characterId: string | null
  botId: string | null
  side: number
  hpCurrent: number
  hpMax: number
  isAlive: boolean
  isSurrendered: boolean
  damageDealt: number
  damageReceived: number
  expGained?: number
}

export interface BattleTurn {
  id: string
  roundNumber: number
  actorCharId: string | null
  actorBotId: string | null
  action: string
  sourceHand: string | null
  fromX: number | null
  fromY: number | null
  toX: number | null
  toY: number | null
  hit: boolean
  dodge: boolean
  block: boolean
  crit: boolean
  rawDamage: number
  finalDamage: number
  targetHpBefore: number
  targetHpAfter: number
  weaponDurLoss: number
  logLine: string | null
}

export interface Battle {
  id: string
  type: string
  status: string
  winnerId: string | null
  winnerParticipantId?: string | null
  roundCount: number
  startedAt: string | null
  finishedAt: string | null
  participants: BattleParticipant[]
  turns: BattleTurn[]
}

export type HelperTactic = 'ATTACK' | 'STANDARD' | 'DEFENSIVE'
/** Боевой помощник в бою (как бойцовый питомец «Апехи»). */
export interface LiveHelper {
  id: string; name: string; level: number; tactic: HelperTactic
  hp: number; hpMax: number; alive: boolean
  damageDealt?: number
  /** Вызван на поле (правка 28.10): стоит на клетке, ходит и бьёт сам. */
  summoned?: boolean
  position?: { x: number; y: number }
}

/** Собака хозяина в бою: после вызова — фигура на поле со своим здоровьем. */
export interface LiveDog {
  id: string; name: string; level: number; damageDealt: number
  hp: number; hpMax: number; alive: boolean
  summoned?: boolean
  position?: { x: number; y: number }
}

export interface LiveParticipant {
  participantId: string
  /** Фигура на поле: помощник или собака хозяина (адрес «helper:…» / «dog:…»). */
  companion?: 'helper' | 'dog'
  helper?: LiveHelper | null
  dog?: LiveDog | null
  /** Попадания по зонам: 1 — жёлтая, 2 — оранжевая, 3 — красная, вещь снята. */
  wounds?: Partial<Record<string, number>>
  characterId?: string
  botId?: string
  hpCurrent: number
  hpMax: number
  side: number
  isAlive: boolean
  isSurrendered: boolean
  hasActedThisRound: boolean
  weaponInstanceId?: string
  leftWeaponInstanceId?: string
  rightWeaponInstanceId?: string
  /** Карман, зафиксированный сервером на старте боя. */
  pocketItemIds?: string[]
  damageDealt: number
  damageReceived: number
  position: { x: number; y: number }
}

export interface LiveBattleState {
  battleId: string
  type: string
  roundNumber: number
  status: string
  participants: LiveParticipant[]
  roundDeadline?: number
  distance?: number
  /** Полоса дуэли (бой один на один); null — всё поле. */
  arena?: { x0: number; x1: number; y0: number; y1: number } | null
  /** Бочки: не пройти и не прострелить. */
  obstacles?: { x: number; y: number }[]
}

export interface RepairItem extends ItemInstance {
  repairCost: number
}

export interface WeaponSkill {
  id: string
  weaponType: string
  skillLevel: number
  skillExp: number
  antiSkillLevel: number
  antiSkillExp: number
}

export type BattleAction = 'attack' | 'block' | 'move' | 'use_item' | 'change_weapon' | 'surrender'

export const ARCHETYPE_LABELS: Record<string, string> = {
  ATHLETE:  'Спортсмен',
  WORKER:   'Работяга',
  SHUTTLE:  'Челнок',
  VETERAN:  'Бывший срочник',
  STREET:   'Уличный',
  MERCHANT: 'Коммерсант',
  STUDENT:  'Студент',
  RESOLVER: 'Решала',
}

export const ARCHETYPE_BONUS: Record<string, string> = {
  ATHLETE:  '+СИЛ +ВЫН',
  WORKER:   '+СИЛ +ВЫН',
  SHUTTLE:  '+МТК +ФРТ',
  VETERAN:  '+РЕА +МТК',
  STREET:   '+ЛВК +АГР',
  MERCHANT: '+ФРТ +АВТ',
  STUDENT:  '+2 очка характеристик',
  RESOLVER: '+АВТ +АВТ',
}

export const STAT_LABELS: Record<string, string> = {
  str:  'СИЛ', agi: 'ЛВК', rea: 'РЕА', acc: 'МТК',
  end:  'ВЫН', luck: 'ФРТ', agr: 'АГР', auth: 'АВТ',
}

export const STAT_DESCRIPTIONS: Record<string, string> = {
  str:  'Сила: урон в ближнем бою, перенос веса снаряжения',
  agi:  'Ловкость: шанс уворота от ударов, скорость',
  rea:  'Реакция: шанс блока, ответный удар, инициатива',
  acc:  'Меткость: шанс попадания, точность стрельбы',
  end:  'Выносливость: максимальный HP (+6 HP за 1 ВЫН), снижение урона',
  luck: 'Фарт: пробитие блока противника, редкие события',
  agr:  'Агрессия: шанс критического удара',
  auth: 'Авторитет: клановые бонусы, влияние, дипломатия',
}

export const STAT_FULL: Record<string, string> = {
  str: 'Сила', agi: 'Ловкость', rea: 'Реакция', acc: 'Меткость',
  end: 'Выносливость', luck: 'Фарт', agr: 'Агрессия', auth: 'Авторитет',
}

export const WEAPON_TYPE_LABELS: Record<string, string> = {
  MELEE:   'Рукопашка', KNIFE:  'Нож',
  CLUB:    'Дубинка',   PISTOL: 'Пистолет',
  SHOTGUN: 'Дробовик',  SMG:    'ПП',
  RIFLE:   'Автомат',   SNIPER: 'Винтовка',
  HEAVY:   'Тяжёлое',   THROWN: 'Метательное',
}

export const ARMOR_SLOT_LABELS: Record<string, string> = {
  HEAD: 'Голова', CHEST: 'Тело', LEGS: 'Ноги',
  FEET: 'Обувь',  HANDS: 'Руки', BELT: 'Пояс',
  BACK: 'Спина',  POCKET: 'Карманы', ACCESSORY: 'Акс.',
  // слоты рук: в базе они есть, а подписей не было — в списке
  // снаряжения светились сырые LEFT_HAND / RIGHT_HAND / GLOVES
  LEFT_HAND: 'Левая рука', RIGHT_HAND: 'Правая рука', GLOVES: 'Перчатки',
  RING: 'Кольцо', RING_2: 'Второе кольцо',
}

/** Тип предмета: показывается, когда у вещи нет ни типа оружия, ни слота брони. */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  WEAPON: 'Оружие',   ARMOR: 'Броня',
  SHIELD: 'Щит',      ACCESSORY: 'Аксессуар',
  CONSUMABLE: 'Расходник', RESOURCE: 'Сырьё',
  COMPONENT: 'Деталь', UPGRADE_MODULE: 'Модуль улучшения',
}

export const QUALITY_LABELS: Record<string, string> = {
  JUNK:   'Хлам',    COMMON: 'Обычный',
  GOOD:   'Хороший', RARE:   'Редкий',
  NAMED:  'Именной', UNIQUE: 'Уникальный',
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE:     'Активен',  IN_BATTLE:  'В бою',
  WORKING:    'Работает', RECOVERING: 'Отдых',
  TRAVELLING: 'В пути',   OFFLINE:    'Офлайн',
  BANNED:     'БАН',
}
