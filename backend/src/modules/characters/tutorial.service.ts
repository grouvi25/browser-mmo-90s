import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { DollarsService } from '../dollars/dollars.service'
import { EconomyService } from '../economy/economy.service'

const ACTIONS = ['buy-jacket', 'equip-jacket', 'assign-endurance', 'buy-bandage', 'choose-strike', 'choose-block', 'end-turn'] as const
const REWARD = { rubles: 5000, dollars: 100 }
const progress = { id: true, tutorialStep: true } as const

function tutorial(step: number | null) {
  return { step, completed: step === ACTIONS.length, reward: REWARD }
}

export async function getTutorial(userId: string) {
  const character = await prisma.character.findUnique({ where: { userId }, select: progress })
  if (!character) throw AppError.notFound('Character', userId)
  return tutorial(character.tutorialStep)
}

export async function practiceTutorial(userId: string, action: string) {
  const actionStep = ACTIONS.findIndex(candidate => candidate === action)
  if (actionStep < 0) throw AppError.validation('Такого шага обучения нет')

  return prisma.$transaction(async tx => {
    const character = await tx.character.findUnique({ where: { userId }, select: progress })
    if (!character || character.tutorialStep == null) throw AppError.validation('Практика доступна новым персонажам')
    if (character.tutorialStep > actionStep) return tutorial(character.tutorialStep)
    if (character.tutorialStep !== actionStep) throw AppError.validation('Сначала пройдите предыдущий шаг')
    const next = actionStep + 1
    const changed = await tx.character.updateMany({
      where: { id: character.id, tutorialStep: actionStep },
      data: { tutorialStep: next },
    })
    if (!changed.count) {
      const current = await tx.character.findUniqueOrThrow({ where: { id: character.id }, select: progress })
      return tutorial(current.tutorialStep)
    }
    if (next === ACTIONS.length) {
      await EconomyService.credit(tx, { characterId: character.id, amount: REWARD.rubles, reasonCode: 'TUTORIAL' })
      await DollarsService.credit(tx, { characterId: character.id, amount: REWARD.dollars, reason: 'TUTORIAL' })
    }
    return tutorial(next)
  })
}
