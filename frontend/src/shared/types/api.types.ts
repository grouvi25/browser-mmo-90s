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
  archetype: string
  battleLevel: number
  battleExp: number
  money: number
  hpCurrent: number
  hpMax: number
  status: string
  stats: CharacterStats | null
  createdAt: string
  lastActiveAt: string
}

export interface ItemTemplate {
  id: string
  code: string
  name: string
  type: string
  weaponType: string | null
  armorSlot: string | null
  minDamage: number | null
  maxDamage: number | null
  armor: number | null
  weight: number
  durabilityMax: number
  qualityBase: string
  priceBase: number
  levelReq: number
  sourceType: string
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
  damageDealt: number
  damageReceived: number
}

export interface LiveBattleState {
  battleId: string
  type: string
  roundNumber: number
  status: string
  participants: LiveParticipant[]
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

export type BattleAction = 'attack' | 'block' | 'use_item' | 'change_weapon' | 'surrender'

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
