import { z } from 'zod'

export const POLICY_REQUIRED = 'Нужно согласие с политикой обработки персональных данных'

export const RegisterSchema = z.object({
  login: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, digits, underscores'),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  // Согласие с политикой обработки персональных данных обязательно.
  acceptPolicy: z.literal(true, { message: POLICY_REQUIRED }),
  // Ловушка для ботов (скрытое поле формы) и ответ капчи.
  website: z.string().max(200).optional(),
  captchaToken: z.string().max(4000).optional(),
})

export const LoginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

// Восстановление пароля: логин или почта, затем новый пароль по ссылке.
export const ForgotPasswordSchema = z.object({
  login: z.string().trim().min(1).max(120),
  captchaToken: z.string().max(4000).optional(),
})

export const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(6).max(100),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
