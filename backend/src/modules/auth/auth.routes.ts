import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthService } from './auth.service'
import { RegisterSchema, LoginSchema } from './auth.schemas'
import { authenticate } from '../../shared/security/auth-middleware'

const AUTH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
    },
  },
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/register', AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
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

  fastify.post('/logout', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, jti } = req.authUser
    await AuthService.logout(jti, userId)
    return reply.send({ message: 'Logged out' })
  })

  fastify.get('/me', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ userId: req.authUser.userId })
  })
}
