import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthService } from './auth.service'
import { RegisterSchema, LoginSchema, ForgotPasswordSchema, ResetPasswordSchema, POLICY_REQUIRED } from './auth.schemas'
import { PasswordResetService } from './password-reset.service'
import { RegistrationGuard } from './registration-guard'
import { env } from '../../config/env'
import { authenticate } from '../../shared/security/auth-middleware'

const AUTH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
    },
  },
}

// Заявок на сброс — не больше пяти за четверть часа с адреса: иначе
// бот администрации завалят по чужим логинам.
const RESET_RATE_LIMIT = { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/register', AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors
      if (fields.acceptPolicy) return reply.code(422).send({ code: 'GEN_001', message: POLICY_REQUIRED, details: fields })
      return reply.code(422).send({
        code: 'GEN_001',
        message: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
    }

    const result = await AuthService.register(parsed.data, req.ip, req.headers['user-agent'])
    return reply.code(201).send(result)
  })

  fastify.post('/login', AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({
        code: 'GEN_001',
        message: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
    }

    const { userId, jti, login } = await AuthService.login(
      parsed.data,
      req.ip,
      req.headers['user-agent'],
    )

    const token = fastify.jwt.sign(
      { sub: userId, jti, login },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' },
    )

    return reply.send({ token, userId, login })
  })

  // Что показать на странице регистрации: ключ капчи (публичный) или ничего.
  fastify.get('/config', async (_req, reply) => reply.send({ captchaClientKey: env.SMARTCAPTCHA_CLIENT_KEY ?? null }))

  fastify.post('/password/forgot', RESET_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ForgotPasswordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Укажите логин или почту' })
    await RegistrationGuard.checkCaptcha(parsed.data.captchaToken, req.ip)
    return reply.send(await PasswordResetService.request(parsed.data.login, req.ip))
  })

  fastify.post('/password/reset', AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ResetPasswordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Пароль — от 6 до 100 символов' })
    return reply.send(await PasswordResetService.reset(parsed.data.token, parsed.data.password))
  })

  fastify.post('/logout', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, jti } = req.authUser
    await AuthService.logout(jti, userId)
    return reply.send({ message: 'Logged out' })
  })

  fastify.get('/me', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ userId: req.authUser.userId })
  })
}
