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
  productionLevel: number
  productionExp: number
  money: number
  hpCurrent: number
  hpMax: number
  status: string
  battlesTotal: number
  battlesWon: number
  location: string | null
  isInvisible: boolean
  isPremium: boolean
  stats: CharacterStats | null
  weaponSkills?: WeaponSkill[]
  economy?: {
    productionLevel: number
    productionExp: number
    professions: Array<{ id:string; professionCode:string; level:number; exp:number; unlockedAt:string; updatedAt:string }>
    economicLevel: number
    economicExp: number
    activeShift: { id: string; status: string; startedAt: string; endsAt: string } | null
  }
  createdAt: string
  lastActiveAt: string
}

export type ItemStatKey = 'DAMAGE' | 'ACCURACY' | 'CRIT' | 'ARMOR' | 'DURABILITY' | 'ANTI_CRIT'

export interface ItemTemplate {
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
  critBonus: number | null
  // Armor stats
  armor: number | null
  dodgeBonus: number | null
  antiCrit: number | null
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
  roundCount: number
  startedAt: string | null
  finishedAt: string | null
  participants: BattleParticipant[]
  turns: BattleTurn[]
}

export interface LiveParticipant {
  participantId: string
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
