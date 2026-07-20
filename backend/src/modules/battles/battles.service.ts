import type { BattleAction, WeaponType as PrismaWeaponType } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { BattleRedis, AntiFarmRedis } from '../../shared/db/redis'
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
  type AttackerSnapshot,
  type DefenderSnapshot,
} from './battle.formulas'
import {
  calcBattleExp,
  calcWeaponSkillExp,
  getLevelFromExp,
  calcHpMax,
  calcArmorDurabilityLoss,
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
  pendingAction?: string   // 'attack' | 'block' | 'surrender' | 'change_weapon:{id}'
  weaponInstanceId?: string
  damageDealt: number
  damageReceived: number
  hitsTaken: number
  hitsLanded: number
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
  }
}

function buildBotDefenderSnapshot(botStats: Record<string, number>): DefenderSnapshot {
  return {
    agi: botStats.agi ?? 2, rea: botStats.rea ?? 2, end: botStats.end ?? 2,
    luck: botStats.luck ?? 1,
    armor: botStats.armor ?? 2,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
    antiSkillLevel: 0,
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
  async createPvpDuel(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Already in battle', 400)

    const battle = await prisma.battle.create({
      data: { type: 'PVP_DUEL', status: 'WAITING_PLAYERS' },
    })

    const weapon = await ItemsRepository.findEquippedWeapon(char.id)

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
    return { battleId: battle.id, status: 'WAITING_PLAYERS' }
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

    const weapon = await ItemsRepository.findEquippedWeapon(char.id)
    const opponentPart = battle.participants[0]

    return withTransaction(async (tx) => {
      await tx.battleParticipant.create({
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
          },
          {
            participantId: '', // filled after create
            characterId: char.id,
            hpCurrent: char.hpCurrent,
            hpMax: char.hpMax,
            side: 2,
            isAlive: true,
            isSurrendered: false,
            hasActedThisRound: false,
            weaponInstanceId: weapon?.id,
            damageDealt: 0, damageReceived: 0, hitsTaken: 0, hitsLanded: 0,
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
  // Submit action (PvE: auto-resolve when player acts)
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

    // Durability loss
    if (weapon && turns.some(t => t.actor === 'player' && t.result.hit)) {
      const newDur = Math.max(0, weapon.durabilityCurrent - 1)
      await ItemsRepository.updateDurability(weapon.id, newDur)
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
      // Update character HP, exp, level
      const newBattleExp = char.battleExp + expGain
      const newLevel = getLevelFromExp(newBattleExp)
      const newHpMax = calcHpMax(char.stats!.end, newLevel)
      const newHpCurrent = Math.max(1, playerPart.hpCurrent)

      await tx.character.update({
        where: { id: char.id },
        data: {
          hpCurrent: newHpCurrent,
          hpMax: newHpMax,
          battleExp: newBattleExp,
          battleLevel: newLevel,
          status: 'ACTIVE',
        },
      })

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

      // Weapon skill exp — save even for MELEE (no weapon equipped = fists)
      // Weapon skill exp — save even for MELEE (no weapon = fists)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const weaponTypeForSkill: any = weapon?.template.weaponType ?? 'MELEE'
      if (weaponExpGain > 0) {
        const wt = weaponTypeForSkill
        const existing = await tx.weaponSkill.findUnique({
          where: { characterId_weaponType: { characterId: char.id, weaponType: wt } },
        })
        const base = existing ?? { skillLevel: 1, skillExp: 0 }
        const newWskExp = base.skillExp + weaponExpGain
        const newWskLevel = (() => {
          const thresholds = [0, 4, 8, 13, 23, 36, 56, 84, 123, 176, 248, 344, 471, 637, 852, 1128, 1480, 1926, 2489, 3193, 4070]
          let lv = 1
          for (let i = 1; i < thresholds.length; i++) if (newWskExp >= thresholds[i]) lv = i + 1; else break
          return Math.min(lv, 20)
        })()
        if (existing) {
          await tx.weaponSkill.update({
            where: { characterId_weaponType: { characterId: char.id, weaponType: wt } },
            data: { skillExp: newWskExp, skillLevel: newWskLevel },
          })
        } else {
          await tx.weaponSkill.create({
            data: { characterId: char.id, weaponType: wt, skillExp: newWskExp, skillLevel: newWskLevel },
          })
        }
      }

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
  // -------------------------------------------------------
  async _resolveRoundPvp(battleId: string, state: LiveBattleState) {
    // TODO: implement full PvP round resolution
    // For now return state
    return { roundNumber: state.roundNumber, waiting: false }
  },

  async _finishBattle(battleId: string, state: LiveBattleState, winnerId: string | null) {
    await prisma.battle.update({
      where: { id: battleId },
      data: { status: 'FINISHED', winnerId, finishedAt: new Date(), roundCount: state.roundNumber },
    })
    await BattleRedis.deleteState(battleId)
    return { battleOver: true, winnerId }
  },
}
