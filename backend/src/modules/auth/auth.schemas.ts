import { z } from 'zod'

export const POLICY_REQUIRED = 'Нужно согласие с политикой обработки персональных данных'

export const RegisterSchema = z.object({
  login: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, digits, underscores'),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  // Согласие с политикой обработки персональных данных обязательно.
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: POLICY_REQUIRED }) }),
})

export const LoginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
