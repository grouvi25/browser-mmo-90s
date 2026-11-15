import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DevBoard } from '../../modules/dev-board/dev-board.service'
import { testPrisma } from './helpers'

// Доска разработчиков: двое не берут одно и то же, готовое и свободное переключаются.
describe('доска разработчиков', () => {
  beforeEach(async () => { await testPrisma.devBoardItem.deleteMany(); await testPrisma.devScoreEvent.deleteMany() })
  afterAll(async () => { await testPrisma.devBoardItem.deleteMany() })

  it('взял один — второй не возьмёт, пока не отпустят', async () => {
    const task = await DevBoard.addTask('проверить формулы ответки', 'Миша')
    expect((await DevBoard.take(task.id, 'Миша')).takenBy).toBe('Миша')
    await expect(DevBoard.take(task.id, 'Егор')).rejects.toMatchObject({ statusCode: 409 })
    await DevBoard.free(task.id)
    expect((await DevBoard.take(task.id, 'Егор')).takenBy).toBe('Егор')
    const done = await DevBoard.done(task.id, 'Егор')
    expect(done.status).toBe('DONE')
    await expect(DevBoard.take(task.id, 'Миша')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('одновременные «Беру» — берёт ровно один', async () => {
    const task = await DevBoard.addTask('гонка', 'Миша')
    const results = await Promise.allSettled([DevBoard.take(task.id, 'Миша'), DevBoard.take(task.id, 'Егор')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('в списке активные и недавно готовые', async () => {
    const a = await DevBoard.addTask('первая', 'Миша')
    const b = await DevBoard.addTask('вторая', 'Егор')
    await DevBoard.done(b.id, 'Егор')
    const board = await DevBoard.list()
    expect(board.active.map(i => i.id)).toContain(a.id)
    expect(board.recentDone.map(i => i.id)).toContain(b.id)
  })

  it('оценка за готовое идёт человеку, повторная заменяет прежнюю', async () => {
    const task = await DevBoard.addTask('оценка', 'Миша')
    await DevBoard.take(task.id, 'Егор (нейронка)')
    await DevBoard.done(task.id, 'Егор (нейронка)')
    await DevBoard.rateItem(task.id, 3, 'Миша')
    await DevBoard.rateItem(task.id, 1, 'Миша')
    expect(await DevBoard.scores()).toEqual([{ who: 'Егор', total: 1 }])
    await DevBoard.rate('Егор', -3, 'пытался сам поставить оценку', 'доска')
    expect(await DevBoard.scores()).toEqual([{ who: 'Егор', total: -2 }])
  })

  it('неготовое не оценивается', async () => {
    const task = await DevBoard.addTask('рано', 'Миша')
    await expect(DevBoard.rateItem(task.id, 1, 'Миша')).rejects.toMatchObject({ statusCode: 409 })
  })
})
