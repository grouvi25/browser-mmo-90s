import { z } from 'zod'

/** Ник персонажа: он же имя для входа (правка 29.10). Пробелы по краям
 *  срезаются, двойные — схлопываются, чтобы «Вася» и «Вася » не были разными. */
export const Nickname = z.string()
  .transform(value => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(2, 'Ник — от 2 знаков').max(30, 'Ник — до 30 знаков').regex(/^[a-zA-Zа-яА-ЯёЁ0-9 _-]+$/, 'В нике — только буквы, цифры, пробел, _ и -'))

export const CreateCharacterSchema = z.object({
  // Пусто — берётся ник, выбранный при регистрации.
  nickname: Nickname.optional(),
  archetype: z.enum([
    'ATHLETE', 'WORKER', 'SHUTTLE', 'VETERAN',
    'STREET', 'MERCHANT', 'STUDENT', 'RESOLVER',
  ]),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
})

export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>
