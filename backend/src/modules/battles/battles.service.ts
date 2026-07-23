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
  resolveAttack,
  calcInitiative,
  calcCounterAttackChance,
  resolveCounterAttack,
  type AttackerSnapshot,
  type DefenderSnapshot,
} from './battle.formulas'
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
  weaponInstanceId?: string
  damageDealt: number
  damageReceived: number
  hitsTaken: number
  hitsLanded: number
  skippedTurns: number   // tracks AFK/passive turns for anti-abuse
}

export interface LiveBattleState {
  battleId: string
  type: string
  roundNumber: number
  status: 'active' | 'finishing'
  participants: LiveParticipant[]
  roundDeadline?: number    // unix ms for auto-resolve
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
  antiSkillLevel = 0   // Anti-mastery vs current attacker's weapon type
): DefenderSnapshot {
  const s = char.stats!
  const totalArmor   = equippedArmor.reduce((sum, a) => sum + (a.template.armor ?? 0), 0)
  const antiCrit     = equippedArmor.reduce((sum, a) => sum + (a.template.antiCrit ?? 0), 0)
  const blockBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.blockBonus ?? 0), 0)
  const dodgeBonus   = equippedArmor.reduce((sum, a) => sum + (a.template.dodgeBonus ?? 0), 0)
  const armorWeight  = equippedArmor.reduce((sum, a) => sum + a.weight, 0)
  return {
    agi: s.agi, rea: s.rea, end: s.end, luck: s.luck,
    armor: totalArmor, dodgeBonus, antiCrit, blockBonus, armorWeight,
    antiSkillLevel,  // Loaded from weapon_skills where weaponType = attacker's weapon type
    antiCounterDefense: 0, // TODO: from item modifiers when upgrade system is implemented
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

      // Update character status
      await tx.character.update({ where: { id: char.id }, data: { status: 'IN_BATTLE' } })

      // Init Redis battle state
      const liveState: LiveBattleState = {
        battleId: battle.id,
        type: 'PVE_BOT',
        roundNumber: 1,
        status: 'active',
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

    const battle = await prisma.battle.create({
      data: {
        type: 'PVP_DUEL',
        status: 'WAITING_PLAYERS',
        levelMin: lMin,
        levelMax: lMax,
      },
    })

    await prisma.battleParticipant.create({
      data: {
        battleId: battle.id,
        characterId: char.id,
        side: 1,
        hpMax: char.hpMax,
        hpCurrent: char.hpCurrent,
      },
    })

    await CharactersRepository.updateStatus(char.id, 'IN_BATTLE')
    return { battleId: battle.id, status: 'WAITING_PLAYERS', levelMin: lMin, levelMax: lMax }
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
      // FIX: capture the created participant ID
      const newParticipant = await tx.battleParticipant.create({
        data: {
          battleId: battle.id,
          characterId: char.id,
          side: 2,
          hpMax: char.hpMax,
          hpCurrent: char.hpCurrent,
        },
      })
      await tx.battle.update({ where: { id: battleId }, data: { status: 'ACTIVE', startedAt: new Date() } })
      await tx.character.update({ where: { id: char.id }, data: { status: 'IN_BATTLE' } })

      const opponentChar = await CharactersRepository.findById(opponentPart.characterId!)
      const oppWeapon = opponentChar ? await ItemsRepository.findEquippedWeapon(opponentChar.id) : null

      const liveState: LiveBattleState = {
        battleId: battle.id,
        type: 'PVP_DUEL',
        roundNumber: 1,
        status: 'active',
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
    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      include: { participants: true, turns: { orderBy: { roundNumber: 'asc' }, take: 50 } },
    })
    if (!battle) throw AppError.notFound('Battle', battleId)

    const liveState = await BattleRedis.getState<LiveBattleState>(battleId)
    return { battle, liveState }
  },

  // -------------------------------------------------------
  // Submit action
  // -------------------------------------------------------
  async submitAction(userId: string, battleId: string, action: string, targetItemId?: string) {
    const locked = await BattleRedis.acquireLock(battleId, 5000)
    if (!locked) throw new AppError(ErrorCode.BATTLE_LOCK_FAILED, 'Battle is processing, retry', 409)

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

      // ── PvE: авторазрешение раунда ─────────────────────
      if (state.type === 'PVE_BOT') {
        return this._resolveRoundPve(battleId, state, char, action, targetItemId)
      }

      // ── PvP: сохраняем действие, ждём противника ───────
      playerPart.pendingAction = action
      playerPart.hasActedThisRound = true
      await BattleRedis.setState(battleId, state)

      const allActed = state.participants.every(p => !p.isAlive || p.isSurrendered || p.hasActedThisRound)
      if (allActed) {
        return this._resolveRoundPvp(battleId, state)
      }
      return { waiting: true, roundNumber: state.roundNumber }

    } finally {
      await BattleRedis.releaseLock(battleId)
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

    // Consume the item
    await ItemsRepository.updateStatus(itemInstanceId, 'CONSUMED')

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

    // For PvE: bot also attacks on same round
    if (state.type === 'PVE_BOT') {
      const botPart = state.participants.find(p => p.botId)!
      const bot = await loadBotData(botPart.botId!)
      const botStats = bot.stats as Record<string, number>
      const botEquip = bot.equipment as Record<string, unknown>
      const equippedItems = await ItemsRepository.findEquipped(char.id)
      const equippedArmor = equippedItems.filter(i => i.template.type === 'ARMOR')
      const playerDefSnap = buildDefenderSnapshot(char, equippedArmor)
      const botAttackSnap = buildBotAttackerSnapshot(botStats, botEquip)

      const botResult = resolveAttack(botAttackSnap, playerDefSnap, false)
      if (botResult.hit && !botResult.dodge) {
        const dmg = botResult.finalDamage
        playerPart.hpCurrent = Math.max(0, playerPart.hpCurrent - dmg)
        botPart.damageDealt += dmg
        playerPart.damageReceived += dmg
        botPart.hitsLanded++
        playerPart.hitsTaken++
      }
      playerPart.isAlive = playerPart.hpCurrent > 0

      await prisma.battleTurn.create({
        data: {
          battleId, roundNumber,
          actorBotId: botPart.botId, targetCharId: char.id,
          action: 'ATTACK' as BattleAction,
          hit: botResult.hit, dodge: botResult.dodge, block: botResult.block, crit: botResult.crit,
          rawDamage: botResult.rawDamage, finalDamage: botResult.finalDamage,
          logLine: botResult.logParts.join(', '),
        },
      })

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
      playerPart.hasActedThisRound = false
      await BattleRedis.setState(battleId, state)

      return {
        roundNumber,
        itemUsed: item.template.name,
        hpRestored: hpRestore,
        botAttack: { ...botResult },
        playerHp: playerPart.hpCurrent,
        botHp: botPart.hpCurrent,
        battleOver: false,
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
  // Resolve PvE round
  // -------------------------------------------------------
  async _resolveRoundPve(
    battleId: string,
    state: LiveBattleState,
    char: CharacterWithStats,
    playerAction: string,
    _targetItemId?: string
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

    // Load weapon skill for player's weapon type
    const skillRecord = await WeaponSkillsRepository.findOrCreate(char.id, weaponType as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1])

    // Load all equipped armor for player (for defender snapshot + attacker equipment weight)
    const equippedItems = await ItemsRepository.findEquipped(char.id)
    const equippedArmor = equippedItems.filter(i => i.template.type === 'ARMOR')

    // Build snapshots with real equipment weight and anti-mastery
    const attackerSnap = await buildAttackerSnapshotAsync(char, weapon, skillRecord.skillLevel, equippedArmor)

    // For defender (bot): no anti-mastery in stage 1, use bot stats directly
    const defenderSnap = buildBotDefenderSnapshot(botStats)

    const botAttackSnap = buildBotAttackerSnapshot(botStats, botEquip)
    // Player's defense includes real equipped armor  
    const playerDefSnap = buildDefenderSnapshot(char, equippedArmor)

    // Initiative: now uses real equipmentWeight from attackerSnap
    const playerInit = calcInitiative(char.stats!.rea, char.stats!.agi, skillRecord.skillLevel, attackerSnap.equipmentWeight)
    const botInit    = calcInitiative(botStats.rea ?? 2, botStats.agi ?? 2, 1, 0)
    const playerFirst = playerInit >= botInit

    const turns: Array<{
      actor: 'player' | 'bot'
      action: string
      result: ReturnType<typeof resolveAttack>
    }> = []

    let playerHp = playerPart.hpCurrent
    let botHp = botPart.hpCurrent

    // Helper: apply attack
    const doPlayerAttack = () => {
      const r = resolveAttack(attackerSnap, defenderSnap, false)
      if (r.hit && !r.dodge) {
        botHp = Math.max(0, botHp - r.finalDamage)
        playerPart.damageDealt += r.finalDamage
        botPart.damageReceived += r.finalDamage
        if (r.hit) playerPart.hitsLanded++
        if (r.hit) botPart.hitsTaken++
      }
      return r
    }

    const doBotAttack = () => {
      const isBlocking = playerAction === 'block'
      const r = resolveAttack(botAttackSnap, playerDefSnap, isBlocking)
      if (r.hit && !r.dodge) {
        playerHp = Math.max(0, playerHp - r.finalDamage)
        botPart.damageDealt += r.finalDamage
        playerPart.damageReceived += r.finalDamage
        if (r.hit) botPart.hitsLanded++
        if (r.hit) playerPart.hitsTaken++

        // ── Ответный удар (ответка, Apeha mechanic) ──────────
        const counterWeapon = weapon
          ? { minDamage: weapon.template.minDamage ?? 2, maxDamage: weapon.template.maxDamage ?? 6 }
          : { minDamage: 2, maxDamage: 6 }
        const counter = resolveCounterAttack(playerDefSnap, botAttackSnap, counterWeapon)
        if (counter.triggered && botHp > 0) {
          botHp = Math.max(0, botHp - counter.damage)
          playerPart.damageDealt += counter.damage
          botPart.damageReceived += counter.damage
        }
      }
      return r
    }

    if (playerFirst) {
      if (playerAction === 'attack') turns.push({ actor: 'player', action: 'attack', result: doPlayerAttack() })
      if (botHp > 0) turns.push({ actor: 'bot', action: 'attack', result: doBotAttack() })
    } else {
      turns.push({ actor: 'bot', action: 'attack', result: doBotAttack() })
      if (playerHp > 0 && playerAction === 'attack') turns.push({ actor: 'player', action: 'attack', result: doPlayerAttack() })
    }

    playerPart.hpCurrent = playerHp
    botPart.hpCurrent = botHp
    playerPart.isAlive = playerHp > 0
    botPart.isAlive = botHp > 0

    const roundNumber = state.roundNumber

    // FIX: Apply weapon durability loss
    if (weapon && turns.some(t => t.actor === 'player' && t.result.hit)) {
      const newDur = Math.max(0, weapon.durabilityCurrent - 1)
      await ItemsRepository.updateDurability(weapon.id, newDur)
    }

    // FIX: Apply armor durability loss (floor(receivedHits / 2) per TZ section 19.2)
    const botHitsOnPlayer = turns.filter(t => t.actor === 'bot' && t.result.hit && !t.result.dodge).length
    const armorDurLoss = Math.floor(botHitsOnPlayer / 2)
    // Actually: if player took 1 hit → floor(1/2) = 0; if 2 hits → 1. For MVP simplicity apply to all equipped armor
    if (armorDurLoss > 0 && equippedArmor.length > 0) {
      // Distribute loss: apply to random armor piece (simple: first equipped)
      const armorToDegrade = equippedArmor[Math.floor(Math.random() * equippedArmor.length)]
      const newArmorDur = Math.max(0, armorToDegrade.durabilityCurrent - armorDurLoss)
      await ItemsRepository.updateDurability(armorToDegrade.id, newArmorDur)
    }

    // Check battle end
    const playerDead = !playerPart.isAlive
    const botDead = !botPart.isAlive
    const battleOver = playerDead || botDead || roundNumber >= 30

    // Save turns to DB
    const turnRecords = turns.map(t => ({
      battleId,
      roundNumber,
      actorCharId: t.actor === 'player' ? char.id : null,
      actorBotId: t.actor === 'bot' ? botPart.botId : null,
      targetCharId: t.actor === 'bot' ? char.id : null,
      targetBotId: t.actor === 'player' ? botPart.botId : null,
      action: t.action.toUpperCase() as BattleAction,
      weaponId: t.actor === 'player' ? weapon?.id ?? null : null,
      hit: t.result.hit,
      dodge: t.result.dodge,
      block: t.result.block,
      crit: t.result.crit,
      rawDamage: t.result.rawDamage,
      finalDamage: t.result.finalDamage,
      targetHpBefore: t.actor === 'player' ? botHp + t.result.finalDamage : playerHp + t.result.finalDamage,
      targetHpAfter: t.actor === 'player' ? botHp : playerHp,
      weaponDurLoss: t.actor === 'player' && t.result.hit ? 1 : 0,
      logLine: t.result.logParts.join(', '),
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.battleTurn.createMany({ data: turnRecords as any })

    if (battleOver) {
      state.status = 'finishing'
      const winnerId = botDead ? char.id : null
      return this._finishPveBattle(battleId, state, char, bot, playerPart, botPart, winnerId, weapon, skillRecord.skillLevel)
    }

    // Continue
    state.roundNumber++
    playerPart.hasActedThisRound = false
    await BattleRedis.setState(battleId, state)

    return {
      roundNumber,
      turns: turns.map(t => ({ actor: t.actor, action: t.action, ...t.result })),
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
  // Resolve PvP round (both players have acted)
  // FIX: Full implementation replacing the stub
  // -------------------------------------------------------
  async _resolveRoundPvp(battleId: string, state: LiveBattleState) {
    const [part1, part2] = state.participants.filter(p => p.characterId)
    if (!part1 || !part2) {
      logger.error({ battleId }, 'PvP round resolve: cannot find two character participants')
      return { roundNumber: state.roundNumber, waiting: false }
    }

    // Load both characters with their data
    const [char1, char2] = await Promise.all([
      CharactersRepository.findById(part1.characterId!),
      CharactersRepository.findById(part2.characterId!),
    ])
    if (!char1 || !char2) {
      logger.error({ battleId }, 'PvP round resolve: character not found')
      return { roundNumber: state.roundNumber, waiting: false }
    }

    // Load weapons
    const [weapon1, weapon2] = await Promise.all([
      part1.weaponInstanceId ? ItemsRepository.findInstanceById(part1.weaponInstanceId) : Promise.resolve(null),
      part2.weaponInstanceId ? ItemsRepository.findInstanceById(part2.weaponInstanceId) : Promise.resolve(null),
    ])

    // Load armor for both
    const [equippedItems1, equippedItems2] = await Promise.all([
      ItemsRepository.findEquipped(char1.id),
      ItemsRepository.findEquipped(char2.id),
    ])
    const armor1 = equippedItems1.filter(i => i.template.type === 'ARMOR')
    const armor2 = equippedItems2.filter(i => i.template.type === 'ARMOR')

    // Load weapon skills
    const wtype1 = (weapon1?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const wtype2 = (weapon2?.template.weaponType ?? 'MELEE') as Parameters<typeof WeaponSkillsRepository.findOrCreate>[1]
    const [skill1, skill2] = await Promise.all([
      WeaponSkillsRepository.findOrCreate(char1.id, wtype1),
      WeaponSkillsRepository.findOrCreate(char2.id, wtype2),
    ])

    // Get anti-skill: char1's anti-skill vs char2's weapon type, and vice versa
    const [antiSkill1vs2, antiSkill2vs1] = await Promise.all([
      WeaponSkillsRepository.findOrCreate(char1.id, wtype2),
      WeaponSkillsRepository.findOrCreate(char2.id, wtype1),
    ])

    // Build snapshots
    const snap1Atk = await buildAttackerSnapshotAsync(char1, weapon1, skill1.skillLevel, armor1)
    const snap2Atk = await buildAttackerSnapshotAsync(char2, weapon2, skill2.skillLevel, armor2)
    const snap1Def = buildDefenderSnapshot(char1, armor1, antiSkill1vs2.antiSkillLevel)
    const snap2Def = buildDefenderSnapshot(char2, armor2, antiSkill2vs1.antiSkillLevel)

    // Calculate initiatives
    const init1 = calcInitiative(char1.stats!.rea, char1.stats!.agi, skill1.skillLevel, snap1Atk.equipmentWeight)
    const init2 = calcInitiative(char2.stats!.rea, char2.stats!.agi, skill2.skillLevel, snap2Atk.equipmentWeight)

    // Determine acting order
    const firstPart = init1 >= init2 ? part1 : part2
    const secondPart = init1 >= init2 ? part2 : part1
    const firstSnap = init1 >= init2 ? snap1Atk : snap2Atk
    const secondSnap = init1 >= init2 ? snap2Atk : snap1Atk
    const firstDefSnap = init1 >= init2 ? snap2Def : snap1Def  // first attacks → second defends
    const secondDefSnap = init1 >= init2 ? snap1Def : snap2Def

    let hp1 = part1.hpCurrent
    let hp2 = part2.hpCurrent

    const roundTurns: Array<{
      actorPart: LiveParticipant
      defenderPart: LiveParticipant
      result: ReturnType<typeof resolveAttack>
    }> = []

    const action1 = (init1 >= init2 ? part1 : part2).pendingAction ?? 'attack'
    const action2 = (init1 >= init2 ? part2 : part1).pendingAction ?? 'attack'
    const isFirstBlocking = action1 === 'block'
    const isSecondBlocking = action2 === 'block'

    // First actor attacks
    if (action1 === 'attack' || isFirstBlocking === false) {
      if (action1 === 'attack') {
        const r = resolveAttack(firstSnap, firstDefSnap, isSecondBlocking)
        if (r.hit && !r.dodge) {
          if (init1 >= init2) {
            hp2 = Math.max(0, hp2 - r.finalDamage)
            part1.damageDealt += r.finalDamage
            part2.damageReceived += r.finalDamage
            part1.hitsLanded++
            part2.hitsTaken++
          } else {
            hp1 = Math.max(0, hp1 - r.finalDamage)
            part2.damageDealt += r.finalDamage
            part1.damageReceived += r.finalDamage
            part2.hitsLanded++
            part1.hitsTaken++
          }
        }
        roundTurns.push({ actorPart: firstPart, defenderPart: secondPart, result: r })
      }
    }

    // Second actor attacks (if first actor isn't dead)
    const firstTargetHp = init1 >= init2 ? hp2 : hp1
    if (firstTargetHp > 0 && action2 === 'attack') {
      const r = resolveAttack(secondSnap, secondDefSnap, isFirstBlocking)
      if (r.hit && !r.dodge) {
        if (init1 >= init2) {
          hp1 = Math.max(0, hp1 - r.finalDamage)
          part2.damageDealt += r.finalDamage
          part1.damageReceived += r.finalDamage
          part2.hitsLanded++
          part1.hitsTaken++
        } else {
          hp2 = Math.max(0, hp2 - r.finalDamage)
          part1.damageDealt += r.finalDamage
          part2.damageReceived += r.finalDamage
          part1.hitsLanded++
          part2.hitsTaken++
        }
      }
      roundTurns.push({ actorPart: secondPart, defenderPart: firstPart, result: r })
    }

    part1.hpCurrent = hp1
    part2.hpCurrent = hp2
    part1.isAlive = hp1 > 0
    part2.isAlive = hp2 > 0

    const roundNumber = state.roundNumber

    // Apply weapon durability loss
    for (const turn of roundTurns) {
      const weapon = turn.actorPart === part1 ? weapon1 : weapon2
      if (weapon && turn.result.hit) {
        const newDur = Math.max(0, weapon.durabilityCurrent - 1)
        await ItemsRepository.updateDurability(weapon.id, newDur)
      }
    }

    // Apply armor durability loss
    const hitsOnPlayer1 = roundTurns.filter(t => t.defenderPart === part1 && t.result.hit && !t.result.dodge).length
    const hitsOnPlayer2 = roundTurns.filter(t => t.defenderPart === part2 && t.result.hit && !t.result.dodge).length
    if (Math.floor(hitsOnPlayer1 / 2) > 0 && armor1.length > 0) {
      const a = armor1[Math.floor(Math.random() * armor1.length)]
      await ItemsRepository.updateDurability(a.id, Math.max(0, a.durabilityCurrent - Math.floor(hitsOnPlayer1 / 2)))
    }
    if (Math.floor(hitsOnPlayer2 / 2) > 0 && armor2.length > 0) {
      const a = armor2[Math.floor(Math.random() * armor2.length)]
      await ItemsRepository.updateDurability(a.id, Math.max(0, a.durabilityCurrent - Math.floor(hitsOnPlayer2 / 2)))
    }

    // Save turns to DB
    const turnRecords = roundTurns.map(t => ({
      battleId,
      roundNumber,
      actorCharId: t.actorPart.characterId ?? null,
      targetCharId: t.defenderPart.characterId ?? null,
      action: 'ATTACK' as BattleAction,
      weaponId: t.actorPart === part1 ? weapon1?.id ?? null : weapon2?.id ?? null,
      hit: t.result.hit, dodge: t.result.dodge, block: t.result.block, crit: t.result.crit,
      rawDamage: t.result.rawDamage, finalDamage: t.result.finalDamage,
      logLine: t.result.logParts.join(', '),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.battleTurn.createMany({ data: turnRecords as any })

    // Check battle end
    const p1Dead = !part1.isAlive
    const p2Dead = !part2.isAlive
    const battleOver = p1Dead || p2Dead || roundNumber >= 30

    if (battleOver) {
      state.status = 'finishing'
      const winnerId = p2Dead && !p1Dead ? char1.id : p1Dead && !p2Dead ? char2.id : null
      await BattleRedis.setState(battleId, state)
      return this._finishPvpBattle(battleId, state, char1, char2, part1, part2, winnerId, weapon1, weapon2, skill1.skillLevel, skill2.skillLevel)
    }

    // Continue: reset actions, increment round
    state.roundNumber++
    part1.hasActedThisRound = false
    part2.hasActedThisRound = false
    part1.pendingAction = undefined
    part2.pendingAction = undefined
    await BattleRedis.setState(battleId, state)

    return {
      roundNumber,
      turns: roundTurns.map(t => ({
        actor: t.actorPart.characterId,
        ...t.result,
      })),
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
