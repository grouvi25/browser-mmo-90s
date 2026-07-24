import type { BattleAction, WeaponType as PrismaWeaponType } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { BattleRedis, AntiFarmRedis } from '../../shared/db/redis'
import { BalanceConfig } from '../../config/balance.config'
import { CharactersRepository } from '../characters/characters.repository'
import { ItemsRepository } from '../items/item-instance.repository'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import {
  resolveZonalAttack,
  calcInitiative,
  type AttackerSnapshot,
  type DefenderSnapshot,
  type ZonalAttackResult,
} from './battle.formulas'
import {
  armorOfZone,
  legacyActionToTurn,
  normalizeTurn,
  botChooseTurn,
  type ZonalTurnInput,
  type EquipArmorLike,
} from './zones'
import type { BodyZone } from '@prisma/client'
import {
  BATTLE_GRID,
  canAttackTarget,
  canMoveTo,
  gridDistance,
  isAdjacentStep,
  isInsideGrid,
  samePosition,
  stepAway,
  stepToward,
  type GridPosition,
  type PositionedParticipant,
} from './grid'
import {
  calcBattleExp,
  calcWeaponSkillExp,
  getLevelFromExp,
  calcHpMax,
  calcArmorDurabilityLoss,
  getWeaponSkillLevelFromExp,
  calcCharacterPower,
} from '../stats/stats.formulas'
import type { CharacterWithStats } from '../characters/characters.repository'
import type { ItemWithTemplate } from '../items/item-instance.repository'

// ── Таймер хода: 7 секунд, потом авто-блок ─────────────────────
const TURN_TIMEOUT_MS = 7_000

// ── Поле боя (движение/дистанция) ──────────────────────────────
const START_DISTANCE = 4   // стартовая дистанция между бойцами (клеток)
const MIN_GAP = 1          // ближний бой = соседние клетки (дистанция 1)
// Радиус оружия: у ближнего = 1, у дальнего — из шаблона (maxRange)
function weaponRangeOf(weapon: ItemWithTemplate | null | undefined): number {
  return Math.max(1, weapon?.template.maxRange ?? 1)
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
  pendingAction?: string   // 'attack' | 'block' | 'surrender' | 'change_weapon:{id}' | 'use_item:{id}'
  pendingTurn?: ZonalTurnInput   // зональный ход (стойка + зоны атаки/блока)
  weaponInstanceId?: string
  damageDealt: number
  damageReceived: number
  hitsTaken: number
  hitsLanded: number
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
      y: Math.min(BATTLE_GRID.height - 1, 2 + Math.ceil(offset / 2) * (offset % 2 === 0 ? 1 : -1)),
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
    { actor: first, target: firstTarget },
    ...(second ? [{ actor: second, target: secondTarget }] : []),
  ].filter((request): request is { actor: LiveParticipant; target: GridPosition } => Boolean(request.target))

  for (const { actor, target } of requests) {
    if (!isInsideGrid(target) || !isAdjacentStep(actor.position, target)) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Invalid destination cell', 400)
    }
  }
  if (requests.length === 2 && samePosition(requests[0].target, requests[1].target)) {
    throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Both fighters cannot occupy the same cell', 400)
  }
  for (const { actor, target } of requests) {
    const blocker = state.participants.find(p => p.isAlive && p.participantId !== actor.participantId && samePosition(p.position, target))
    const blockerMovesAway = blocker && requests.some(r => r.actor.participantId === blocker.participantId && !samePosition(r.target, blocker.position))
    if (blocker && !blockerMovesAway) {
      throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Destination cell is occupied', 400)
    }
  }
  for (const request of requests) request.actor.position = { ...request.target }
  return [Boolean(firstTarget), Boolean(secondTarget)]
}

function syncGridDistance(state: LiveBattleState): number {
  ensureGridState(state)
  const alive = state.participants.filter(p => p.isAlive)
  const distance = alive.length >= 2 ? gridDistance(alive[0].position, alive[1].position) : 0
  state.distance = distance
  return distance
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
  // Sum weight of all equipped items (weapon + armor)
  const equipmentWeight =
    (weapon?.weight ?? 0) +
    equippedArmor.reduce((sum, a) => sum + a.weight, 0)

  return {
    str: s.str, acc: s.acc, agi: s.agi, rea: s.rea, luck: s.luck, agr: s.agr, end: s.end,
    weaponSkillLevel,
    minDamage: t?.minDamage ?? 2,
    maxDamage: t?.maxDamage ?? 6,
    weaponAccuracy: t?.weaponAccuracy ?? 0.7,
    critBonus: t?.critBonus ?? 0,
    critDamageBonus: t?.critDamageBonus ?? 0,
    blockPierce: t?.blockPierce ?? 0,
    flatDamageBonus: 0,
    equipmentWeight,   // Real equipment weight for initiative calc
    antiDodgeBonus: 0,    // TODO: load from item modifiers when upgrade system is implemented
    antiCounterBonus: 0,  // TODO: load from item modifiers
  }
}

function buildDefenderSnapshot(
  char: CharacterWithStats,
  equippedArmor: ItemWithTemplate[],
  antiSkillLevel = 0,
  equippedWeapon?: ItemWithTemplate | null  // нужен для ответки
): DefenderSnapshot {
  const s = char.stats!
  const totalArmor   = equippedArmor.reduce((sum, a) => sum + (a.template.armor ?? 0), 0)
  const antiCrit     = equippedArmor.reduce((sum, a) => sum + (a.template.antiCrit ?? 0), 0)
  const blockBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.blockBonus ?? 0), 0)
  const dodgeBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.dodgeBonus ?? 0), 0)
  const armorWeight  = equippedArmor.reduce((sum, a) => sum + a.weight, 0)
  // Базовый урон для ответки (оружие защитника или кулаки)
  const wMin = equippedWeapon?.template.minDamage ?? 2
  const wMax = equippedWeapon?.template.maxDamage ?? 5
  return {
    agi: s.agi, rea: s.rea, end: s.end, luck: s.luck,
    armor: totalArmor, dodgeBonus, antiCrit, blockBonus, armorWeight,
    antiSkillLevel,
    antiCounterDefense: 0,
    minDamage: wMin, maxDamage: wMax,
  }
}

// ---------------------------------------------------------------
// Zonal helpers
// ---------------------------------------------------------------
// Преобразуем экипированную броню в форму для расчёта брони по зоне.
function armorListFromEquipped(equippedArmor: ItemWithTemplate[]): EquipArmorLike[] {
  return equippedArmor.map(it => ({
    armor: it.template.armor ?? 0,
    slot: it.armorSlot ?? it.template.armorSlot ?? null,
  }))
}

// Обмен ударами: attacker бьёт по своим зонам, defender блокирует свои зоны.
// Возвращает результаты ударов, суммарный урон защитнику и суммарную ответку атакующему.
function executeStrikes(params: {
  attackerSnap: AttackerSnapshot
  defenderSnap: DefenderSnapshot
  zoneArmorFor: (zone: BodyZone) => number
  attackZones: BodyZone[]
  blockedZones: BodyZone[]
  defenderHp: number   // текущее HP защитника — прекращаем бить, если умер
}): { results: ZonalAttackResult[]; damageToDefender: number; counterToAttacker: number } {
  const results: ZonalAttackResult[] = []
  let damageToDefender = 0
  let counterToAttacker = 0
  let hpLeft = params.defenderHp

  for (const zone of params.attackZones) {
    if (hpLeft <= 0) break
    const zoneArmor = params.zoneArmorFor(zone)
    const r = resolveZonalAttack(params.attackerSnap, params.defenderSnap, {
      zone,
      blockedZones: params.blockedZones,
      zoneArmor,
    })
    if (r.hit && !r.dodge && !r.block) {
      damageToDefender += r.finalDamage
      hpLeft = Math.max(0, hpLeft - r.finalDamage)
    }
    if (r.counterDamage > 0) counterToAttacker += r.counterDamage
    results.push(r)
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
    antiCounterDefense: 0,
    minDamage: botStats.minDamage ?? 3, maxDamage: botStats.maxDamage ?? 8,
  }
}

// ---------------------------------------------------------------
// Save weapon skill exp to DB (shared helper)
// After WSK=20, overflow exp builds antiSkillLevel (WRES)
// ---------------------------------------------------------------
async function saveWeaponSkillExp(
  tx: typeof prisma,
  characterId: string,
  weaponType: string,
  weaponExpGain: number
): Promise<void> {
  if (weaponExpGain <= 0) return
  const existing = await tx.weaponSkill.findUnique({
    where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
  })
  const base = existing ?? { skillLevel: 1, skillExp: 0, antiSkillLevel: 0, antiSkillExp: 0 }

  const MAX_WSK = 20
  if (base.skillLevel < MAX_WSK) {
    // Normal WSK progression
    const newWskExp = base.skillExp + weaponExpGain
    const newWskLevel = getWeaponSkillLevelFromExp(newWskExp)
    if (existing) {
      await tx.weaponSkill.update({
        where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
        data: { skillExp: newWskExp, skillLevel: newWskLevel },
      })
    } else {
      await tx.weaponSkill.create({
        data: { characterId, weaponType: weaponType as PrismaWeaponType, skillExp: newWskExp, skillLevel: newWskLevel },
      })
    }
  } else {
    // WSK=20 reached → overflow exp goes to antiSkillLevel (WRES)
    // antiSkill thresholds: each level requires the same table but offset
    // 20/1=1 antiSkill point, 20/2=2, etc. (simplified: 100 exp per anti-skill level)
    const ANTI_EXP_PER_LEVEL = 500
    const MAX_ANTI_LEVEL = 10
    const newAntiExp = (base.antiSkillExp ?? 0) + weaponExpGain * 0.5 // 50% overflow to anti-skill
    const newAntiLevel = Math.min(MAX_ANTI_LEVEL, Math.floor(newAntiExp / ANTI_EXP_PER_LEVEL))
    if (existing) {
      await tx.weaponSkill.update({
        where: { characterId_weaponType: { characterId, weaponType: weaponType as PrismaWeaponType } },
        data: { antiSkillExp: newAntiExp, antiSkillLevel: newAntiLevel },
      })
    } else {
      await tx.weaponSkill.create({
        data: { characterId, weaponType: weaponType as PrismaWeaponType, skillExp: base.skillExp, skillLevel: MAX_WSK, antiSkillExp: newAntiExp, antiSkillLevel: newAntiLevel },
      })
    }
  }
}

// ---------------------------------------------------------------
// BattleService
// ---------------------------------------------------------------
export const BattleService = {
  // -------------------------------------------------------
  // Start PvE
  // -------------------------------------------------------
  async startPve(userId: string, botCode: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    if (!char.stats) throw AppError.internal('Character stats missing')
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)

    const bot = await prisma.bot.findUnique({ where: { code: botCode, isActive: true } })
    if (!bot) throw AppError.notFound('Bot', botCode)

    const weapon = await ItemsRepository.findEquippedWeapon(char.id)

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

      // Init Redis battle state
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
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: { x: 1, y: 2 },
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
            position: { x: 7, y: 2 },
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
  // Accept PvP Duel
  // -------------------------------------------------------
  async acceptPvpDuel(userId: string, battleId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
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

    const weapon = await ItemsRepository.findEquippedWeapon(char.id)
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
      const oppWeapon = opponentChar ? await ItemsRepository.findEquippedWeapon(opponentChar.id) : null

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
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: { x: 1, y: 2 },
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
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
            skippedTurns: 0,
            position: { x: 7, y: 2 },
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
    return { battle, liveState }
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
      stance?: string
      attackZones?: string[]
      blockZones?: string[]
      moveTo?: GridPosition
      targetParticipantId?: string
    } | string,
    legacyTargetItemId?: string
  ) {
    // Обратная совместимость: поддерживаем и старую сигнатуру (action, itemId), и новый payload
    const payload = typeof input === 'string'
      ? { action: input, itemInstanceId: legacyTargetItemId }
      : input
    const action = payload.action
    const targetItemId = payload.itemInstanceId

    const lockToken = await BattleRedis.acquireLock(battleId, 5000)
    if (!lockToken) throw new AppError(ErrorCode.BATTLE_LOCK_FAILED, 'Battle is processing, retry', 409)

    try {
      const state = await BattleRedis.getState<LiveBattleState>(battleId)
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
        await BattleRedis.setState(battleId, state)
        return this._finishBattle(battleId, state, null)
      }

      // ── Смена оружия ─────────────────────────────────────
      if (action === 'change_weapon') {
        if (!targetItemId) throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'No weapon specified', 400)
        const newWeapon = await ItemsRepository.findInstanceById(targetItemId)
        if (!newWeapon || newWeapon.ownerId !== char.id)
          throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your weapon', 403)
        if (newWeapon.status === 'BROKEN')
          throw new AppError(ErrorCode.ITEM_BROKEN, 'Weapon is broken', 400)
        if (newWeapon.template.type !== 'WEAPON')
          throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Not a weapon', 400)

        // Equip new weapon, unequip old
        if (playerPart.weaponInstanceId && playerPart.weaponInstanceId !== targetItemId) {
          await ItemsRepository.unequip(playerPart.weaponInstanceId)
        }
        await ItemsRepository.equip(targetItemId, null)
        playerPart.weaponInstanceId = targetItemId
        state.roundNumber++
      state.roundDeadline = Date.now() + TURN_TIMEOUT_MS

        await prisma.battleTurn.create({
          data: {
            battleId, roundNumber: state.roundNumber - 1,
            actorCharId: char.id, action: 'CHANGE_WEAPON' as BattleAction,
            weaponId: targetItemId,
            hit: false, dodge: false, block: false, crit: false,
            rawDamage: 0, finalDamage: 0,
            logLine: `Сменил оружие на: ${newWeapon.template.name}`,
          },
        })

        await BattleRedis.setState(battleId, state)
        return {
          roundNumber: state.roundNumber - 1,
          weaponChanged: true,
          newWeaponName: newWeapon.template.name,
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
            blockZones: (payload.blockZones ?? []) as BodyZone[],
            moveTo: payload.moveTo,
            targetParticipantId: payload.targetParticipantId,
          })
        : legacyActionToTurn(action)

      // ── PvE: авторазрешение раунда ─────────────────────
      if (state.type === 'PVE_BOT') {
        return this._resolveRoundPve(battleId, state, char, turn)
      }

      // ── PvP: сохраняем ход, ждём противника ────────────
      playerPart.pendingAction = action
      playerPart.pendingTurn = turn
      playerPart.hasActedThisRound = true
      await BattleRedis.setState(battleId, state)

      const allActed = state.participants.every(p => !p.isAlive || p.isSurrendered || p.hasActedThisRound)
      if (allActed) {
        return this._resolveRoundPvp(battleId, state)
      }
      return { waiting: true, roundNumber: state.roundNumber }

    } finally {
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
      const distance = state.distance ?? START_DISTANCE
      const botWantsAttack = botTurn.attackZones.length > 0
      const botInRange = distance <= 1  // боты — ближний бой
      const botMoving = botWantsAttack && !botInRange
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
        state.distance = Math.max(MIN_GAP, distance - 1)
        clientTurns.push({
          actor: 'enemy', action: 'move',
          hit: false, dodge: false, block: false, crit: false, lucky: false,
          rawDamage: 0, finalDamage: 0, counterDamage: 0,
          logParts: [`Противник сближается (дистанция ${state.distance})`],
        })
      }

      playerPart.isAlive = playerPart.hpCurrent > 0

      // DB-записи по зональным ударам бота
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
    const botPart = state.participants.find(p => p.botId)!
    const bot = await loadBotData(botPart.botId!)
    const botStats = bot.stats as Record<string, number>
    const botEquip = bot.equipment as Record<string, unknown>

    const weapon = playerPart.weaponInstanceId
      ? await ItemsRepository.findInstanceById(playerPart.weaponInstanceId)
      : null
    const weaponType = (weapon?.template.weaponType ?? 'MELEE') as string
    const skillRecord = await WeaponSkillsRepository.findOrCreate(char.id, weaponType as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])

    const equippedItems = await ItemsRepository.findEquipped(char.id)
    const equippedArmor = equippedItems.filter(i => i.template.type === 'ARMOR')
    const playerArmorList = armorListFromEquipped(equippedArmor)

    const attackerSnap = await buildAttackerSnapshotAsync(char, weapon, skillRecord.skillLevel, equippedArmor)
    const defenderSnap = buildBotDefenderSnapshot(botStats)   // бот как защитник
    const botAttackSnap = buildBotAttackerSnapshot(botStats, botEquip)
    const playerDefSnap = buildDefenderSnapshot(char, equippedArmor)

    // Бот выбирает свою стойку и зоны
    const botTurn = botChooseTurn()
    const botZoneArmor = defenderSnap.armor   // у бота равномерная броня по зонам

    // ── Движение / дистанция ──────────────────────────────
    const playerRange = weaponRangeOf(weapon)
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

    const distance = syncGridDistance(state)
    const playerWantsAttack = !playerMoved && playerTurn.attackZones.length > 0
    const doPlayerStrike = playerWantsAttack && canAttackTarget(gridPlayer, gridBot, projected, playerRange)
    const doBotStrike = !botMoved && botWantsAttack && canAttackTarget(gridBot, gridPlayer, projected, botRange)

    const playerInit = calcInitiative(char.stats!.rea, char.stats!.agi, skillRecord.skillLevel, attackerSnap.equipmentWeight)
    const botInit    = calcInitiative(botStats.rea ?? 2, botStats.agi ?? 2, 1, 0)
    const playerFirst = playerInit >= botInit

    let playerHp = playerPart.hpCurrent
    let botHp = botPart.hpCurrent

    type TurnRec = { actor: 'player' | 'bot'; r: ZonalAttackResult }
    const turns: TurnRec[] = []
    const botHitZonesOnPlayer: BodyZone[] = []

    const playerStrike = () => {
      const res = executeStrikes({
        attackerSnap, defenderSnap,
        zoneArmorFor: () => botZoneArmor,
        attackZones: playerTurn.attackZones,
        blockedZones: botTurn.blockZones,
        defenderHp: botHp,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) { botHp = Math.max(0, botHp - r.finalDamage); playerPart.hitsLanded++; botPart.hitsTaken++ }
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
    if (weapon && turns.some(t => t.actor === 'player' && t.r.hit && !t.r.dodge && !t.r.block)) {
      await ItemsRepository.updateDurability(weapon.id, Math.max(0, weapon.durabilityCurrent - 1))
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
      weaponId: t.actor === 'player' ? weapon?.id ?? null : null,
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
      turns: [...moveEvents, ...turns.map(t => ({ actor: t.actor, action: 'attack', ...t.r }))],
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
    weaponSkillLevel: number
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

    const expGain = calcBattleExp(
      playerPart.damageDealt,
      bot.power,
      bot.hpMax,
      levelDiff,
      result,
      antiFarmCoeff   // Apply daily anti-farm
    )

    const weaponExpGain = calcWeaponSkillExp(
      playerPart.damageDealt,
      bot.hpMax,
      playerWon ? 1 : 0,
      levelDiff
    )

    return withTransaction(async (tx) => {
      // Update character HP, exp, level + stat points for level-up
      const newBattleExp = char.battleExp + expGain
      const newLevel = getLevelFromExp(newBattleExp)
      const newHpMax = calcHpMax(char.stats!.end, newLevel)
      const newHpCurrent = Math.max(1, playerPart.hpCurrent)
      const levelsGained = newLevel - char.battleLevel
      // statPointsPerLevel is stored in battleExp config
      const statPointsGain = levelsGained * 1  // 1 point per level

      await tx.character.update({
        where: { id: char.id },
        data: {
          hpCurrent: newHpCurrent,
          hpMax: newHpMax,
          battleExp: newBattleExp,
          battleLevel: newLevel,
          status: 'ACTIVE',
          battlesTotal: { increment: 1 },
          battlesWon: playerWon ? { increment: 1 } : undefined,
          lastBattleFinishedAt: new Date(),
        },
      })
      // Award stat points for level-up
      if (levelsGained > 0) {
        await tx.characterStats.update({
          where: { characterId: char.id },
          data: { pointsAvailable: { increment: levelsGained } },
        })
      }

      // Money reward
      let moneyReward = 0
      if (playerWon) {
        moneyReward = Math.floor(Math.random() * (bot.moneyRewardMax - bot.moneyRewardMin + 1)) + bot.moneyRewardMin
        if (moneyReward > 0) {
          await tx.character.update({ where: { id: char.id }, data: { money: { increment: moneyReward } } })
          const updatedChar = await tx.character.findUnique({ where: { id: char.id } })
          await tx.currencyLog.create({
            data: {
              characterId: char.id,
              amount: moneyReward,
              balanceAfter: updatedChar!.money,
              reasonCode: 'BATTLE_REWARD',
              refId: battleId,
              refType: 'battle',
            },
          })
        }
      }

      // FIX: Use shared getWeaponSkillLevelFromExp instead of inline duplicate
      // Weapon skill exp — save even for MELEE (no weapon equipped = fists)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const weaponTypeForSkill: any = weapon?.template.weaponType ?? 'MELEE'
      await saveWeaponSkillExp(tx as typeof prisma, char.id, weaponTypeForSkill, weaponExpGain)

      // Update battle record
      await tx.battle.update({
        where: { id: battleId },
        data: {
          status: 'FINISHED',
          winnerId,
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
        newBattleExp,
        playerHp: playerPart.hpCurrent,
        rounds: state.roundNumber,
      }
    })
  },

  // -------------------------------------------------------
  // Resolve PvP round (зональная модель, оба игрока сходили)
  // -------------------------------------------------------
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

    const [weapon1, weapon2] = await Promise.all([
      part1.weaponInstanceId ? ItemsRepository.findInstanceById(part1.weaponInstanceId) : Promise.resolve(null),
      part2.weaponInstanceId ? ItemsRepository.findInstanceById(part2.weaponInstanceId) : Promise.resolve(null),
    ])

    const [equippedItems1, equippedItems2] = await Promise.all([
      ItemsRepository.findEquipped(char1.id),
      ItemsRepository.findEquipped(char2.id),
    ])
    const armor1 = equippedItems1.filter(i => i.template.type === 'ARMOR')
    const armor2 = equippedItems2.filter(i => i.template.type === 'ARMOR')
    const armorList1 = armorListFromEquipped(armor1)
    const armorList2 = armorListFromEquipped(armor2)

    const wtype1 = (weapon1?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const wtype2 = (weapon2?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const [skill1, skill2] = await Promise.all([
      WeaponSkillsRepository.findOrCreate(char1.id, wtype1),
      WeaponSkillsRepository.findOrCreate(char2.id, wtype2),
    ])
    const [antiSkill1vs2, antiSkill2vs1] = await Promise.all([
      WeaponSkillsRepository.findOrCreate(char1.id, wtype2),
      WeaponSkillsRepository.findOrCreate(char2.id, wtype1),
    ])

    const snap1Atk = await buildAttackerSnapshotAsync(char1, weapon1, skill1.skillLevel, armor1)
    const snap2Atk = await buildAttackerSnapshotAsync(char2, weapon2, skill2.skillLevel, armor2)
    const snap1Def = buildDefenderSnapshot(char1, armor1, antiSkill1vs2.antiSkillLevel, weapon1)
    const snap2Def = buildDefenderSnapshot(char2, armor2, antiSkill2vs1.antiSkillLevel, weapon2)

    const init1 = calcInitiative(char1.stats!.rea, char1.stats!.agi, skill1.skillLevel, snap1Atk.equipmentWeight)
    const init2 = calcInitiative(char2.stats!.rea, char2.stats!.agi, skill2.skillLevel, snap2Atk.equipmentWeight)

    const turn1 = part1.pendingTurn ?? legacyActionToTurn(part1.pendingAction ?? 'attack')
    const turn2 = part2.pendingTurn ?? legacyActionToTurn(part2.pendingAction ?? 'attack')

    let hp1 = part1.hpCurrent
    let hp2 = part2.hpCurrent

    type TurnRec = { actorPart: LiveParticipant; defenderPart: LiveParticipant; r: ZonalAttackResult }
    const roundTurns: TurnRec[] = []
    const hitZonesOn1: BodyZone[] = []
    const hitZonesOn2: BodyZone[] = []

    const doStrike = (
      atkPart: LiveParticipant, atkSnap: AttackerSnapshot, atkTurn: ZonalTurnInput,
      defPart: LiveParticipant, defSnap: DefenderSnapshot, defArmorList: EquipArmorLike[], defTurn: ZonalTurnInput
    ) => {
      const defHp = defPart === part1 ? hp1 : hp2
      const res = executeStrikes({
        attackerSnap: atkSnap, defenderSnap: defSnap,
        zoneArmorFor: (z) => armorOfZone(defArmorList, z),
        attackZones: atkTurn.attackZones,
        blockedZones: defTurn.blockZones,
        defenderHp: defHp,
      })
      for (const r of res.results) {
        if (r.hit && !r.dodge && !r.block) {
          if (defPart === part1) { hp1 = Math.max(0, hp1 - r.finalDamage); hitZonesOn1.push(r.zone) }
          else { hp2 = Math.max(0, hp2 - r.finalDamage); hitZonesOn2.push(r.zone) }
          atkPart.hitsLanded++; defPart.hitsTaken++
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
    const distance = syncGridDistance(state)
    const range1 = weaponRangeOf(weapon1)
    const range2 = weaponRangeOf(weapon2)
    const projected = positionedParticipants(state)
    const gridPart1 = projected.find(p => p.participantId === part1.participantId)!
    const gridPart2 = projected.find(p => p.participantId === part2.participantId)!
    const doStrike1 = !moved1 && turn1.attackZones.length > 0
      && canAttackTarget(gridPart1, gridPart2, projected, range1)
    const doStrike2 = !moved2 && turn2.attackZones.length > 0
      && canAttackTarget(gridPart2, gridPart1, projected, range2)

    if (p1First) {
      if (doStrike1) doStrike(part1, snap1Atk, turn1, part2, snap2Def, armorList2, turn2)
      if (doStrike2 && hp1 > 0 && hp2 > 0) doStrike(part2, snap2Atk, turn2, part1, snap1Def, armorList1, turn1)
    } else {
      if (doStrike2) doStrike(part2, snap2Atk, turn2, part1, snap1Def, armorList1, turn1)
      if (doStrike1 && hp1 > 0 && hp2 > 0) doStrike(part1, snap1Atk, turn1, part2, snap2Def, armorList2, turn2)
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
    if (weapon1 && roundTurns.some(t => t.actorPart === part1 && t.r.hit && !t.r.dodge && !t.r.block)) {
      await ItemsRepository.updateDurability(weapon1.id, Math.max(0, weapon1.durabilityCurrent - 1))
    }
    if (weapon2 && roundTurns.some(t => t.actorPart === part2 && t.r.hit && !t.r.dodge && !t.r.block)) {
      await ItemsRepository.updateDurability(weapon2.id, Math.max(0, weapon2.durabilityCurrent - 1))
    }
    // Зональный износ брони — ломается то, во что бьют
    await applyZonalArmorWear(armor1, hitZonesOn1)
    await applyZonalArmorWear(armor2, hitZonesOn2)

    const turnRecords = roundTurns.map(t => ({
      battleId, roundNumber,
      actorCharId: t.actorPart.characterId ?? null,
      targetCharId: t.defenderPart.characterId ?? null,
      action: 'ATTACK' as BattleAction,
      weaponId: t.actorPart === part1 ? weapon1?.id ?? null : weapon2?.id ?? null,
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
      turns: [...moveEvents, ...roundTurns.map(t => ({ actor: t.actorPart.characterId, action: 'attack', ...t.r }))],
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
    skill1Level: number,
    skill2Level: number
  ) {
    const levelDiff = Math.abs(char1.battleLevel - char2.battleLevel)

    const result1 = winnerId === char1.id ? 'PVP_WIN' : winnerId === char2.id ? 'PVP_LOSS' : 'DRAW'
    const result2 = winnerId === char2.id ? 'PVP_WIN' : winnerId === char1.id ? 'PVP_LOSS' : 'DRAW'

    const exp1 = calcBattleExp(part1.damageDealt, char2.battleLevel * 5, char2.hpMax, levelDiff, result1 as 'PVP_WIN' | 'PVP_LOSS' | 'DRAW')
    const exp2 = calcBattleExp(part2.damageDealt, char1.battleLevel * 5, char1.hpMax, levelDiff, result2 as 'PVP_WIN' | 'PVP_LOSS' | 'DRAW')

    const wskExp1 = calcWeaponSkillExp(part1.damageDealt, char2.hpMax, winnerId === char1.id ? 1 : 0, levelDiff)
    const wskExp2 = calcWeaponSkillExp(part2.damageDealt, char1.hpMax, winnerId === char2.id ? 1 : 0, levelDiff)

    return withTransaction(async (tx) => {
      // Update char1
      const newExp1 = char1.battleExp + exp1
      const newLevel1 = getLevelFromExp(newExp1)
      await tx.character.update({
        where: { id: char1.id },
        data: { hpCurrent: Math.max(1, part1.hpCurrent), battleExp: newExp1, battleLevel: newLevel1, status: 'ACTIVE' },
      })

      // Update char2
      const newExp2 = char2.battleExp + exp2
      const newLevel2 = getLevelFromExp(newExp2)
      await tx.character.update({
        where: { id: char2.id },
        data: { hpCurrent: Math.max(1, part2.hpCurrent), battleExp: newExp2, battleLevel: newLevel2, status: 'ACTIVE' },
      })

      // Weapon skill exp
      const wtype1 = weapon1?.template.weaponType ?? 'MELEE'
      const wtype2 = weapon2?.template.weaponType ?? 'MELEE'
      await saveWeaponSkillExp(tx as typeof prisma, char1.id, wtype1, wskExp1)
      await saveWeaponSkillExp(tx as typeof prisma, char2.id, wtype2, wskExp2)

      // Update battle
      await tx.battle.update({
        where: { id: battleId },
        data: { status: 'FINISHED', winnerId, finishedAt: new Date(), roundCount: state.roundNumber },
      })

      // Update participants
      for (const [part, char] of [[part1, char1], [part2, char2]] as const) {
        await tx.battleParticipant.updateMany({
          where: { battleId, characterId: char.id },
          data: {
            hpCurrent: part.hpCurrent, isAlive: part.isAlive,
            damageDealt: part.damageDealt, damageReceived: part.damageReceived,
            hitsLanded: part.hitsLanded, hitsTaken: part.hitsTaken,
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
        char1: { expGain: exp1, weaponExpGain: wskExp1, newLevel: newLevel1, hp: Math.max(1, part1.hpCurrent) },
        char2: { expGain: exp2, weaponExpGain: wskExp2, newLevel: newLevel2, hp: Math.max(1, part2.hpCurrent) },
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
      const won = b.winnerId === char.id
      const result = b.winnerId === null ? 'draw' : won ? 'win' : 'lose'
      const opponent = oppPart?.character?.nickname ?? oppPart?.bot?.name ?? '?'
      const opponentLevel = oppPart?.character?.battleLevel ?? oppPart?.bot?.battleLevel ?? 0
      return {
        id: b.id,
        type: b.type,
        result,
        opponent,
        opponentLevel,
        expGain: 0, // expGain хранится в Character.battleExp, не в BattleParticipant
        moneyGain: 0,
        rounds: b.roundCount,
        finishedAt: b.finishedAt,
      }
    })

    return { items, total, page, limit, pages: Math.ceil(total / limit) }
  },
}
