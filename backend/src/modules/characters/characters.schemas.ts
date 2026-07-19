import { z } from 'zod'

export const CreateCharacterSchema = z.object({
  nickname: z.string().min(2).max(30).regex(/^[a-zA-Zа-яА-Я0-9 _-]+$/, 'Invalid characters'),
  archetype: z.enum([
    'ATHLETE', 'WORKER', 'SHUTTLE', 'VETERAN',
    'STREET', 'MERCHANT', 'STUDENT', 'RESOLVER',
  ]),
})

export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>
