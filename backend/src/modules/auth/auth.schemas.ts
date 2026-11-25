import { z } from 'zod'
import { Nickname } from '../characters/characters.schemas'

export const POLICY_REQUIRED = 'Нужно принять пользовательское соглашение и ознакомиться с политикой обработки персональных данных'
export const PD_REQUIRED = 'Нужно дать согласие на обработку персональных данных'

export const RegisterSchema = z.object({
  // Регистрация по нику (правка 29.10): ник и есть имя для входа. Отдельный
  // логин латиницей принимается от старых клиентов и автотестов.
  nickname: Nickname.optional(),
  login: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, digits, underscores').optional(),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  // Галочка 1 (Дима 25.11): соглашение и ознакомление с политикой, обязательна.
  acceptPolicy: z.literal(true, { message: POLICY_REQUIRED }),
  // Галочка 2: согласие на обработку персональных данных, обязательна и отдельна.
  acceptPd: z.literal(true, { message: PD_REQUIRED }),
  // Рассылки — отдельное согласие по желанию, по умолчанию его нет (24.11).
  marketingConsent: z.boolean().optional(),
  // Ловушка для ботов (скрытое поле формы) и ответ капчи.
  website: z.string().max(200).optional(),
  captchaToken: z.string().max(4000).optional(),
  // Телефон по желанию (документы 08.11): 10–15 цифр, можно с +, пробелами, скобками и дефисами.
  phone: z.string().max(32).optional().transform(v => (v ?? '').trim())
    .refine(v => v === '' || /^\+?[\d\s()-]{10,24}$/.test(v) && v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 15, 'Телефон: 10–15 цифр, например +7 900 123-45-67'),
  // Ник пригласившего из реферальной ссылки ?ref=.
  ref: z.string().max(64).optional(),
  // Откуда пришёл (метки первой ссылки и сайт-источник). Кривые данные не мешают регистрации.
  attribution: z.object({
    utmSource: z.string().max(300), utmMedium: z.string().max(300), utmCampaign: z.string().max(300),
    utmContent: z.string().max(300), utmTerm: z.string().max(300), referrer: z.string().max(500), landing: z.string().max(500),
  }).partial().optional().catch(undefined),
}).refine(data => !!(data.nickname || data.login), { message: 'Укажите ник', path: ['nickname'] })

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
