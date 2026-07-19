import { CharactersRepository } from './characters.repository'
import { calcHpMax } from '../stats/stats.formulas'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'
import { audit } from '../../shared/logger/audit-logger'
import type { CreateCharacterInput } from './characters.schemas'

export const CharactersService = {
  async create(userId: string, input: CreateCharacterInput) {
    // Check user doesn't already have a character
    const existing = await CharactersRepository.findByUserId(userId)
    if (existing) {
      throw new AppError(ErrorCode.CHARACTER_ALREADY_EXISTS, 'You already have a character', 409)
    }

    // Check nickname uniqueness
    const existingNick = await CharactersRepository.findByNickname(input.nickname)
    if (existingNick) {
      throw new AppError(ErrorCode.CONFLICT, 'Nickname is already taken', 409)
    }

    const arch = input.archetype
    const B = BalanceConfig.character

    // Build base stats with archetype bonuses
    const base = { ...B.baseStats }
    const bonuses = B.archetypeBonuses[arch] ?? {}
    for (const [stat, bonus] of Object.entries(bonuses)) {
      (base as Record<string, number>)[stat] = ((base as Record<string, number>)[stat] ?? 0) + (bonus as number)
    }

    const pointsAvailable = B.startingPoints[arch] ?? 0

    // Calculate starting HP
    const hpMax = calcHpMax(base.end, 1)

    // Create character
    const char = await CharactersRepository.create({
      userId,
      nickname: input.nickname,
      archetype: arch,
      hpCurrent: hpMax,
      hpMax,
      money: B.startMoney,
    })

    // Create stats
    await CharactersRepository.createStats(char.id, { ...base, pointsAvailable })

    audit('character.created', {
      userId,
      characterId: char.id,
      nickname: char.nickname,
      archetype: arch,
    })

    return CharactersRepository.findByUserId(userId)
  },

  async getProfile(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) {
      throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    }
    return char
  },

  async getById(characterId: string) {
    const char = await CharactersRepository.findById(characterId)
    if (!char) {
      throw AppError.notFound('Character', characterId)
    }
    return char
  },
}
