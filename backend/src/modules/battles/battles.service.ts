import type { BattleAction, WeaponType as PrismaWeaponType } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { BattleRedis, AntiFarmRedis } from '../../shared/db/redis'
import { CharactersRepository } from '../characters/characters.repository'
import { ItemsRepository } from '../items/item-instance.repository'
import { WeaponSkillsRepository, saveWeaponSkillExp } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { TerritoriesService } from '../territories/territories.service'
import { PremiumService } from '../premium/premium.service'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import {
  resolveZonalAttack,
  calcInitiative,
  weaponExpByType as weaponExpByTypeShared,
  type AttackerSnapshot,
  type DefenderSnapshot,
  type ZonalAttackResult,
} from './battle.formulas'
import { decayedAlcohol, intoxicationModifiers } from '../bars/bars.formulas'
import {
  armorOfZone,
  botArmorOfZone,
  legacyActionToTurn,
  normalizeTurn,
  botChooseTurn,
  type ZonalTurnInput,
  type AttackHand,
  type EquipArmorLike,
} from './zones'
import type { BodyZone } from '@prisma/client'
import {
  BATTLE_GRID,
  canAttackTarget,
  canMoveTo,
  gridDistance,
  resolveSimultaneousMoves,
  selectEnemyTarget,
  stepAway,
  stepToward,
  teamSpawnPositions,
  type GridPosition,
  type PositionedParticipant,
} from './grid'
import {
  calcBattleExp,
} from '../stats/stats.formulas'
import type { CharacterWithStats } from '../characters/characters.repository'
import type { ItemWithTemplate } from '../items/item-instance.repository'
import { applyBattleProgression } from '../experience/progression'
import { EconomyService } from '../economy/economy.service'
import { applyUpgradeModifiers, type UpgradeKind } from '../upgrades/upgrades.formulas'
import {
  applyTeamMoves,
  finishTeamBattle,
  initiativeOf,
  orderByInitiative,
  pickTeamTarget,
  teamMoveRecords,
  teamOutcome,
  teamPositioned,
  turnOfParticipant,
  TEAM_MAX_PER_SIDE,
  type LiveTeamState,
  type TeamFighterContext,
} from './team-battle'


// ── Таймер хода: 7 секунд, потом авто-блок ─────────────────────
const TURN_TIMEOUT_MS = 60_000
export const BATTLE_LOCK_TTL_MS = 15_000

// ── Поле боя (движение/дистанция) ──────────────────────────────
// Радиус оружия: у ближнего = 1, у дальнего — из шаблона (maxRange)
function weaponRangeOf(weapon: ItemWithTemplate | null | undefined): number {
  return Math.max(1, weapon?.template.maxRange ?? 1)
}

function recordWeaponDamage(part: LiveParticipant, weapon: ItemWithTemplate | null | undefined, damage: number): void {
  if (damage <= 0) return
  const weaponType = (weapon?.template.weaponType ?? 'MELEE') as PrismaWeaponType
  part.weaponDamage ??= {}
  part.weaponDamage[weaponType] = (part.weaponDamage[weaponType] ?? 0) + damage
}

/** Обёртка над общей формулой: сервис держит предмет, а не тип оружия. */
function weaponExpByType(part: LiveParticipant, fallbackWeapon: ItemWithTemplate | null, targetHpMax: number, won: boolean, levelDiff: number, premiumMultiplier = 1): Array<{ weaponType: PrismaWeaponType; exp: number }> {
  return weaponExpByTypeShared(
    part,
    (fallbackWeapon?.template.weaponType ?? 'MELEE') as PrismaWeaponType,
    targetHpMax, won, levelDiff, premiumMultiplier,
  )
}

// ---------------------------------------------------------------
// Live battle state stored in Redis
// ---------------------------------------------------------------
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
  pendingAction?: string   // 'attack' | 'block' | 'surrender' | 'change_weapon:{hand}:{id}' | 'use_item:{id}'
  pendingTurn?: ZonalTurnInput   // зональный ход (стойка + зоны атаки/блока)
  weaponInstanceId?: string // legacy fallback
  leftWeaponInstanceId?: string
  rightWeaponInstanceId?: string
  pocketItemIds?: string[]
  damageDealt: number
  damageReceived: number
  hitsTaken: number
  hitsLanded: number
  weaponDamage?: Partial<Record<PrismaWeaponType, number>>
  skippedTurns: number   // tracks AFK/passive turns for anti-abuse
  position: GridPosition
}

export interface LiveBattleState {
  battleId: string
  type: string
  roundNumber: number
  status: 'active' | 'finishing'
  participants: LiveParticipant[]
  roundDeadline?: number    // unix ms for auto-resolve
  distance?: number         // compatibility projection of grid distance
  grid?: typeof BATTLE_GRID
}

function ensureGridState(state: LiveBattleState): void {
  state.grid ??= BATTLE_GRID
  const sideOffsets = new Map<number, number>()
  for (const part of state.participants) {
    if (part.position) continue
    const offset = sideOffsets.get(part.side) ?? 0
    sideOffsets.set(part.side, offset + 1)
    part.position = {
      x: part.side === 1 ? 1 : BATTLE_GRID.width - 2,
      y: Math.min(BATTLE_GRID.height - 1, Math.floor(BATTLE_GRID.height / 2) + Math.ceil(offset / 2) * (offset % 2 === 0 ? 1 : -1)),
    }
  }
}

function positionedParticipants(state: LiveBattleState): PositionedParticipant[] {
  ensureGridState(state)
  return state.participants.map(p => ({
    participantId: p.participantId,
    side: p.side,
    isAlive: p.isAlive,
    position: p.position,
  }))
}

function applyRequestedMove(state: LiveBattleState, part: LiveParticipant, moveTo?: GridPosition): boolean {
  if (!moveTo) return false
  const projected = positionedParticipants(state)
  const actor = projected.find(p => p.participantId === part.participantId)!
  if (!canMoveTo(actor, moveTo, projected)) {
    throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Invalid or occupied destination cell', 400)
  }
  part.position = { ...moveTo }
  return true
}

function applySimultaneousDuelMoves(
  state: LiveBattleState,
  first: LiveParticipant,
  firstTarget?: GridPosition,
  second?: LiveParticipant,
  secondTarget?: GridPosition,
): [boolean, boolean] {
  ensureGridState(state)
  const requests = [
    ...(firstTarget ? [{ participantId: first.participantId, destination: firstTarget }] : []),
    ...(second && secondTarget ? [{ participantId: second.participantId, destination: secondTarget }] : []),
  ]
  try {
    const resolved = resolveSimultaneousMoves(positionedParticipants(state), requests)
    for (const participant of state.participants) {
      const next = resolved.find(candidate => candidate.participantId === participant.participantId)
      if (next) participant.position = next.position
    }
  } catch (error) {
    throw new AppError(
      ErrorCode.BATTLE_INVALID_ACTION,
      error instanceof Error ? error.message : 'Invalid movement request',
      400,
    )
  }
  return [Boolean(firstTarget), Boolean(secondTarget)]
}

/** Служебное действие раунда: смена оружия или расходник.
 *  Общее для дуэли и командного боя. */
async function applyPendingUtility(part: LiveParticipant, char: CharacterWithStats): Promise<boolean> {
    const pending = part.pendingAction ?? ''
    if (pending.startsWith('change_weapon:')) {
      const changeParts = pending.split(':')
      const hand: AttackHand = changeParts.length >= 3 && (changeParts[1] === 'LEFT_HAND' || changeParts[1] === 'RIGHT_HAND')
        ? changeParts[1]
        : 'LEFT_HAND'
      const itemId = changeParts.length >= 3 ? changeParts.slice(2).join(':') : changeParts[1]
      const item = await ItemsRepository.findInstanceById(itemId)
      if (item && item.ownerId === char.id && item.template.type === 'WEAPON' && item.status !== 'BROKEN') {
        const occupied = await ItemsRepository.findEquippedBySlot(char.id, hand)
        if (occupied && occupied.id !== itemId) await ItemsRepository.unequip(occupied.id)
        await ItemsRepository.equip(itemId, hand)
        if (hand === 'LEFT_HAND') {
          if (part.rightWeaponInstanceId === itemId) part.rightWeaponInstanceId = undefined
          part.leftWeaponInstanceId = itemId
          part.weaponInstanceId = itemId
        } else {
          if (part.leftWeaponInstanceId === itemId || part.weaponInstanceId === itemId) {
            part.leftWeaponInstanceId = undefined
            part.weaponInstanceId = undefined
          }
          part.rightWeaponInstanceId = itemId
        }
      }
      return true
    }
    if (pending.startsWith('use_item:')) {
      const itemId = pending.slice('use_item:'.length)
      if (!part.pocketItemIds?.includes(itemId)) return true
      const item = await ItemsRepository.findInstanceById(itemId)
      if (item && item.ownerId === char.id && item.template.type === 'CONSUMABLE' && !['CONSUMED', 'DELETED'].includes(item.status)) {
        part.hpCurrent = Math.min(part.hpMax, part.hpCurrent + (item.template.hpBonus ?? 0))
        part.pocketItemIds = part.pocketItemIds.filter(id => id !== itemId)
        await ItemsRepository.delete(itemId)
      }
      return true
    }
    return false
    }

function syncGridDistance(state: LiveBattleState): number {
  ensureGridState(state)
  const alive = state.participants.filter(p => p.isAlive)
  const distance = alive.length >= 2 ? gridDistance(alive[0].position, alive[1].position) : 0
  state.distance = distance
  return distance
}

async function loadBattlePocket(char: CharacterWithStats): Promise<string[]> {
  const ids = ((char.battleLoadoutJson as string[] | null) ?? []).slice(0, 4)
  if (ids.length === 0) return []
  const items = await prisma.itemInstance.findMany({
    where: { id: { in: ids }, ownerId: char.id },
    include: { template: true },
  })
  const valid = new Set(items
    .filter(item => item.template.type === 'CONSUMABLE' && !['CONSUMED', 'DELETED'].includes(item.status))
    .map(item => item.id))
  return ids.filter(id => valid.has(id))
}

// ---------------------------------------------------------------
// Bot data loader
// ---------------------------------------------------------------
async function loadBotData(botId: string) {
  const bot = await prisma.bot.findUnique({ where: { id: botId } })
  if (!bot) throw AppError.notFound('Bot', botId)
  return bot
}

// ---------------------------------------------------------------
// Build attacker snapshot from character + equipped armor weight
// ---------------------------------------------------------------
async function buildAttackerSnapshotAsync(
  char: CharacterWithStats,
  weapon: ItemWithTemplate | null,
  weaponSkillLevel: number,
  equippedArmor: ItemWithTemplate[]
): Promise<AttackerSnapshot> {
  const s = char.stats!
  const t = weapon?.template
  const effectiveWeapon = t
    ? applyUpgradeModifiers(t, ((weapon?.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}), weapon?.statAllocation, weapon?.socketsJson)
    : null
  // Sum weight of all equipped items (weapon + armor)
  const equipmentWeight =
    (weapon?.weight ?? 0) +
    equippedArmor.reduce((sum, a) => sum + a.weight, 0)

  const now = new Date()
  const intox = intoxicationModifiers(decayedAlcohol(char.alcoholLevel, char.alcoholUpdatedAt, now))
  const buffActive = !!char.barBuffExpiresAt && char.barBuffExpiresAt > now
  return {
    str: s.str, acc: s.acc, agi: s.agi, rea: s.rea, luck: s.luck, agr: s.agr, end: s.end,
    weaponSkillLevel,
    minDamage: effectiveWeapon?.minDamage ?? 2,
    maxDamage: effectiveWeapon?.maxDamage ?? 6,
    weaponAccuracy: (effectiveWeapon?.weaponAccuracy ?? 0.7) + intox.accuracy + (buffActive ? char.barBuffAccuracy : 0),
    critBonus: effectiveWeapon?.critBonus ?? 0,
    critDamageBonus: t?.critDamageBonus ?? 0,
    blockPierce: t?.blockPierce ?? 0,
    flatDamageBonus: 0,
    equipmentWeight,   // Real equipment weight for initiative calc
    antiDodgeBonus: t?.antiDodge ?? 0,
    antiCounterBonus: t?.antiCounter ?? 0,
    outgoingDamageMultiplier: 1 + intox.outgoingDamage + (buffActive ? char.barBuffDamage : 0),
  }
}

function buildDefenderSnapshot(
  char: CharacterWithStats,
  equippedArmor: ItemWithTemplate[],
  antiSkillLevel = 0,
  equippedWeapon?: ItemWithTemplate | null  // нужен для ответки
): DefenderSnapshot {
  const s = char.stats!
  const effectiveArmor = equippedArmor.map(a => applyUpgradeModifiers(a.template, ((a.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}), a.statAllocation, a.socketsJson))
  const totalArmor   = effectiveArmor.reduce((sum, a) => sum + a.armor, 0)
  const antiCrit     = effectiveArmor.reduce((sum, a) => sum + a.antiCrit, 0)
  const blockBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.blockBonus ?? 0), 0)
  const dodgeBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.dodgeBonus ?? 0), 0)
  const armorWeight  = equippedArmor.reduce((sum, a) => sum + a.weight, 0)
  const antiLuck     = equippedArmor.reduce((sum, a) => sum + (a.template.antiLuck ?? 0), 0)
  // Базовый урон для ответки (оружие защитника или кулаки)
  const wMin = equippedWeapon?.template.minDamage ?? 2
  const wMax = equippedWeapon?.template.maxDamage ?? 5
  return {
    agi: s.agi, rea: s.rea, end: s.end, luck: s.luck,
    armor: totalArmor, dodgeBonus, antiCrit, blockBonus, armorWeight,
    antiSkillLevel,
    antiCounterDefense: 0, antiLuck,
    minDamage: wMin, maxDamage: wMax,
  }
}

// ---------------------------------------------------------------
// Zonal helpers
// ---------------------------------------------------------------
// Преобразуем экипированную броню в форму для расчёта брони по зоне.
function armorListFromEquipped(equippedArmor: ItemWithTemplate[]): EquipArmorLike[] {
  return equippedArmor.map(it => ({
    armor: applyUpgradeModifiers(it.template, ((it.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {}), it.statAllocation, it.socketsJson).armor,
    slot: it.armorSlot ?? it.template.armorSlot ?? null,
  }))
}

// Обмен ударами: attacker бьёт по своим зонам, defender блокирует свои зоны.
// Возвращает результаты ударов, суммарный урон защитнику и суммарную ответку атакующему.
export type HandStrikeResult = ZonalAttackResult & { sourceHand: AttackHand; weaponId: string | null }

export function executeStrikes(params: {
  attackerSnap: AttackerSnapshot
  attackerSnaps?: Partial<Record<AttackHand, AttackerSnapshot>>
  weaponIds?: Partial<Record<AttackHand, string | null>>
  defenderSnap: DefenderSnapshot
  defenderSnaps?: Partial<Record<AttackHand, DefenderSnapshot>>
  zoneArmorFor: (zone: BodyZone) => number
  attackZones: BodyZone[]
  attackHands?: AttackHand[]
  blockedZones: BodyZone[]
  defenderHp: number
}): { results: HandStrikeResult[]; damageToDefender: number; counterToAttacker: number } {
  const results: HandStrikeResult[] = []
  let damageToDefender = 0
  let counterToAttacker = 0
  let hpLeft = params.defenderHp
  for (let index = 0; index < params.attackZones.length; index++) {
    if (hpLeft <= 0) break
    const zone = params.attackZones[index]
    const sourceHand = params.attackHands?.[index] ?? (index === 1 ? 'RIGHT_HAND' : 'LEFT_HAND')
    const attackerSnap = params.attackerSnaps?.[sourceHand] ?? params.attackerSnap
    const defenderSnap = params.defenderSnaps?.[sourceHand] ?? params.defenderSnap
    const r = resolveZonalAttack(attackerSnap, defenderSnap, {
      zone, blockedZones: params.blockedZones, zoneArmor: params.zoneArmorFor(zone),
    })
    if (r.hit && !r.dodge && !r.block) {
      damageToDefender += r.finalDamage
      hpLeft = Math.max(0, hpLeft - r.finalDamage)
    }
    if (r.counterDamage > 0) counterToAttacker += r.counterDamage
    results.push({ ...r, sourceHand, weaponId: params.weaponIds?.[sourceHand] ?? null })
  }
  return { results, damageToDefender, counterToAttacker }
}

// Зональный износ: списываем прочность у брони в зонах, куда попали.
async function applyZonalArmorWear(
  equippedArmor: ItemWithTemplate[],
  hitZones: BodyZone[]
): Promise<void> {
  if (hitZones.length === 0 || equippedArmor.length === 0) return
  // Считаем число попаданий по каждой зоне
  const counts = new Map<BodyZone, number>()
  for (const z of hitZones) counts.set(z, (counts.get(z) ?? 0) + 1)

  for (const [zone, n] of counts) {
    const armorList = armorListFromEquipped(equippedArmor)
    // находим первый предмет, прикрывающий зону
    const idx = equippedArmor.findIndex((_, i) => {
      const el = armorList[i]
      return el.slot != null && armorOfZone([el], zone) > 0
    })
    if (idx === -1) continue
    const item = equippedArmor[idx]
    const newDur = Math.max(0, item.durabilityCurrent - n)
    await ItemsRepository.updateDurability(item.id, newDur)
    if (newDur <= 0) await ItemsRepository.updateStatus(item.id, 'BROKEN')
  }
}

// ---------------------------------------------------------------
// Bot snapshot builders (simplified)
// ---------------------------------------------------------------
function buildBotAttackerSnapshot(botStats: Record<string, number>, botEquip: Record<string, unknown>): AttackerSnapshot {
  const w = botEquip.weapon as Record<string, number> | undefined
  return {
    str: botStats.str ?? 3, acc: botStats.acc ?? 3, agi: botStats.agi ?? 3,
    rea: botStats.rea ?? 2, luck: botStats.luck ?? 1, agr: botStats.agr ?? 1, end: botStats.end ?? 3,
    weaponSkillLevel: 1,
    minDamage: w?.minDamage ?? 3,
    maxDamage: w?.maxDamage ?? 8,
    weaponAccuracy: w?.accuracy ?? 0.65,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0, flatDamageBonus: 0,
    equipmentWeight: 0,
    antiDodgeBonus: 0,
    antiCounterBonus: 0,
  }
}

function buildBotDefenderSnapshot(botStats: Record<string, number>): DefenderSnapshot {
  return {
    agi: botStats.agi ?? 2, rea: botStats.rea ?? 2, end: botStats.end ?? 2,
    luck: botStats.luck ?? 1,
    armor: botStats.armor ?? 2,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
    antiSkillLevel: 0,
    antiCounterDefense: 0, antiLuck: botStats.antiLuck ?? 0,
    minDamage: botStats.minDamage ?? 3, maxDamage: botStats.maxDamage ?? 8,
  }
}

// ---------------------------------------------------------------
// Save weapon skill exp to DB (shared helper)
// After WSK=20, overflow exp builds antiSkillLevel (WRES)
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// BattleService
// ---------------------------------------------------------------
function assertIntoxicationAllowsBattle(character: Pick<CharacterWithStats, 'alcoholLevel' | 'alcoholUpdatedAt'>): void {
  const state = intoxicationModifiers(decayedAlcohol(character.alcoholLevel, character.alcoholUpdatedAt))
  if (!state.canBattle) throw new AppError(ErrorCode.BAR_TOO_DRUNK, 'Character is too drunk to fight', 409)
}

/**
 * Переодевание в бою — шаг F7 Этапа 4.
 *
 * Применяется ДО загрузки оружия и брони раунда: снаряжение меняют, чтобы
 * оно подействовало в этом же ходу, иначе смена оружия стоила бы очко и не
 * давала ничего до следующего раунда.
 *
 * Цена уже снята бюджетом в normalizeTurn: здесь только сама подмена.
 */
async function applyTurnSwaps(
  characterId: string,
  part: LiveParticipant,
  turn: ZonalTurnInput,
): Promise<string[]> {
  const notes: string[] = []

  if (turn.swapWeapon) {
    const item = await ItemsRepository.findInstanceById(turn.swapWeapon.itemInstanceId)
    if (!item || item.ownerId !== characterId || item.template.type !== 'WEAPON') {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Оружие недоступно', 400)
    }
    await ItemsRepository.equip(item.id, turn.swapWeapon.hand)
    if (turn.swapWeapon.hand === 'LEFT_HAND') {
      if (part.rightWeaponInstanceId === item.id) part.rightWeaponInstanceId = undefined
      part.leftWeaponInstanceId = item.id
      part.weaponInstanceId = item.id
    } else {
      if (part.leftWeaponInstanceId === item.id || part.weaponInstanceId === item.id) {
        part.leftWeaponInstanceId = undefined
        part.weaponInstanceId = undefined
      }
      part.rightWeaponInstanceId = item.id
    }
    notes.push(`Сменил оружие: ${item.template.name}`)
  }

  if (turn.swapArmor) {
    const item = await ItemsRepository.findInstanceById(turn.swapArmor.itemInstanceId)
    if (!item || item.ownerId !== characterId || item.template.type !== 'ARMOR' || !item.template.armorSlot) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Броня недоступна', 400)
    }
    await ItemsRepository.equip(item.id, item.template.armorSlot)
    notes.push(`Сменил броню: ${item.template.name}`)
  }

  return notes
}

export const BattleService = {
  // -------------------------------------------------------
  // Start PvE
  // -------------------------------------------------------
  async startPve(userId: string, botCode: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    assertIntoxicationAllowsBattle(char)
    if (!char.stats) throw AppError.internal('Character stats missing')
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)

    const bot = await prisma.bot.findUnique({ where: { code: botCode, isActive: true } })
    if (!bot) throw AppError.notFound('Bot', botCode)

    const weapons = await ItemsRepository.findEquippedWeapons(char.id)
    const weapon = weapons.LEFT_HAND

    return withTransaction(async (tx) => {
      const claimed = await tx.character.updateMany({
        where: { id: char.id, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Character is not available for battle', 409)
      }

      // Create battle record
      const battle = await tx.battle.create({
        data: { type: 'PVE_BOT', status: 'ACTIVE', startedAt: new Date() },
      })

      // Create participant — player
      const playerPart = await tx.battleParticipant.create({
        data: {
          battleId: battle.id,
          characterId: char.id,
          side: 1,
          hpMax: char.hpMax,
          hpCurrent: char.hpCurrent,
        },
      })

      // Create participant — bot
      const botPart = await tx.battleParticipant.create({
        data: {
          battleId: battle.id,
          botId: bot.id,
          side: 2,
          hpMax: bot.hpMax,
          hpCurrent: bot.hpMax,
        },
      })

      // Character was claimed atomically before battle creation.

      // Snapshot the server-authoritative pocket at battle start.
      const pocketItemIds = await loadBattlePocket(char)
      const liveState: LiveBattleState = {
        battleId: battle.id,
        type: 'PVE_BOT',
        roundNumber: 1,
        status: 'active',
        roundDeadline: Date.now() + TURN_TIMEOUT_MS,
        distance: 6,
        grid: BATTLE_GRID,
        participants: [
          {
            participantId: playerPart.id,
            characterId: char.id,
            hpCurrent: char.hpCurrent,
            hpMax: char.hpMax,
            side: 1,
            isAlive: true,
            isSurrendered: false,
            hasActedThisRound: false,
            weaponInstanceId: weapon?.id,
            leftWeaponInstanceId: weapons.LEFT_HAND?.id,
            rightWeaponInstanceId: weapons.RIGHT_HAND?.id,
            pocketItemIds,
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: teamSpawnPositions(1, 1)[0],
          },
          {
            participantId: botPart.id,
            botId: bot.id,
            hpCurrent: bot.hpMax,
            hpMax: bot.hpMax,
            side: 2,
            isAlive: true,
            isSurrendered: false,
            hasActedThisRound: false,
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: teamSpawnPositions(2, 1)[0],
          },
        ],
      }
      await BattleRedis.setState(battle.id, liveState)

      audit('battle.started', { battleId: battle.id, type: 'PVE_BOT', characterId: char.id, botCode })
      return { battleId: battle.id, state: liveState }
    })
  },

  // -------------------------------------------------------
  // Create PvP Duel
  // -------------------------------------------------------
  async createPvpDuel(userId: string, levelMin?: number, levelMax?: number) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    assertIntoxicationAllowsBattle(char)
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)

    const lMin = levelMin ?? Math.max(1, char.battleLevel - 2)
    const lMax = levelMax ?? Math.min(99, char.battleLevel + 2)

    return withTransaction(async tx => {
      const claimed = await tx.character.updateMany({
        where: { id: char.id, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Character is not available for battle', 409)
      }

      const battle = await tx.battle.create({
        data: {
          type: 'PVP_DUEL',
          status: 'WAITING_PLAYERS',
          levelMin: lMin,
          levelMax: lMax,
        },
      })

      await tx.battleParticipant.create({
        data: {
          battleId: battle.id,
          characterId: char.id,
          side: 1,
          hpMax: char.hpMax,
          hpCurrent: char.hpCurrent,
        },
      })

      return { battleId: battle.id, status: 'WAITING_PLAYERS', levelMin: lMin, levelMax: lMax }
    })
  },

  // -------------------------------------------------------
  // Командный бой: сбор состава и старт
  // -------------------------------------------------------

  /** Открыть командный бой. Создатель встаёт в первую сторону. */
  async createTeamBattle(userId: string, perSide: number) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    assertIntoxicationAllowsBattle(char)
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)
    if (!Number.isInteger(perSide) || perSide < 1 || perSide > TEAM_MAX_PER_SIDE) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, `Team size must be 1..${TEAM_MAX_PER_SIDE}`, 422)
    }

    return withTransaction(async tx => {
      const claimed = await tx.character.updateMany({
        where: { id: char.id, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Character is not available for battle', 409)
      }
      const battle = await tx.battle.create({
        data: {
          type: 'CLAN',
          status: 'WAITING_PLAYERS',
          levelMin: Math.max(1, char.battleLevel - 5),
          levelMax: Math.min(99, char.battleLevel + 5),
          // Размер стороны держим в поле раундов до старта: отдельной
          // колонки под состав в схеме нет, а плодить миграцию ради
          // одного числа дороже, чем переиспользовать существующее.
          roundCount: perSide,
        },
      })
      await tx.battleParticipant.create({
        data: { battleId: battle.id, characterId: char.id, side: 1, hpMax: char.hpMax, hpCurrent: char.hpCurrent },
      })
      return { battleId: battle.id, status: 'WAITING_PLAYERS', perSide, side: 1 }
    })
  },

  /** Встать в одну из сторон открытого боя. */
  async joinTeamBattle(userId: string, battleId: string, side: number) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    assertIntoxicationAllowsBattle(char)
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)
    if (side !== 1 && side !== 2) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Side must be 1 or 2', 422)

    const battle = await prisma.battle.findUnique({ where: { id: battleId }, include: { participants: true } })
    if (!battle) throw AppError.notFound('Battle', battleId)
    if (battle.type !== 'CLAN') throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Not a team battle', 400)
    if (battle.status !== 'WAITING_PLAYERS') throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Battle already started', 400)
    if (battle.participants.some(p => p.characterId === char.id)) {
      throw new AppError(ErrorCode.CONFLICT, 'You are already in this battle', 400)
    }
    if (char.battleLevel < battle.levelMin || char.battleLevel > battle.levelMax) {
      throw new AppError(ErrorCode.CONFLICT, `Требуется уровень ${battle.levelMin}–${battle.levelMax}`, 400)
    }
    const perSide = battle.roundCount || 1
    if (battle.participants.filter(p => p.side === side).length >= perSide) {
      throw new AppError(ErrorCode.CONFLICT, 'Эта сторона уже набрана', 409)
    }

    return withTransaction(async tx => {
      const claimed = await tx.character.updateMany({
        where: { id: char.id, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      if (claimed.count !== 1) {
        throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Character is not available for battle', 409)
      }
      await tx.battleParticipant.create({
        data: { battleId, characterId: char.id, side, hpMax: char.hpMax, hpCurrent: char.hpCurrent },
      })
      const total = await tx.battleParticipant.count({ where: { battleId } })
      return { battleId, side, joined: total, perSide }
    })
  },

  /** Запустить бой: обе стороны должны быть непустыми. */
  async startTeamBattle(userId: string, battleId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

    const battle = await prisma.battle.findUnique({ where: { id: battleId }, include: { participants: true } })
    if (!battle) throw AppError.notFound('Battle', battleId)
    if (battle.type !== 'CLAN') throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Not a team battle', 400)
    if (battle.status !== 'WAITING_PLAYERS') throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Battle already started', 400)
    if (!battle.participants.some(p => p.characterId === char.id)) {
      throw new AppError(ErrorCode.BATTLE_NOT_PARTICIPANT, 'Not a participant', 403)
    }
    const sideOne = battle.participants.filter(p => p.side === 1)
    const sideTwo = battle.participants.filter(p => p.side === 2)
    if (sideOne.length === 0 || sideTwo.length === 0) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Обе стороны должны быть заняты', 409)
    }

    return this.beginTeamState(battleId)
  },

  /**
   * Построить живое состояние командного боя и открыть его.
   *
   * Вынесено из startTeamBattle, потому что боёв за территорию касается тот
   * же код: заявку назначает воркер, и без этого шага бой существовал бы
   * только строками в базе. Ровно это и случилось в Этапе 4 — участники
   * оставались IN_BATTLE навсегда, а заявка навсегда в статусе BATTLE.
   *
   * Живое состояние помечается типом CLAN независимо от типа боя в базе:
   * тип в состоянии выбирает резолвер раунда, и командный бой за район
   * считается тем же кодом, что и клановый. Тип TERRITORY в базе нужен
   * воркеру заявок, а не боевому движку.
   */
  async beginTeamState(battleId: string) {
    const battle = await prisma.battle.findUnique({
      where: { id: battleId }, include: { participants: true },
    })
    if (!battle) throw AppError.notFound('Battle', battleId)
    const sideOne = battle.participants.filter(p => p.side === 1)
    const sideTwo = battle.participants.filter(p => p.side === 2)
    if (sideOne.length === 0 || sideTwo.length === 0) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Обе стороны должны быть заняты', 409)
    }

    const spawnsOne = teamSpawnPositions(1, sideOne.length)
    const spawnsTwo = teamSpawnPositions(2, sideTwo.length)

    const participants: LiveParticipant[] = []
    for (const [side, members, spawns] of [[1, sideOne, spawnsOne], [2, sideTwo, spawnsTwo]] as const) {
      for (const [index, member] of members.entries()) {
        const memberChar = await CharactersRepository.findById(member.characterId!)
        const weapons = memberChar
          ? await ItemsRepository.findEquippedWeapons(memberChar.id)
          : { LEFT_HAND: null, RIGHT_HAND: null }
        participants.push({
          participantId: member.id,
          characterId: member.characterId!,
          hpCurrent: member.hpCurrent,
          hpMax: member.hpMax,
          side,
          isAlive: true,
          isSurrendered: false,
          hasActedThisRound: false,
          weaponInstanceId: weapons.LEFT_HAND?.id,
          leftWeaponInstanceId: weapons.LEFT_HAND?.id,
          rightWeaponInstanceId: weapons.RIGHT_HAND?.id,
          pocketItemIds: memberChar ? await loadBattlePocket(memberChar) : [],
          damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
          skippedTurns: 0,
          position: spawns[index],
        })
      }
    }

    const liveState: LiveBattleState = {
      battleId,
      type: 'CLAN',
      roundNumber: 1,
      status: 'active',
      roundDeadline: Date.now() + TURN_TIMEOUT_MS,
      grid: BATTLE_GRID,
      participants,
    }
    syncGridDistance(liveState)
    await BattleRedis.setState(battleId, liveState)
    await prisma.battle.update({
      where: { id: battleId },
      data: { status: 'ACTIVE', startedAt: new Date(), roundCount: 0 },
    })
    return { battleId, status: 'ACTIVE', participants: participants.length }
  },

  /** Открытые командные бои, к которым можно присоединиться. */
  async listTeamBattles() {
    const battles = await prisma.battle.findMany({
      where: { type: 'CLAN', status: 'WAITING_PLAYERS' },
      include: { participants: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    const characterIds = battles.flatMap(b => b.participants.map(p => p.characterId).filter(Boolean) as string[])
    const characters = await prisma.character.findMany({
      where: { id: { in: characterIds } },
      select: { id: true, nickname: true, battleLevel: true },
    })
    const byId = new Map(characters.map(c => [c.id, c]))
    return {
      items: battles.map(b => ({
        battleId: b.id,
        perSide: b.roundCount || 1,
        levelMin: b.levelMin,
        levelMax: b.levelMax,
        sides: [1, 2].map(side => ({
          side,
          members: b.participants
            .filter(p => p.side === side)
            .map(p => byId.get(p.characterId ?? '') ?? { id: p.characterId, nickname: '—', battleLevel: 0 }),
        })),
      })),
    }
  },

  // -------------------------------------------------------
  // Accept PvP Duel
  // -------------------------------------------------------
  async acceptPvpDuel(userId: string, battleId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    assertIntoxicationAllowsBattle(char)
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)

    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: { participants: true },
    })
    if (!battle) throw AppError.notFound('Battle', battleId)
    if (battle.status !== 'WAITING_PLAYERS') throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Duel not open for joining', 400)
    if (battle.participants.some(p => p.characterId === char.id)) {
      throw new AppError(ErrorCode.CONFLICT, 'You are already in this duel', 400)
    }
    // Проверка уровневого диапазона
    if (char.battleLevel < battle.levelMin || char.battleLevel > battle.levelMax) {
      throw new AppError(ErrorCode.CONFLICT, `Требуется уровень ${battle.levelMin}–${battle.levelMax}`, 400)
    }

    const weapons = await ItemsRepository.findEquippedWeapons(char.id)
    const weapon = weapons.LEFT_HAND
    const opponentPart = battle.participants[0]

    return withTransaction(async (tx) => {
      const claimedCharacter = await tx.character.updateMany({
        where: { id: char.id, status: 'ACTIVE' },
        data: { status: 'IN_BATTLE' },
      })
      if (claimedCharacter.count !== 1) {
        throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Character is not available for battle', 409)
      }

      const claimedBattle = await tx.battle.updateMany({
        where: { id: battleId, status: 'WAITING_PLAYERS' },
        data: { status: 'ACTIVE', startedAt: new Date() },
      })
      if (claimedBattle.count !== 1) {
        throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Duel is no longer open', 409)
      }

      // Capture the created participant ID.
      const newParticipant = await tx.battleParticipant.create({
        data: {
          battleId: battle.id,
          characterId: char.id,
          side: 2,
          hpMax: char.hpMax,
          hpCurrent: char.hpCurrent,
        },
      })
      const opponentChar = await CharactersRepository.findById(opponentPart.characterId!)
      const oppWeapons = opponentChar ? await ItemsRepository.findEquippedWeapons(opponentChar.id) : { LEFT_HAND: null, RIGHT_HAND: null }
      const oppWeapon = oppWeapons.LEFT_HAND
      const opponentPocketItemIds = opponentChar ? await loadBattlePocket(opponentChar) : []
      const pocketItemIds = await loadBattlePocket(char)

      const liveState: LiveBattleState = {
        battleId: battle.id,
        type: 'PVP_DUEL',
        roundNumber: 1,
        status: 'active',
        roundDeadline: Date.now() + TURN_TIMEOUT_MS,
        distance: 6,
        grid: BATTLE_GRID,
        participants: [
          {
            participantId: opponentPart.id,
            characterId: opponentPart.characterId!,
            hpCurrent: opponentPart.hpCurrent,
            hpMax: opponentPart.hpMax,
            side: 1,
            isAlive: true,
            isSurrendered: false,
            hasActedThisRound: false,
            weaponInstanceId: oppWeapon?.id,
            leftWeaponInstanceId: oppWeapons.LEFT_HAND?.id,
            rightWeaponInstanceId: oppWeapons.RIGHT_HAND?.id,
            pocketItemIds: opponentPocketItemIds,
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: teamSpawnPositions(1, 1)[0],
          },
          {
            participantId: newParticipant.id, // FIX: use actual ID
            characterId: char.id,
            hpCurrent: char.hpCurrent,
            hpMax: char.hpMax,
            side: 2,
            isAlive: true,
            isSurrendered: false,
            hasActedThisRound: false,
            weaponInstanceId: weapon?.id,
            leftWeaponInstanceId: weapons.LEFT_HAND?.id,
            rightWeaponInstanceId: weapons.RIGHT_HAND?.id,
            pocketItemIds,
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: teamSpawnPositions(2, 1)[0],
          },
        ],
      }
      await BattleRedis.setState(battle.id, liveState)
      return { battleId: battle.id, status: 'ACTIVE' }
    })
  },

  // -------------------------------------------------------
  // Get battle state
  // -------------------------------------------------------
  async getBattle(battleId: string, userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: { participants: true, turns: { orderBy: { roundNumber: 'asc' }, take: 50 } },
    })
    if (!battle) throw AppError.notFound('Battle', battleId)
    if (!battle.participants.some(participant => participant.characterId === char.id)) {
      throw new AppError(ErrorCode.BATTLE_NOT_PARTICIPANT, 'Not a battle participant', 403)
    }

    const liveState = await BattleRedis.getState<LiveBattleState>(battleId)
    const participantProfiles = await Promise.all(battle.participants.map(async participant => {
      if (participant.characterId) {
        const character = await prisma.character.findUnique({
          where: { id: participant.characterId },
          select: {
            nickname: true,
            avatar: true,
            battleLevel: true,
            stats: { select: { str: true, agi: true, rea: true, acc: true, end: true, luck: true, agr: true } },
            items: {
              where: { isEquipped: true, status: { not: 'DELETED' }, template: { type: 'WEAPON' } },
              select: { armorSlot: true, template: { select: { name: true, code: true, weaponType: true, maxRange: true } } },
            },
          },
        })
        const primary = character?.items.find(item => item.armorSlot === 'LEFT_HAND') ?? character?.items.find(item => item.armorSlot == null)
        const secondary = character?.items.find(item => item.armorSlot === 'RIGHT_HAND')
        return {
          participantId: participant.id,
          name: character?.nickname ?? 'Боец',
          level: character?.battleLevel ?? 0,
          avatar: character?.avatar ?? null,
          primaryHand: primary?.template.name ?? null,
          secondaryHand: secondary?.template.name ?? null,
          primaryWeaponCode: primary?.template.code ?? null,
          secondaryWeaponCode: secondary?.template.code ?? null,
          primaryWeaponType: primary?.template.weaponType ?? null,
          secondaryWeaponType: secondary?.template.weaponType ?? null,
          primaryRange: primary?.template.maxRange ?? 1,
          secondaryRange: secondary?.template.maxRange ?? 1,
          stats: character?.stats ?? null,
        }
      }
      const bot = participant.botId ? await prisma.bot.findUnique({
        where: { id: participant.botId }, select: { name: true, battleLevel: true, equipment: true, stats: true },
      }) : null
      const equipment = bot?.equipment && typeof bot.equipment === 'object' && !Array.isArray(bot.equipment)
        ? bot.equipment as Record<string, unknown> : {}
      const mainWeapon = typeof equipment.mainWeapon === 'string' ? equipment.mainWeapon
        : typeof equipment.weaponName === 'string' ? equipment.weaponName
        : equipment.weapon && typeof equipment.weapon === 'object' ? 'Оружие' : null
      const botWeapon = equipment.weapon && typeof equipment.weapon === 'object'
        ? equipment.weapon as Record<string, unknown> : {}
      return {
        participantId: participant.id,
        name: bot?.name ?? 'Противник',
        level: bot?.battleLevel ?? 0,
        avatar: typeof equipment.avatar === 'string' ? equipment.avatar : null,
        primaryHand: mainWeapon,
        secondaryHand: null,
        primaryWeaponCode: typeof botWeapon.code === 'string' ? botWeapon.code : null,
        secondaryWeaponCode: null,
        primaryWeaponType: typeof botWeapon.weaponType === 'string' ? botWeapon.weaponType : null,
        secondaryWeaponType: null,
        primaryRange: typeof botWeapon.maxRange === 'number' ? Number(botWeapon.maxRange) : 1,
        secondaryRange: 1,
        stats: bot?.stats && typeof bot.stats === 'object' && !Array.isArray(bot.stats) ? bot.stats as Record<string, number> : null,
      }
    }))
    return { battle, liveState, participantProfiles }
  },

  // -------------------------------------------------------
  // Submit action
  // -------------------------------------------------------
  async submitAction(
    userId: string,
    battleId: string,
    input: {
      action: string
      itemInstanceId?: string
      weaponHand?: AttackHand
      stance?: string
      attackZones?: string[]
      attackHands?: string[]
      blockZones?: string[]
      moveTo?: GridPosition
      targetParticipantId?: string
      /** Этап 4: переодевание в бою, часть обычного хода. */
      swapWeapon?: { hand: AttackHand; itemInstanceId: string }
      swapArmor?: { zone: BodyZone; itemInstanceId: string }
    } | string,
    legacyTargetItemId?: string
  ) {
    // Обратная совместимость: поддерживаем и старую сигнатуру (action, itemId), и новый payload
    const payload = typeof input === 'string'
      ? { action: input, itemInstanceId: legacyTargetItemId }
      : input
    const action = payload.action
    const targetItemId = payload.itemInstanceId
    const weaponHand: AttackHand = payload.weaponHand ?? 'LEFT_HAND'

    const lockToken = await BattleRedis.acquireLock(battleId, BATTLE_LOCK_TTL_MS)
    if (!lockToken) throw new AppError(ErrorCode.BATTLE_LOCK_FAILED, 'Battle is processing, retry', 409)

    let lockLost = false
    const lockHeartbeat = setInterval(async () => {
      try {
        if (!(await BattleRedis.extendLock(battleId, lockToken, BATTLE_LOCK_TTL_MS))) lockLost = true
      } catch {
        lockLost = true
      }
    }, 5_000)
    lockHeartbeat.unref()

    try {
      const state = await BattleRedis.getState<LiveBattleState>(battleId)
      if (lockLost) throw new AppError(ErrorCode.BATTLE_LOCK_FAILED, 'Battle lock lost, retry', 409)
      if (!state) throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Battle not found in state', 404)
      if (state.status !== 'active') throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Battle is not active', 400)

      const char = await CharactersRepository.findByUserId(userId)
      if (!char || !char.stats) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const playerPart = state.participants.find(p => p.characterId === char.id)
      if (!playerPart) throw new AppError(ErrorCode.BATTLE_NOT_PARTICIPANT, 'Not a participant', 403)
      if (!playerPart.isAlive) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'You are dead', 400)
      if (playerPart.hasActedThisRound) throw new AppError(ErrorCode.BATTLE_ACTION_TAKEN, 'Already acted this round', 400)

      // ── Anti-abuse: отслеживаем пропуски ────────────────
      // "block" без атаки — пассивный ход, считается как активный
      // Только явное бездействие (не block, attack, use_item, change_weapon, surrender) = пропуск
      // В текущей схеме все actions явные, поэтому skippedTurns не растёт здесь,
      // но обнуляем при любом активном действии для честности
      playerPart.skippedTurns = 0

      // ── Сдача ───────────────────────────────────────────
      if (action === 'surrender') {
        playerPart.isSurrendered = true
        playerPart.isAlive = false
        state.status = 'finishing'
        await BattleRedis.setState(battleId, state)

        if (state.type === 'PVE_BOT') {
          const botPart = state.participants.find(p => p.botId)
          if (!botPart?.botId) throw AppError.internal('PvE opponent missing')
          const bot = await loadBotData(botPart.botId)
          const weapon = playerPart.weaponInstanceId
            ? await ItemsRepository.findInstanceById(playerPart.weaponInstanceId)
            : null
          const skill = await WeaponSkillsRepository.findOrCreate(
            char.id,
            (weapon?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1],
          )
          return this._finishPveBattle(
            battleId, state, char, bot, playerPart, botPart, null, weapon, skill.skillLevel,
          )
        }

        const opponentPart = state.participants.find(p => p.characterId && p.characterId !== char.id)
        if (!opponentPart?.characterId) throw AppError.internal('PvP opponent missing')
        const opponent = await CharactersRepository.findById(opponentPart.characterId)
        if (!opponent?.stats) throw AppError.internal('PvP opponent character missing')
        const [weapon1, weapon2] = await Promise.all([
          playerPart.weaponInstanceId ? ItemsRepository.findInstanceById(playerPart.weaponInstanceId) : Promise.resolve(null),
          opponentPart.weaponInstanceId ? ItemsRepository.findInstanceById(opponentPart.weaponInstanceId) : Promise.resolve(null),
        ])
        const [skill1, skill2] = await Promise.all([
          WeaponSkillsRepository.findOrCreate(char.id, (weapon1?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]),
          WeaponSkillsRepository.findOrCreate(opponent.id, (weapon2?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]),
        ])
        return this._finishPvpBattle(
          battleId, state, char, opponent, playerPart, opponentPart, opponent.id,
          weapon1, weapon2, skill1.skillLevel, skill2.skillLevel,
        )
      }

      // ── Смена оружия ─────────────────────────────────────
      if (state.type === 'PVP_DUEL' && (action === 'change_weapon' || action === 'use_item')) {
        if (!targetItemId) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'No item specified', 400)
        const item = await ItemsRepository.findInstanceById(targetItemId)
        if (!item || item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
        if (action === 'change_weapon') {
          if (item.template.type !== 'WEAPON' || item.status === 'BROKEN') {
            throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Invalid weapon', 400)
          }
        } else if (!playerPart.pocketItemIds?.includes(targetItemId) || item.template.type !== 'CONSUMABLE') {
          throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Item is not in battle loadout', 400)
        }
        playerPart.pendingAction = action === 'change_weapon'
          ? `${action}:${weaponHand}:${targetItemId}`
          : `${action}:${targetItemId}`
        playerPart.pendingTurn = undefined
        playerPart.hasActedThisRound = true
        await BattleRedis.setState(battleId, state)
        const allActed = state.participants.every(p => !p.isAlive || p.isSurrendered || p.hasActedThisRound)
        if (allActed) return this._resolveRoundPvp(battleId, state)
        return { waiting: true, roundNumber: state.roundNumber }
      }

      if (action === 'change_weapon') {
        if (!targetItemId) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'No weapon specified', 400)
        const newWeapon = await ItemsRepository.findInstanceById(targetItemId)
        if (!newWeapon || newWeapon.ownerId !== char.id)
          throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your weapon', 403)
        if (newWeapon.status === 'BROKEN')
          throw new AppError(ErrorCode.ITEM_BROKEN, 'Weapon is broken', 400)
        if (newWeapon.template.type !== 'WEAPON')
          throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Not a weapon', 400)

        // Replace only the selected hand. A shield and a weapon share RIGHT_HAND.
        const occupied = await ItemsRepository.findEquippedBySlot(char.id, weaponHand)
        if (occupied && occupied.id !== targetItemId) await ItemsRepository.unequip(occupied.id)
        await ItemsRepository.equip(targetItemId, weaponHand)
        if (weaponHand === 'LEFT_HAND') {
          if (playerPart.rightWeaponInstanceId === targetItemId) playerPart.rightWeaponInstanceId = undefined
          playerPart.leftWeaponInstanceId = targetItemId
          playerPart.weaponInstanceId = targetItemId
        } else {
          if (playerPart.leftWeaponInstanceId === targetItemId || playerPart.weaponInstanceId === targetItemId) {
            playerPart.leftWeaponInstanceId = undefined
            playerPart.weaponInstanceId = undefined
          }
          playerPart.rightWeaponInstanceId = targetItemId
        }
        state.roundNumber++
      state.roundDeadline = Date.now() + TURN_TIMEOUT_MS

        await prisma.battleTurn.create({
          data: {
            battleId, roundNumber: state.roundNumber - 1,
            actorCharId: char.id, action: 'CHANGE_WEAPON' as BattleAction,
            weaponId: targetItemId,
            hit: false, dodge: false, block: false, crit: false,
            rawDamage: 0, finalDamage: 0,
            logLine: `${weaponHand === 'LEFT_HAND' ? 'Left hand' : 'Right hand'}: changed weapon to ${newWeapon.template.name}`,
          },
        })

        await BattleRedis.setState(battleId, state)
        return {
          roundNumber: state.roundNumber - 1,
          weaponChanged: true,
          newWeaponName: newWeapon.template.name,
          weaponHand,
          turns: [{ actor: 'player', action: 'change_weapon', hit: false, dodge: false, block: false, crit: false, rawDamage: 0, finalDamage: 0, logParts: [`Сменил оружие: ${newWeapon.template.name}`] }],
          playerHp: playerPart.hpCurrent,
          botHp: state.participants.find(p => p.botId)?.hpCurrent ?? 0,
          battleOver: false,
        }
      }

      // ── Использование предмета (расходник) ───────────────
      if (action === 'use_item') {
        if (!targetItemId) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'No item specified', 400)
        return this._handleUseItem(battleId, state, char, playerPart, targetItemId)
      }

      // ── Зональный ход: стойка (2 удара / 1 блок+1 удар / 4 блока) + зоны ──
      const turn: ZonalTurnInput = payload.stance || payload.moveTo
        ? normalizeTurn({
            stance: payload.stance as ZonalTurnInput['stance'],
            attackZones: (payload.attackZones ?? []) as BodyZone[],
            attackHands: (payload.attackHands ?? []) as AttackHand[],
            blockZones: (payload.blockZones ?? []) as BodyZone[],
            swapWeapon: payload.swapWeapon,
            swapArmor: payload.swapArmor,
            moveTo: payload.moveTo,
            targetParticipantId: payload.targetParticipantId,
          })
        : legacyActionToTurn(action)

      // ── PvE: авторазрешение раунда ─────────────────────
      if (state.type === 'PVE_BOT') {
        return this._resolveRoundPve(battleId, state, char, turn)
      }

      // ── PvP: сохраняем ход, ждём противника ────────────
      // Чистое перемещение применяем сразу, не дожидаясь чужого хода:
      // шаг — это тактика, и противник должен видеть его немедленно,
      // иначе оба ходят вслепую. Удар по-прежнему ждёт конца раунда:
      // одновременный размен на то и одновременный.
      const pureMove = Boolean(turn.moveTo) && turn.attackZones.length === 0
      let movedNow: { fromX: number; fromY: number } | null = null
      if (pureMove) {
        movedNow = this._applyImmediateMove(state, playerPart, turn.moveTo!)
        // Ход уже совершён — убираем его из отложенного, иначе
        // разрешение раунда сдвинет фигуру второй раз.
        turn.moveTo = undefined
        await prisma.battleTurn.create({
          data: {
            battleId, roundNumber: state.roundNumber,
            actorCharId: char.id, action: 'MOVE' as BattleAction,
            fromX: movedNow.fromX, fromY: movedNow.fromY,
            toX: playerPart.position.x, toY: playerPart.position.y,
            logLine: `Шаг в (${playerPart.position.x}, ${playerPart.position.y})`,
          },
        })
      }

      playerPart.pendingAction = action
      playerPart.pendingTurn = turn
      playerPart.hasActedThisRound = true
      await BattleRedis.setState(battleId, state)

      const allActed = state.participants.every(p => !p.isAlive || p.isSurrendered || p.hasActedThisRound)
      if (allActed) {
        return state.type === 'CLAN'
          ? this._resolveRoundTeam(battleId, state)
          : this._resolveRoundPvp(battleId, state)
      }
      return {
        waiting: true,
        roundNumber: state.roundNumber,
        ...(movedNow ? { moved: true, position: playerPart.position, distance: state.distance } : {}),
      }

    } finally {
      clearInterval(lockHeartbeat)
      await BattleRedis.releaseLock(battleId, lockToken)
    }
  },

  // -------------------------------------------------------
  // Handle use_item: consumable usage in battle
  // -------------------------------------------------------
  async _handleUseItem(
    battleId: string,
    state: LiveBattleState,
    char: CharacterWithStats,
    playerPart: LiveParticipant,
    itemInstanceId: string
  ) {
    if (!playerPart.pocketItemIds?.includes(itemInstanceId)) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Item is not in battle loadout', 400)
    }
    const item = await ItemsRepository.findInstanceById(itemInstanceId)
    if (!item) throw AppError.notFound('Item', itemInstanceId)
    if (item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
    if (item.template.type !== 'CONSUMABLE') {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Item is not a consumable', 400)
    }
    if (item.status === 'CONSUMED' || item.status === 'DELETED') {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Item already used', 400)
    }

    // Apply effect: restore HP by hpBonus (used as hpRestore for consumables)
    const hpRestore = item.template.hpBonus ?? 0
    const newHp = Math.min(playerPart.hpMax, playerPart.hpCurrent + hpRestore)
    playerPart.hpCurrent = newHp

    // Consume the item — использованный расходник сразу удаляется из инвентаря
    // (soft-delete в DELETED: сохраняет аудит ItemLog, но убирает из findByOwner)
    await ItemsRepository.delete(itemInstanceId)

    // Log the action
    const roundNumber = state.roundNumber
    await prisma.battleTurn.create({
      data: {
        battleId, roundNumber,
        actorCharId: char.id, action: 'USE_ITEM' as BattleAction,
        hit: false, dodge: false, block: false, crit: false,
        rawDamage: 0, finalDamage: 0,
        logLine: `Использовал ${item.template.name}: +${hpRestore} HP (теперь ${newHp}/${playerPart.hpMax})`,
      },
    })

    playerPart.pocketItemIds = playerPart.pocketItemIds.filter(id => id !== itemInstanceId)
    // Mark player as having acted this round
    playerPart.hasActedThisRound = true

    // For PvE: бот ходит зонально в тот же раунд (игрок использовал предмет → не блокирует)
    if (state.type === 'PVE_BOT') {
      const botPart = state.participants.find(p => p.botId)!
      const bot = await loadBotData(botPart.botId!)
      const botStats = bot.stats as Record<string, number>
      const botEquip = bot.equipment as Record<string, unknown>
      const equippedItems = await ItemsRepository.findEquipped(char.id)
      const equippedArmor = equippedItems.filter(i => i.template.type === 'ARMOR')
      const playerArmorList = armorListFromEquipped(equippedArmor)
      const playerDefSnap = buildDefenderSnapshot(char, equippedArmor)
      const botAttackSnap = buildBotAttackerSnapshot(botStats, botEquip)

      const botTurn = botChooseTurn()
      const botWeapon = botEquip.weapon as Record<string, number> | undefined
      const botRange = Math.max(1, botWeapon?.maxRange ?? 1)
      ensureGridState(state)
      const botFrom = { ...botPart.position }
      let projected = positionedParticipants(state)
      let gridBot = projected.find(p => p.participantId === botPart.participantId)!
      let gridPlayer = projected.find(p => p.participantId === playerPart.participantId)!
      const botWantsAttack = botTurn.attackZones.length > 0
      let botMoving = false
      if (botWantsAttack && !canAttackTarget(gridBot, gridPlayer, projected, botRange)) {
        const candidates = botRange > 1 && gridDistance(gridBot.position, gridPlayer.position) <= 1
          ? stepAway(gridBot.position, gridPlayer.position)
          : stepToward(gridBot.position, gridPlayer.position)
        const destination = candidates.find(cell => canMoveTo(gridBot, cell, projected))
        if (destination) {
          botPart.position = destination
          botMoving = true
          projected = positionedParticipants(state)
          gridBot = projected.find(p => p.participantId === botPart.participantId)!
          gridPlayer = projected.find(p => p.participantId === playerPart.participantId)!
        }
      }
      syncGridDistance(state)
      const botInRange = !botMoving && canAttackTarget(gridBot, gridPlayer, projected, botRange)
      const botHitZones: BodyZone[] = []

      // Клиентский лог: сначала событие аптечки
      const clientTurns: Array<Record<string, unknown>> = [{
        actor: 'player', action: 'use_item',
        hit: false, dodge: false, block: false, crit: false, lucky: false,
        rawDamage: 0, finalDamage: 0, counterDamage: 0,
        logParts: [`${item.template.name}: +${hpRestore} HP`],
      }]

      if (botWantsAttack && botInRange) {
        const res = executeStrikes({
          attackerSnap: botAttackSnap, defenderSnap: playerDefSnap,
          zoneArmorFor: (z) => armorOfZone(playerArmorList, z),
          attackZones: botTurn.attackZones, blockedZones: [], defenderHp: playerPart.hpCurrent,
        })
        for (const r of res.results) {
          if (r.hit && !r.dodge && !r.block) {
            playerPart.hpCurrent = Math.max(0, playerPart.hpCurrent - r.finalDamage)
            botPart.hitsLanded++; playerPart.hitsTaken++; botHitZones.push(r.zone)
          }
          clientTurns.push({ actor: 'enemy', action: 'attack', ...r })
        }
        botPart.damageDealt += res.damageToDefender
        playerPart.damageReceived += res.damageToDefender
      } else if (botMoving) {
        clientTurns.push({
          actor: 'enemy', action: 'move', to: botPart.position,
          hit: false, dodge: false, block: false, crit: false, lucky: false,
          rawDamage: 0, finalDamage: 0, counterDamage: 0,
          logParts: [`Противник переместился в (${botPart.position.x}, ${botPart.position.y})`],
        })
      }

      playerPart.isAlive = playerPart.hpCurrent > 0

      // DB-записи по зональным ударам бота
      if (botMoving) {
        await prisma.battleTurn.create({
          data: {
            battleId, roundNumber, actorBotId: botPart.botId,
            action: 'MOVE' as BattleAction,
            fromX: botFrom.x, fromY: botFrom.y,
            toX: botPart.position.x, toY: botPart.position.y,
          },
        })
      }
      for (const t of clientTurns) {
        if (t.actor !== 'enemy' || t.action !== 'attack') continue
        await prisma.battleTurn.create({
          data: {
            battleId, roundNumber,
            actorBotId: botPart.botId, targetCharId: char.id,
            action: 'ATTACK' as BattleAction,
            zone: (t.zone as BodyZone) ?? null,
            blockPierced: (t.blockPierced as boolean) ?? false,
            hit: t.hit as boolean, dodge: t.dodge as boolean, block: t.block as boolean, crit: t.crit as boolean,
            rawDamage: t.rawDamage as number, finalDamage: t.finalDamage as number,
            logLine: (t.logParts as string[]).join(', '),
          },
        })
      }
      // Зональный износ брони
      await applyZonalArmorWear(equippedArmor, botHitZones)

      if (!playerPart.isAlive) {
        state.status = 'finishing'
        const weapon = playerPart.weaponInstanceId
          ? await ItemsRepository.findInstanceById(playerPart.weaponInstanceId)
          : null
        const skillRecord = await WeaponSkillsRepository.findOrCreate(
          char.id,
          (weapon?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
        )
        await BattleRedis.setState(battleId, state)
        return this._finishPveBattle(battleId, state, char, bot, playerPart, botPart, null, weapon, skillRecord.skillLevel)
      }

      state.roundNumber++
      state.roundDeadline = Date.now() + TURN_TIMEOUT_MS
      playerPart.hasActedThisRound = false
      await BattleRedis.setState(battleId, state)

      return {
        roundNumber,
        itemUsed: item.template.name,
        hpRestored: hpRestore,
        distance: state.distance,
        playerHp: playerPart.hpCurrent,
        botHp: botPart.hpCurrent,
        battleOver: false,
        turns: clientTurns,
      }
    }

    // PvP: check if both acted
    await BattleRedis.setState(battleId, state)
    const allActed = state.participants.every(p => !p.isAlive || p.isSurrendered || p.hasActedThisRound)
    if (allActed) {
      return this._resolveRoundPvp(battleId, state)
    }
    return {
      waiting: true,
      itemUsed: item.template.name,
      hpRestored: hpRestore,
      roundNumber: state.roundNumber,
    }
  },

  // -------------------------------------------------------
  // Resolve PvE round (зональная модель)
  // -------------------------------------------------------
  async _resolveRoundPve(
    battleId: string,
    state: LiveBattleState,
    char: CharacterWithStats,
    playerTurn: ZonalTurnInput
  ) {
    const playerPart = state.participants.find(p => p.characterId === char.id)!
    let botPart: LiveParticipant
    try {
      botPart = selectEnemyTarget(playerPart, state.participants, playerTurn.targetParticipantId)
    } catch {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Invalid battle target', 400)
    }
    if (!botPart.botId) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'PvE target must be a bot', 400)
    // Переодевание применяется первым: подмена должна подействовать в
    // этом же ходу, её цена уже снята бюджетом.
    const swapNotes = await applyTurnSwaps(char.id, playerPart, playerTurn)

    const bot = await loadBotData(botPart.botId!)
    const botStats = bot.stats as Record<string, number>
    const botEquip = bot.equipment as Record<string, unknown>

    const [leftWeapon, rightWeapon] = await Promise.all([
      playerPart.leftWeaponInstanceId || playerPart.weaponInstanceId ? ItemsRepository.findInstanceById(playerPart.leftWeaponInstanceId ?? playerPart.weaponInstanceId!) : Promise.resolve(null),
      playerPart.rightWeaponInstanceId ? ItemsRepository.findInstanceById(playerPart.rightWeaponInstanceId) : Promise.resolve(null),
    ])
    const weapon = leftWeapon
    const leftSkill = await WeaponSkillsRepository.findOrCreate(char.id, (leftWeapon?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])
    const rightSkill = await WeaponSkillsRepository.findOrCreate(char.id, (rightWeapon?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])
    const skillRecord = leftSkill

    const equippedItems = await ItemsRepository.findEquipped(char.id)
    const equippedArmor = equippedItems.filter(i => i.template.type === 'ARMOR')
    const playerArmorList = armorListFromEquipped(equippedArmor)

    const [leftAttackerSnap, rightAttackerSnap] = await Promise.all([
      buildAttackerSnapshotAsync(char, leftWeapon, leftSkill.skillLevel, equippedArmor),
      buildAttackerSnapshotAsync(char, rightWeapon, rightSkill.skillLevel, equippedArmor),
    ])
    const totalEquipmentWeight = equippedArmor.reduce((sum, item) => sum + item.weight, 0) + (leftWeapon?.weight ?? 0) + (rightWeapon?.weight ?? 0)
    leftAttackerSnap.equipmentWeight = totalEquipmentWeight
    rightAttackerSnap.equipmentWeight = totalEquipmentWeight
    const attackerSnap = leftAttackerSnap
    const defenderSnap = buildBotDefenderSnapshot(botStats)   // бот как защитник
    const botAttackSnap = buildBotAttackerSnapshot(botStats, botEquip)
    const playerDefSnap = buildDefenderSnapshot(char, equippedArmor)

    // Бот выбирает свою стойку и зоны
    const botTurn = botChooseTurn()

    // ── Движение / дистанция ──────────────────────────────
    const playerRange = Math.max(weaponRangeOf(leftWeapon), weaponRangeOf(rightWeapon))
    const botWeapon = botEquip.weapon as Record<string, number> | undefined
    const botRange = Math.max(1, botWeapon?.maxRange ?? 1)
    const playerFrom = { ...playerPart.position }
    const botFrom = { ...botPart.position }
    const playerMoved = applyRequestedMove(state, playerPart, playerTurn.moveTo)

    let projected = positionedParticipants(state)
    let gridPlayer = projected.find(p => p.participantId === playerPart.participantId)!
    let gridBot = projected.find(p => p.participantId === botPart.participantId)!
    let botMoved = false
    const botWantsAttack = botTurn.attackZones.length > 0
    if (botWantsAttack && !canAttackTarget(gridBot, gridPlayer, projected, botRange)) {
      const candidates = botRange > 1 && gridDistance(gridBot.position, gridPlayer.position) <= 1
        ? stepAway(gridBot.position, gridPlayer.position)
        : stepToward(gridBot.position, gridPlayer.position)
      const destination = candidates.find(cell => canMoveTo(gridBot, cell, projected))
      if (destination) {
        botPart.position = destination
        botMoved = true
        projected = positionedParticipants(state)
        gridPlayer = projected.find(p => p.participantId === playerPart.participantId)!
        gridBot = projected.find(p => p.participantId === botPart.participantId)!
      }
    }

    syncGridDistance(state)
    const playerWantsAttack = !playerMoved && playerTurn.attackZones.length > 0
    const playerAttackRanges = playerTurn.attackHands.map(hand => weaponRangeOf(hand === 'RIGHT_HAND' ? rightWeapon : leftWeapon))
    const doPlayerStrike = playerWantsAttack && playerAttackRanges.every(range => canAttackTarget(gridPlayer, gridBot, projected, range))
    const doBotStrike = !botMoved && botWantsAttack && canAttackTarget(gridBot, gridPlayer, projected, botRange)

    const playerInit = calcInitiative(char.stats!.rea, char.stats!.agi, skillRecord.skillLevel, attackerSnap.equipmentWeight)
    const botInit    = calcInitiative(botStats.rea ?? 2, botStats.agi ?? 2, 1, 0)
    const playerFirst = playerInit >= botInit

    let playerHp = playerPart.hpCurrent
    let botHp = botPart.hpCurrent

    type TurnRec = { actor: 'player' | 'bot'; r: HandStrikeResult }
    const turns: TurnRec[] = []
    const botHitZonesOnPlayer: BodyZone[] = []

    const playerStrike = () => {
      const res = executeStrikes({
        attackerSnap, attackerSnaps: { LEFT_HAND: leftAttackerSnap, RIGHT_HAND: rightAttackerSnap },
        weaponIds: { LEFT_HAND: leftWeapon?.id ?? null, RIGHT_HAND: rightWeapon?.id ?? null },
        defenderSnap,
        zoneArmorFor: (zone) => botArmorOfZone(botEquip, zone, defenderSnap.armor),
        attackZones: playerTurn.attackZones,
        attackHands: playerTurn.attackHands,
        blockedZones: botTurn.blockZones,
        defenderHp: botHp,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) {
          botHp = Math.max(0, botHp - r.finalDamage); playerPart.hitsLanded++; botPart.hitsTaken++
          recordWeaponDamage(playerPart, r.sourceHand === 'RIGHT_HAND' ? rightWeapon : leftWeapon, r.finalDamage)
        }
        turns.push({ actor: 'player', r })
      }
      playerPart.damageDealt += res.damageToDefender
      botPart.damageReceived += res.damageToDefender
      if (res.counterToAttacker > 0) {   // бот заблокировал и дал ответку
        playerHp = Math.max(0, playerHp - res.counterToAttacker)
        botPart.damageDealt += res.counterToAttacker
        playerPart.damageReceived += res.counterToAttacker
      }
    }

    const botStrike = () => {
      const res = executeStrikes({
        attackerSnap: botAttackSnap, defenderSnap: playerDefSnap,
        zoneArmorFor: (z) => armorOfZone(playerArmorList, z),
        attackZones: botTurn.attackZones,
        blockedZones: playerTurn.blockZones,
        defenderHp: playerHp,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) {
          playerHp = Math.max(0, playerHp - r.finalDamage); botPart.hitsLanded++; playerPart.hitsTaken++
          botHitZonesOnPlayer.push(r.zone)
        }
        turns.push({ actor: 'bot', r })
      }
      botPart.damageDealt += res.damageToDefender
      playerPart.damageReceived += res.damageToDefender
      if (res.counterToAttacker > 0) {   // игрок заблокировал и дал ответку
        botHp = Math.max(0, botHp - res.counterToAttacker)
        playerPart.damageDealt += res.counterToAttacker
        botPart.damageReceived += res.counterToAttacker
      }
    }

    if (playerFirst) {
      if (doPlayerStrike) playerStrike()
      if (doBotStrike && playerHp > 0 && botHp > 0) botStrike()
    } else {
      if (doBotStrike) botStrike()
      if (doPlayerStrike && playerHp > 0 && botHp > 0) playerStrike()
    }

    // Переодевание попадает в журнал первым событием раунда: игрок должен
    // видеть, за что он отдал очко хода.
    const swapEvents = swapNotes.map(note => ({
      actor: 'player', action: 'change_weapon', hit: false, dodge: false, block: false,
      crit: false, lucky: false, blockPierced: false,
      rawDamage: 0, finalDamage: 0, counterDamage: 0, logParts: [note],
    }))

    // Применяем сближение (дистанция уменьшается за каждого, кто двигался)
    const moveEvents = [
      ...(playerMoved ? [{ actor: 'player', action: 'move', to: playerPart.position, hit: false, dodge: false, block: false, crit: false, lucky: false, blockPierced: false, rawDamage: 0, finalDamage: 0, counterDamage: 0, logParts: [`Перемещение в (${playerPart.position.x}, ${playerPart.position.y})`] }] : []),
      ...(botMoved ? [{ actor: 'bot', action: 'move', to: botPart.position, hit: false, dodge: false, block: false, crit: false, lucky: false, blockPierced: false, rawDamage: 0, finalDamage: 0, counterDamage: 0, logParts: [`Противник переместился в (${botPart.position.x}, ${botPart.position.y})`] }] : []),
    ]

    playerPart.hpCurrent = playerHp
    botPart.hpCurrent = botHp
    playerPart.isAlive = playerHp > 0
    botPart.isAlive = botHp > 0

    const roundNumber = state.roundNumber

    // Износ оружия — если игрок нанёс хоть один реальный удар
    for (const handWeapon of [leftWeapon, rightWeapon]) {
      if (handWeapon && turns.some(t => t.actor === 'player' && t.r.weaponId === handWeapon.id && t.r.hit && !t.r.dodge && !t.r.block)) {
        await ItemsRepository.updateDurability(handWeapon.id, Math.max(0, handWeapon.durabilityCurrent - 1))
      }
    }
    // Зональный износ брони — ломается то, во что бьют
    await applyZonalArmorWear(equippedArmor, botHitZonesOnPlayer)

    const battleOver = !playerPart.isAlive || !botPart.isAlive || roundNumber >= 30

    const turnRecords = turns.map(t => ({
      battleId, roundNumber,
      actorCharId: t.actor === 'player' ? char.id : null,
      actorBotId:  t.actor === 'bot' ? botPart.botId : null,
      targetCharId: t.actor === 'bot' ? char.id : null,
      targetBotId:  t.actor === 'player' ? botPart.botId : null,
      action: 'ATTACK' as BattleAction,
      weaponId: t.actor === 'player' ? t.r.weaponId : null,
      sourceHand: t.actor === 'player' ? t.r.sourceHand : null,
      zone: t.r.zone,
      blockPierced: t.r.blockPierced,
      hit: t.r.hit, dodge: t.r.dodge, block: t.r.block, crit: t.r.crit,
      rawDamage: t.r.rawDamage, finalDamage: t.r.finalDamage,
      weaponDurLoss: t.actor === 'player' && t.r.hit ? 1 : 0,
      logLine: t.r.logParts.join(', '),
    }))
    const moveRecords = [
      ...(playerMoved ? [{ battleId, roundNumber, actorCharId: char.id, action: 'MOVE' as BattleAction, fromX: playerFrom.x, fromY: playerFrom.y, toX: playerPart.position.x, toY: playerPart.position.y }] : []),
      ...(botMoved ? [{ battleId, roundNumber, actorBotId: botPart.botId, action: 'MOVE' as BattleAction, fromX: botFrom.x, fromY: botFrom.y, toX: botPart.position.x, toY: botPart.position.y }] : []),
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.battleTurn.createMany({ data: [...moveRecords, ...turnRecords] as any })

    if (battleOver) {
      state.status = 'finishing'
      const winnerId = !botPart.isAlive ? char.id : null
      return this._finishPveBattle(battleId, state, char, bot, playerPart, botPart, winnerId, weapon, skillRecord.skillLevel)
    }

    state.roundNumber++
    state.roundDeadline = Date.now() + TURN_TIMEOUT_MS
    playerPart.hasActedThisRound = false
    await BattleRedis.setState(battleId, state)

    return {
      roundNumber,
      botStance: botTurn.stance,
      botAttackZones: botTurn.attackZones,
      botBlockZones: botTurn.blockZones,
      distance: state.distance,
      playerRange,
      turns: [...swapEvents,
      ...moveEvents, ...turns.map(t => ({ actor: t.actor, action: 'attack', ...t.r }))],
      playerHp,
      botHp,
      battleOver: false,
    }
  },

  // -------------------------------------------------------
  // Finish PvE battle
  // -------------------------------------------------------
  async _finishPveBattle(
    battleId: string,
    state: LiveBattleState,
    char: CharacterWithStats,
    bot: Awaited<ReturnType<typeof loadBotData>>,
    playerPart: LiveParticipant,
    botPart: LiveParticipant,
    winnerId: string | null,
    weapon: ItemWithTemplate | null,
    _weaponSkillLevel: number
  ) {
    const playerWon = winnerId === char.id
    const result = playerWon ? 'PVE_WIN' : 'PVE_LOSS'
    const levelDiff = Math.abs(char.battleLevel - bot.battleLevel)

    // Anti-abuse: пометить бой как подозрительный если разница уровней > 10
    // (высокоуровневый фармит слабых ботов)
    if (levelDiff > 10) {
      await prisma.battle.update({
        where: { id: battleId },
        data: { isSuspicious: true, suspicionReason: `level_diff_${levelDiff}` },
      })
    }

    // Anti-farm coefficient (ТЗ раздел 27.3)
    const dailyKills = await AntiFarmRedis.getPveKills(char.id)
    const antiFarmCoeff = AntiFarmRedis.calcPveAntiFarmCoeff(dailyKills)

    // Increment kill counter if won
    if (playerWon) {
      await AntiFarmRedis.incrementPveKills(char.id)
    }

    // Бонус Центра: +10% боевого опыта участникам клана-владельца.
    // Опыт, а не сила — потолок навыка тот же, до него доходят быстрее.
    // Множитель применяется ПОСЛЕ античита, а не вместо него: иначе
    // территория отменяла бы ограничение фарма.
    const battleExpBonus = (await TerritoriesService.bonusesForCharacter(char.id)).BATTLE_EXP ?? 0
    const expGain = Math.round(calcBattleExp(
      playerPart.damageDealt,
      bot.power,
      bot.hpMax,
      levelDiff,
      result,
      antiFarmCoeff   // Apply daily anti-farm
    ) * (1 + battleExpBonus))

    // Премиум ускоряет НАБОР навыка, но не поднимает его потолок:
    // подписчик доходит до той же границы быстрее и там останавливается
    // ровно там же, где все. Это и есть «время, а не сила».
    const skillMultiplier = await PremiumService.skillMultiplier(char.id)
    const weaponExpEntries = weaponExpByType(playerPart, weapon, bot.hpMax, playerWon, levelDiff, skillMultiplier)
    const weaponExpGain = weaponExpEntries.reduce((sum, entry) => sum + entry.exp, 0)

    return withTransaction(async (tx) => {
      // Update character HP, exp, level + stat points for level-up
      const progression = await applyBattleProgression(tx, char, {
        expGain,
        hpCurrentAfterBattle: playerPart.hpCurrent,
        won: playerWon,
      })
      const newLevel = progression.newLevel

      // Money reward
      let moneyReward = 0
      if (playerWon) {
        moneyReward = Math.floor(Math.random() * (bot.moneyRewardMax - bot.moneyRewardMin + 1)) + bot.moneyRewardMin
        if (moneyReward > 0) {
          await EconomyService.credit(tx, {
            characterId: char.id, amount: moneyReward, reasonCode: 'BATTLE_REWARD', refType: 'battle', refId: battleId,
          })
        }
      }

      // Award each weapon family only for damage actually dealt with that hand.
      for (const entry of weaponExpEntries) {
        await saveWeaponSkillExp(tx as typeof prisma, char.id, entry.weaponType, entry.exp)
      }

      // Update battle record
      await tx.battle.update({
        where: { id: battleId },
        data: {
          status: 'FINISHED',
          winnerId,
          winnerParticipantId: playerWon ? playerPart.participantId : botPart.participantId,
          finishedAt: new Date(),
          roundCount: state.roundNumber,
        },
      })

      // Update participants
      await tx.battleParticipant.updateMany({
        where: { battleId, characterId: char.id },
        data: {
          hpCurrent: playerPart.hpCurrent,
          isAlive: playerPart.isAlive,
          damageDealt: playerPart.damageDealt,
          damageReceived: playerPart.damageReceived,
          hitsLanded: playerPart.hitsLanded,
          hitsTaken: playerPart.hitsTaken,
          expGained: expGain,
          moneyGained: moneyReward,
        },
      })

      // Clean Redis state
      await BattleRedis.deleteState(battleId)

      audit('battle.finished', {
        battleId, type: 'PVE_BOT', characterId: char.id,
        result, expGain, weaponExpGain, moneyReward,
      })

      return {
        battleOver: true,
        result,
        expGain,
        weaponExpGain,
        moneyReward,
        newLevel,
        newBattleExp: progression.newExp,
        playerHp: playerPart.hpCurrent,
        rounds: state.roundNumber,
      }
    })
  },

  // -------------------------------------------------------
  // Resolve PvP round (зональная модель, оба игрока сходили)
  // -------------------------------------------------------
  /**
   * Немедленный шаг в PvP. Двигаем одного бойца по актуальной доске,
   * а не по снимку начала раунда: второй игрок к этому моменту мог уже
   * сходить, и его клетка обязана считаться занятой.
   */
  _applyImmediateMove(state: LiveBattleState, part: LiveParticipant, destination: GridPosition) {
    ensureGridState(state)
    const from = { ...part.position }
    const board = positionedParticipants(state)
    const mover = board.find(p => p.participantId === part.participantId)
    if (!mover || !canMoveTo(mover, destination, board)) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Cannot move there', 400)
    }
    part.position = { ...destination }
    syncGridDistance(state)
    return { fromX: from.x, fromY: from.y }
  },

  /**
   * Раунд командного боя. Отличий от дуэли три: бойцов произвольное
   * число, цель у каждого своя, и удары идут по одному в порядке
   * инициативы, а не парой.
   */
  async _resolveRoundTeam(battleId: string, state: LiveBattleState) {
    const teamState = state as unknown as LiveTeamState
    const fighters = state.participants.filter(p => p.characterId)

    // ── Контекст каждого бойца ─────────────────────────────
    const contexts = new Map<string, TeamFighterContext>()
    for (const part of fighters) {
      const char = await CharactersRepository.findById(part.characterId!)
      if (!char?.stats) continue
      const utilityUsed = await applyPendingUtility(part, char)
      const [weaponLeft, weaponRight] = await Promise.all([
        part.leftWeaponInstanceId || part.weaponInstanceId
          ? ItemsRepository.findInstanceById(part.leftWeaponInstanceId ?? part.weaponInstanceId!)
          : Promise.resolve(null),
        part.rightWeaponInstanceId ? ItemsRepository.findInstanceById(part.rightWeaponInstanceId) : Promise.resolve(null),
      ])
      const equipped = await ItemsRepository.findEquipped(char.id)
      const armor = equipped.filter(i => i.template.type === 'ARMOR')
      const skill = await WeaponSkillsRepository.findOrCreate(
        char.id,
        (weaponLeft?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1],
      )
      const weight = armor.reduce((sum, item) => sum + item.weight, 0)
        + (weaponLeft?.weight ?? 0) + (weaponRight?.weight ?? 0)
      contexts.set(part.participantId, {
        part: part as unknown as TeamFighterContext['part'],
        char,
        weaponLeft,
        weaponRight,
        armor,
        initiative: initiativeOf(char, skill.skillLevel, weight),
        turn: turnOfParticipant(part as unknown as TeamFighterContext['part'], utilityUsed),
      })
    }

    // ── Перемещения: все разом, как в дуэли ────────────────
    const before = new Map(fighters.map(p => [p.participantId, { ...p.position }]))
    const moveRequests = [...contexts.values()]
      .filter(ctx => ctx.turn.moveTo)
      .map(ctx => ({ participantId: ctx.part.participantId, destination: ctx.turn.moveTo! }))
    const moved = applyTeamMoves(teamState, moveRequests)
    syncGridDistance(state)

    // ── Удары по одному, в порядке инициативы ──────────────
    const roundTurns: Array<{ actor: LiveParticipant; target: LiveParticipant; r: HandStrikeResult }> = []
    const hitZones = new Map<string, BodyZone[]>()

    for (const ctx of orderByInitiative([...contexts.values()])) {
      const actor = state.participants.find(p => p.participantId === ctx.part.participantId)!
      if (!actor.isAlive || actor.isSurrendered) continue
      if (moved.has(actor.participantId)) continue
      if (ctx.turn.attackZones.length === 0) continue

      const targetLite = pickTeamTarget(
        actor as unknown as TeamFighterContext['part'],
        teamState,
        ctx.turn.targetParticipantId,
      )
      if (!targetLite) continue
      const target = state.participants.find(p => p.participantId === targetLite.participantId)!
      const targetCtx = contexts.get(target.participantId)
      if (!targetCtx) continue

      const board = teamPositioned(teamState)
      const actorCell = board.find(p => p.participantId === actor.participantId)!
      const targetCell = board.find(p => p.participantId === target.participantId)!
      const inRange = ctx.turn.attackHands.every(hand => canAttackTarget(
        actorCell, targetCell, board,
        weaponRangeOf(hand === 'RIGHT_HAND' ? ctx.weaponRight : ctx.weaponLeft),
      ))
      if (!inRange) continue

      const wtLeft = (ctx.weaponLeft?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
      const wtRight = (ctx.weaponRight?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
      const skillLeft = await WeaponSkillsRepository.findOrCreate(ctx.char.id, wtLeft)
      const skillRight = await WeaponSkillsRepository.findOrCreate(ctx.char.id, wtRight)
      const antiLeft = await WeaponSkillsRepository.findOrCreate(targetCtx.char.id, wtLeft)
      const [atkLeft, atkRight] = await Promise.all([
        buildAttackerSnapshotAsync(ctx.char, ctx.weaponLeft, skillLeft.skillLevel, ctx.armor),
        buildAttackerSnapshotAsync(ctx.char, ctx.weaponRight, skillRight.skillLevel, ctx.armor),
      ])
      const defSnap = buildDefenderSnapshot(targetCtx.char, targetCtx.armor, antiLeft.antiSkillLevel, targetCtx.weaponLeft)
      const defArmorList = armorListFromEquipped(targetCtx.armor)

      const res = executeStrikes({
        attackerSnap: atkLeft,
        attackerSnaps: { LEFT_HAND: atkLeft, RIGHT_HAND: atkRight },
        weaponIds: { LEFT_HAND: ctx.weaponLeft?.id ?? null, RIGHT_HAND: ctx.weaponRight?.id ?? null },
        defenderSnap: defSnap,
        defenderSnaps: { LEFT_HAND: defSnap, RIGHT_HAND: defSnap },
        zoneArmorFor: z => armorOfZone(defArmorList, z),
        attackZones: ctx.turn.attackZones,
        attackHands: ctx.turn.attackHands,
        blockedZones: targetCtx.turn.blockZones,
        defenderHp: target.hpCurrent,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) {
          target.hpCurrent = Math.max(0, target.hpCurrent - r.finalDamage)
          actor.hitsLanded++
          target.hitsTaken++
          const zones = hitZones.get(target.participantId) ?? []
          zones.push(r.zone)
          hitZones.set(target.participantId, zones)
          recordWeaponDamage(actor, r.sourceHand === 'RIGHT_HAND' ? ctx.weaponRight : ctx.weaponLeft, r.finalDamage)
        }
        roundTurns.push({ actor, target, r })
      }
      actor.damageDealt += res.damageToDefender
      target.damageReceived += res.damageToDefender
      if (res.counterToAttacker > 0) {
        actor.hpCurrent = Math.max(0, actor.hpCurrent - res.counterToAttacker)
        target.damageDealt += res.counterToAttacker
        actor.damageReceived += res.counterToAttacker
      }
      target.isAlive = target.hpCurrent > 0
      actor.isAlive = actor.hpCurrent > 0
    }

    for (const part of fighters) part.isAlive = part.hpCurrent > 0

    // ── Журнал и износ ─────────────────────────────────────
    const roundNumber = state.roundNumber
    const moveRecords = teamMoveRecords(battleId, roundNumber, moved, before, teamState)
    const turnRecords = roundTurns.map(t => ({
      battleId,
      roundNumber,
      actorCharId: t.actor.characterId ?? null,
      targetCharId: t.target.characterId ?? null,
      action: 'ATTACK' as BattleAction,
      weaponId: t.r.weaponId,
      sourceHand: t.r.sourceHand,
      zone: t.r.zone,
      blockPierced: t.r.blockPierced,
      hit: t.r.hit, dodge: t.r.dodge, block: t.r.block, crit: t.r.crit,
      rawDamage: t.r.rawDamage, finalDamage: t.r.finalDamage,
      logLine: t.r.logParts.join(', '),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.battleTurn.createMany({ data: [...moveRecords, ...turnRecords] as any })
    for (const [participantId, zones] of hitZones) {
      const ctx = contexts.get(participantId)
      if (ctx) await applyZonalArmorWear(ctx.armor, zones)
    }

    // ── Итог ───────────────────────────────────────────────
    const outcome = teamOutcome(teamState)
    if (outcome.over) {
      state.status = 'finishing'
      await BattleRedis.setState(battleId, state)
      const finished = await finishTeamBattle(battleId, teamState, outcome.winnerSide, contexts)
      await BattleRedis.deleteState(battleId)
      return finished
    }

    state.roundNumber++
    state.roundDeadline = Date.now() + TURN_TIMEOUT_MS
    for (const part of state.participants) {
      part.hasActedThisRound = false
      part.pendingAction = undefined
      part.pendingTurn = undefined
    }
    await BattleRedis.setState(battleId, state)

    return {
      roundNumber,
      battleOver: false,
      participants: state.participants.map(p => ({
        participantId: p.participantId,
        characterId: p.characterId,
        side: p.side,
        hpCurrent: p.hpCurrent,
        isAlive: p.isAlive,
        position: p.position,
      })),
      turns: roundTurns.map(t => ({
        actor: t.actor.characterId, target: t.target.characterId, action: 'attack',
        hit: t.r.hit, dodge: t.r.dodge, block: t.r.block, crit: t.r.crit, lucky: t.r.lucky,
        zone: t.r.zone, sourceHand: t.r.sourceHand,
        rawDamage: t.r.rawDamage, finalDamage: t.r.finalDamage, counterDamage: 0,
        logParts: t.r.logParts,
      })),
    }
  },

  async _resolveRoundPvp(battleId: string, state: LiveBattleState) {
    const [part1, part2] = state.participants.filter(p => p.characterId)
    if (!part1 || !part2) {
      logger.error({ battleId }, 'PvP round resolve: cannot find two character participants')
      return { roundNumber: state.roundNumber, waiting: false }
    }

    const [char1, char2] = await Promise.all([
      CharactersRepository.findById(part1.characterId!),
      CharactersRepository.findById(part2.characterId!),
    ])
    if (!char1 || !char2) {
      logger.error({ battleId }, 'PvP round resolve: character not found')
      return { roundNumber: state.roundNumber, waiting: false }
    }

    const applyUtility = applyPendingUtility
    const utility1 = await applyUtility(part1, char1)
    const utility2 = await applyUtility(part2, char2)

    const [weapon1Left, weapon1Right, weapon2Left, weapon2Right] = await Promise.all([
      part1.leftWeaponInstanceId || part1.weaponInstanceId ? ItemsRepository.findInstanceById(part1.leftWeaponInstanceId ?? part1.weaponInstanceId!) : Promise.resolve(null),
      part1.rightWeaponInstanceId ? ItemsRepository.findInstanceById(part1.rightWeaponInstanceId) : Promise.resolve(null),
      part2.leftWeaponInstanceId || part2.weaponInstanceId ? ItemsRepository.findInstanceById(part2.leftWeaponInstanceId ?? part2.weaponInstanceId!) : Promise.resolve(null),
      part2.rightWeaponInstanceId ? ItemsRepository.findInstanceById(part2.rightWeaponInstanceId) : Promise.resolve(null),
    ])
    const weapon1 = weapon1Left
    const weapon2 = weapon2Left

    const [equippedItems1, equippedItems2] = await Promise.all([
      ItemsRepository.findEquipped(char1.id),
      ItemsRepository.findEquipped(char2.id),
    ])
    const armor1 = equippedItems1.filter(i => i.template.type === 'ARMOR')
    const armor2 = equippedItems2.filter(i => i.template.type === 'ARMOR')
    const armorList1 = armorListFromEquipped(armor1)
    const armorList2 = armorListFromEquipped(armor2)

    const wtype1 = (weapon1Left?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const wtype2 = (weapon2Left?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const skill1 = await WeaponSkillsRepository.findOrCreate(char1.id, wtype1)
    const skill1Right = await WeaponSkillsRepository.findOrCreate(char1.id, (weapon1Right?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])
    const skill2 = await WeaponSkillsRepository.findOrCreate(char2.id, wtype2)
    const skill2Right = await WeaponSkillsRepository.findOrCreate(char2.id, (weapon2Right?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])
    const wtype1Right = (weapon1Right?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const wtype2Right = (weapon2Right?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const antiSkill1vs2 = await WeaponSkillsRepository.findOrCreate(char1.id, wtype2)
    const antiSkill1vs2Right = await WeaponSkillsRepository.findOrCreate(char1.id, wtype2Right)
    const antiSkill2vs1 = await WeaponSkillsRepository.findOrCreate(char2.id, wtype1)
    const antiSkill2vs1Right = await WeaponSkillsRepository.findOrCreate(char2.id, wtype1Right)

    const [snap1Atk, snap1RightAtk, snap2Atk, snap2RightAtk] = await Promise.all([
      buildAttackerSnapshotAsync(char1, weapon1Left, skill1.skillLevel, armor1),
      buildAttackerSnapshotAsync(char1, weapon1Right, skill1Right.skillLevel, armor1),
      buildAttackerSnapshotAsync(char2, weapon2Left, skill2.skillLevel, armor2),
      buildAttackerSnapshotAsync(char2, weapon2Right, skill2Right.skillLevel, armor2),
    ])
    const weight1 = armor1.reduce((sum, item) => sum + item.weight, 0) + (weapon1Left?.weight ?? 0) + (weapon1Right?.weight ?? 0)
    const weight2 = armor2.reduce((sum, item) => sum + item.weight, 0) + (weapon2Left?.weight ?? 0) + (weapon2Right?.weight ?? 0)
    snap1Atk.equipmentWeight = weight1; snap1RightAtk.equipmentWeight = weight1
    snap2Atk.equipmentWeight = weight2; snap2RightAtk.equipmentWeight = weight2
    const snap1Def = buildDefenderSnapshot(char1, armor1, antiSkill1vs2.antiSkillLevel, weapon1)
    const snap1DefRight = buildDefenderSnapshot(char1, armor1, antiSkill1vs2Right.antiSkillLevel, weapon1)
    const snap2Def = buildDefenderSnapshot(char2, armor2, antiSkill2vs1.antiSkillLevel, weapon2)
    const snap2DefRight = buildDefenderSnapshot(char2, armor2, antiSkill2vs1Right.antiSkillLevel, weapon2)

    const init1 = calcInitiative(char1.stats!.rea, char1.stats!.agi, skill1.skillLevel, snap1Atk.equipmentWeight)
    const init2 = calcInitiative(char2.stats!.rea, char2.stats!.agi, skill2.skillLevel, snap2Atk.equipmentWeight)

    const turn1 = utility1
      ? normalizeTurn({ stance: 'defense4', attackZones: [], blockZones: [] })
      : part1.pendingTurn ?? legacyActionToTurn(part1.pendingAction ?? 'attack')
    const turn2 = utility2
      ? normalizeTurn({ stance: 'defense4', attackZones: [], blockZones: [] })
      : part2.pendingTurn ?? legacyActionToTurn(part2.pendingAction ?? 'attack')
    try {
      selectEnemyTarget(part1, state.participants, turn1.targetParticipantId)
      selectEnemyTarget(part2, state.participants, turn2.targetParticipantId)
    } catch {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Invalid battle target', 400)
    }

    let hp1 = part1.hpCurrent
    let hp2 = part2.hpCurrent

    type TurnRec = { actorPart: LiveParticipant; defenderPart: LiveParticipant; r: HandStrikeResult }
    const roundTurns: TurnRec[] = []
    const hitZonesOn1: BodyZone[] = []
    const hitZonesOn2: BodyZone[] = []

    const doStrike = (
      atkPart: LiveParticipant, atkSnap: AttackerSnapshot, atkSnaps: Record<AttackHand, AttackerSnapshot>, weaponIds: Record<AttackHand, string | null>, atkTurn: ZonalTurnInput,
      defPart: LiveParticipant, defSnap: DefenderSnapshot, defSnaps: Record<AttackHand, DefenderSnapshot>, defArmorList: EquipArmorLike[], defTurn: ZonalTurnInput
    ) => {
      const defHp = defPart === part1 ? hp1 : hp2
      const res = executeStrikes({
        attackerSnap: atkSnap, attackerSnaps: atkSnaps, weaponIds, defenderSnap: defSnap, defenderSnaps: defSnaps,
        zoneArmorFor: (z) => armorOfZone(defArmorList, z),
        attackZones: atkTurn.attackZones,
        attackHands: atkTurn.attackHands,
        blockedZones: defTurn.blockZones,
        defenderHp: defHp,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) {
          if (defPart === part1) { hp1 = Math.max(0, hp1 - r.finalDamage); hitZonesOn1.push(r.zone) }
          else { hp2 = Math.max(0, hp2 - r.finalDamage); hitZonesOn2.push(r.zone) }
          atkPart.hitsLanded++; defPart.hitsTaken++
          const strikeWeapon = r.sourceHand === 'RIGHT_HAND'
            ? (atkPart === part1 ? weapon1Right : weapon2Right)
            : (atkPart === part1 ? weapon1Left : weapon2Left)
          recordWeaponDamage(atkPart, strikeWeapon, r.finalDamage)
        }
        roundTurns.push({ actorPart: atkPart, defenderPart: defPart, r })
      }
      atkPart.damageDealt += res.damageToDefender
      defPart.damageReceived += res.damageToDefender
      if (res.counterToAttacker > 0) {   // защитник заблокировал и дал ответку
        if (atkPart === part1) hp1 = Math.max(0, hp1 - res.counterToAttacker)
        else hp2 = Math.max(0, hp2 - res.counterToAttacker)
        defPart.damageDealt += res.counterToAttacker
        atkPart.damageReceived += res.counterToAttacker
      }
    }

    const p1First = init1 >= init2

    // ── Движение / дистанция ──────────────────────────────
    const from1 = { ...part1.position }
    const from2 = { ...part2.position }
    const [moved1, moved2] = applySimultaneousDuelMoves(
      state,
      part1,
      turn1.moveTo,
      part2,
      turn2.moveTo,
    )
    syncGridDistance(state)
    const projected = positionedParticipants(state)
    const gridPart1 = projected.find(p => p.participantId === part1.participantId)!
    const gridPart2 = projected.find(p => p.participantId === part2.participantId)!
    const doStrike1 = !moved1 && turn1.attackZones.length > 0
      && turn1.attackHands.every(hand => canAttackTarget(gridPart1, gridPart2, projected, weaponRangeOf(hand === 'RIGHT_HAND' ? weapon1Right : weapon1Left)))
    const doStrike2 = !moved2 && turn2.attackZones.length > 0
      && turn2.attackHands.every(hand => canAttackTarget(gridPart2, gridPart1, projected, weaponRangeOf(hand === 'RIGHT_HAND' ? weapon2Right : weapon2Left)))

    if (p1First) {
      if (doStrike1) doStrike(part1, snap1Atk, { LEFT_HAND: snap1Atk, RIGHT_HAND: snap1RightAtk }, { LEFT_HAND: weapon1Left?.id ?? null, RIGHT_HAND: weapon1Right?.id ?? null }, turn1, part2, snap2Def, { LEFT_HAND: snap2Def, RIGHT_HAND: snap2DefRight }, armorList2, turn2)
      if (doStrike2 && hp1 > 0 && hp2 > 0) doStrike(part2, snap2Atk, { LEFT_HAND: snap2Atk, RIGHT_HAND: snap2RightAtk }, { LEFT_HAND: weapon2Left?.id ?? null, RIGHT_HAND: weapon2Right?.id ?? null }, turn2, part1, snap1Def, { LEFT_HAND: snap1Def, RIGHT_HAND: snap1DefRight }, armorList1, turn1)
    } else {
      if (doStrike2) doStrike(part2, snap2Atk, { LEFT_HAND: snap2Atk, RIGHT_HAND: snap2RightAtk }, { LEFT_HAND: weapon2Left?.id ?? null, RIGHT_HAND: weapon2Right?.id ?? null }, turn2, part1, snap1Def, { LEFT_HAND: snap1Def, RIGHT_HAND: snap1DefRight }, armorList1, turn1)
      if (doStrike1 && hp1 > 0 && hp2 > 0) doStrike(part1, snap1Atk, { LEFT_HAND: snap1Atk, RIGHT_HAND: snap1RightAtk }, { LEFT_HAND: weapon1Left?.id ?? null, RIGHT_HAND: weapon1Right?.id ?? null }, turn1, part2, snap2Def, { LEFT_HAND: snap2Def, RIGHT_HAND: snap2DefRight }, armorList2, turn2)
    }

    const moveEvents = [
      ...(moved1 ? [{ actor: part1.characterId, action: 'move', from: null, to: part1.position, hit: false, dodge: false, block: false, crit: false, lucky: false, blockPierced: false, rawDamage: 0, finalDamage: 0, counterDamage: 0, logParts: [`Перемещение в (${part1.position.x}, ${part1.position.y})`] }] : []),
      ...(moved2 ? [{ actor: part2.characterId, action: 'move', from: null, to: part2.position, hit: false, dodge: false, block: false, crit: false, lucky: false, blockPierced: false, rawDamage: 0, finalDamage: 0, counterDamage: 0, logParts: [`Перемещение в (${part2.position.x}, ${part2.position.y})`] }] : []),
    ]

    part1.hpCurrent = hp1
    part2.hpCurrent = hp2
    part1.isAlive = hp1 > 0
    part2.isAlive = hp2 > 0

    const roundNumber = state.roundNumber

    // Износ оружия
    for (const handWeapon of [weapon1Left, weapon1Right, weapon2Left, weapon2Right]) {
      if (handWeapon && roundTurns.some(t => t.r.weaponId === handWeapon.id && t.r.hit && !t.r.dodge && !t.r.block)) {
        await ItemsRepository.updateDurability(handWeapon.id, Math.max(0, handWeapon.durabilityCurrent - 1))
      }
    }
    // Зональный износ брони — ломается то, во что бьют
    await applyZonalArmorWear(armor1, hitZonesOn1)
    await applyZonalArmorWear(armor2, hitZonesOn2)

    const turnRecords = roundTurns.map(t => ({
      battleId, roundNumber,
      actorCharId: t.actorPart.characterId ?? null,
      targetCharId: t.defenderPart.characterId ?? null,
      action: 'ATTACK' as BattleAction,
      weaponId: t.r.weaponId,
      sourceHand: t.r.sourceHand,
      zone: t.r.zone,
      blockPierced: t.r.blockPierced,
      hit: t.r.hit, dodge: t.r.dodge, block: t.r.block, crit: t.r.crit,
      rawDamage: t.r.rawDamage, finalDamage: t.r.finalDamage,
      logLine: t.r.logParts.join(', '),
    }))
    const moveRecords = [
      ...(moved1 ? [{ battleId, roundNumber, actorCharId: part1.characterId, action: 'MOVE' as BattleAction, fromX: from1.x, fromY: from1.y, toX: part1.position.x, toY: part1.position.y }] : []),
      ...(moved2 ? [{ battleId, roundNumber, actorCharId: part2.characterId, action: 'MOVE' as BattleAction, fromX: from2.x, fromY: from2.y, toX: part2.position.x, toY: part2.position.y }] : []),
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.battleTurn.createMany({ data: [...moveRecords, ...turnRecords] as any })

    const p1Dead = !part1.isAlive
    const p2Dead = !part2.isAlive
    const battleOver = p1Dead || p2Dead || roundNumber >= 30

    if (battleOver) {
      state.status = 'finishing'
      const winnerId = p2Dead && !p1Dead ? char1.id : p1Dead && !p2Dead ? char2.id : null
      await BattleRedis.setState(battleId, state)
      return this._finishPvpBattle(battleId, state, char1, char2, part1, part2, winnerId, weapon1, weapon2, skill1.skillLevel, skill2.skillLevel)
    }

    state.roundNumber++
    state.roundDeadline = Date.now() + TURN_TIMEOUT_MS
    part1.hasActedThisRound = false
    part2.hasActedThisRound = false
    part1.pendingAction = undefined
    part2.pendingAction = undefined
    part1.pendingTurn = undefined
    part2.pendingTurn = undefined
    await BattleRedis.setState(battleId, state)

    return {
      roundNumber,
      distance: state.distance,
      turns: [
      ...moveEvents, ...roundTurns.map(t => ({ actor: t.actorPart.characterId, action: 'attack', ...t.r }))],
      player1Hp: hp1,
      player2Hp: hp2,
      battleOver: false,
    }
  },

  // -------------------------------------------------------
  // Finish PvP battle
  // -------------------------------------------------------
  async _finishPvpBattle(
    battleId: string,
    state: LiveBattleState,
    char1: CharacterWithStats,
    char2: CharacterWithStats,
    part1: LiveParticipant,
    part2: LiveParticipant,
    winnerId: string | null,
    weapon1: ItemWithTemplate | null,
    weapon2: ItemWithTemplate | null,
    _skill1Level: number,
    _skill2Level: number
  ) {
    const levelDiff = Math.abs(char1.battleLevel - char2.battleLevel)

    const result1 = winnerId === char1.id ? 'PVP_WIN' : winnerId === char2.id ? 'PVP_LOSS' : 'DRAW'
    const result2 = winnerId === char2.id ? 'PVP_WIN' : winnerId === char1.id ? 'PVP_LOSS' : 'DRAW'

    const exp1 = calcBattleExp(part1.damageDealt, char2.battleLevel * 5, char2.hpMax, levelDiff, result1 as 'PVP_WIN' | 'PVP_LOSS' | 'DRAW')
    const exp2 = calcBattleExp(part2.damageDealt, char1.battleLevel * 5, char1.hpMax, levelDiff, result2 as 'PVP_WIN' | 'PVP_LOSS' | 'DRAW')

    const wskEntries1 = weaponExpByType(part1, weapon1, char2.hpMax, winnerId === char1.id, levelDiff)
    const wskEntries2 = weaponExpByType(part2, weapon2, char1.hpMax, winnerId === char2.id, levelDiff)
    const wskExp1 = wskEntries1.reduce((sum, entry) => sum + entry.exp, 0)
    const wskExp2 = wskEntries2.reduce((sum, entry) => sum + entry.exp, 0)

    return withTransaction(async (tx) => {
      const progression1 = await applyBattleProgression(tx, char1, {
        expGain: exp1,
        hpCurrentAfterBattle: part1.hpCurrent,
        won: winnerId === char1.id,
      })

      const progression2 = await applyBattleProgression(tx, char2, {
        expGain: exp2,
        hpCurrentAfterBattle: part2.hpCurrent,
        won: winnerId === char2.id,
      })

      // Weapon skill exp follows the hand and weapon family that produced damage.
      for (const entry of wskEntries1) await saveWeaponSkillExp(tx as typeof prisma, char1.id, entry.weaponType, entry.exp)
      for (const entry of wskEntries2) await saveWeaponSkillExp(tx as typeof prisma, char2.id, entry.weaponType, entry.exp)

      // Update battle
      await tx.battle.update({
        where: { id: battleId },
        data: {
          status: 'FINISHED',
          winnerId,
          winnerParticipantId:
            winnerId === char1.id ? part1.participantId :
            winnerId === char2.id ? part2.participantId : null,
          finishedAt: new Date(),
          roundCount: state.roundNumber,
        },
      })

      // Update participants
      for (const [part, char] of [[part1, char1], [part2, char2]] as const) {
        await tx.battleParticipant.updateMany({
          where: { battleId, characterId: char.id },
          data: {
            hpCurrent: part.hpCurrent, isAlive: part.isAlive,
            damageDealt: part.damageDealt, damageReceived: part.damageReceived,
            hitsLanded: part.hitsLanded, hitsTaken: part.hitsTaken,
            expGained: char.id === char1.id ? exp1 : exp2,
            moneyGained: 0,
          },
        })
      }

      // Anti-abuse: пометить бой как подозрительный если один из игроков
      // нанёс 0 урона (возможно договорной бой)
      const isSuspicious = part1.damageDealt === 0 || part2.damageDealt === 0
      if (isSuspicious) {
        await tx.battle.update({
          where: { id: battleId },
          data: { isSuspicious: true, suspicionReason: 'zero_damage_participant' },
        })
      }

      await BattleRedis.deleteState(battleId)

      audit('battle.finished', {
        battleId, type: 'PVP_DUEL', winnerId,
        char1: { id: char1.id, exp: exp1, wskExp: wskExp1 },
        char2: { id: char2.id, exp: exp2, wskExp: wskExp2 },
      })

      return {
        battleOver: true,
        winnerId,
        char1: { expGain: exp1, weaponExpGain: wskExp1, newLevel: progression1.newLevel, hp: Math.max(1, part1.hpCurrent) },
        char2: { expGain: exp2, weaponExpGain: wskExp2, newLevel: progression2.newLevel, hp: Math.max(1, part2.hpCurrent) },
        rounds: state.roundNumber,
      }
    })
  },

  async _finishBattle(battleId: string, state: LiveBattleState, winnerId: string | null) {
    // Update battle status
    await prisma.battle.update({
      where: { id: battleId },
      data: { status: 'FINISHED', winnerId, finishedAt: new Date(), roundCount: state.roundNumber },
    })

    // CRITICAL FIX: unlock ALL character participants back to ACTIVE
    // Without this, characters stay IN_BATTLE forever after surrender/disconnect
    const characterIds = state.participants
      .filter(p => p.characterId)
      .map(p => p.characterId!)
    if (characterIds.length > 0) {
      await prisma.character.updateMany({
        where: { id: { in: characterIds } },
        data: { status: 'ACTIVE' },
      })
    }

    await BattleRedis.deleteState(battleId)
    return { battleOver: true, winnerId }
  },

  // -------------------------------------------------------
  // List open PvP duels
  // -------------------------------------------------------
  async listOpenDuels(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    const charLevel = char?.battleLevel ?? 1

    const battles = await prisma.battle.findMany({
      where: {
        type: 'PVP_DUEL',
        status: 'WAITING_PLAYERS',
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) }, // не старше 30 мин
      },
      include: {
        participants: {
          include: { character: { select: { nickname: true, battleLevel: true, archetype: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return battles.map(b => {
      const creator = b.participants[0]
      return {
        battleId: b.id,
        levelMin: b.levelMin,
        levelMax: b.levelMax,
        createdAt: b.createdAt,
        creator: creator?.character
          ? { nickname: creator.character.nickname, level: creator.character.battleLevel, archetype: creator.character.archetype }
          : null,
        canJoin: charLevel >= b.levelMin && charLevel <= b.levelMax && char?.status === 'ACTIVE',
      }
    })
  },

  // -------------------------------------------------------
  // Battle history
  // -------------------------------------------------------
  async getBattleHistory(userId: string, page: number, limit: number) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

    const skip = (page - 1) * limit

    const [battles, total] = await Promise.all([
      prisma.battle.findMany({
        where: {
          status: 'FINISHED',
          participants: { some: { characterId: char.id } },
        },
        include: {
          participants: {
            include: {
              character: { select: { nickname: true, battleLevel: true } },
              bot: { select: { name: true, battleLevel: true } },
            },
          },
        },
        orderBy: { finishedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.battle.count({
        where: {
          status: 'FINISHED',
          participants: { some: { characterId: char.id } },
        },
      }),
    ])

    const items = battles.map(b => {
      const myPart = b.participants.find(p => p.characterId === char.id)
      const oppPart = b.participants.find(p => p.characterId !== char.id || p.botId)
      const won = b.winnerParticipantId === myPart?.id
      const result = b.winnerParticipantId === null ? 'draw' : won ? 'win' : 'lose'
      const opponent = oppPart?.character?.nickname ?? oppPart?.bot?.name ?? '?'
      const opponentLevel = oppPart?.character?.battleLevel ?? oppPart?.bot?.battleLevel ?? 0
      return {
        id: b.id,
        type: b.type,
        result,
        opponent,
        opponentLevel,
        expGain: myPart?.expGained ?? 0, // expGain хранится в Character.battleExp, не в BattleParticipant
        moneyGain: myPart?.moneyGained ?? 0,
        rounds: b.roundCount,
        finishedAt: b.finishedAt,
      }
    })

    return { items, total, page, limit, pages: Math.ceil(total / limit) }
  },
}
