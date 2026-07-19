import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthService } from './auth.service'
import { RegisterSchema, LoginSchema } from './auth.schemas'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/auth/register
  fastify.post('/register', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({
        code: 'GEN_001',
        message: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
    }

    const ip = req.ip
    const ua = req.headers['user-agent']
    const result = await AuthService.register(parsed.data, ip, ua)
    return reply.code(201).send(result)
  })

  // POST /api/auth/login
  fastify.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({
        code: 'GEN_001',
        message: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      })
    }

    const ip = req.ip
    const ua = req.headers['user-agent']
    const { userId, jti, login } = await AuthService.login(parsed.data, ip, ua)

    // Sign JWT with @fastify/jwt
    const token = fastify.jwt.sign(
      { sub: userId, jti, login },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? '7d' }
    )

    return reply.send({ token, userId, login })
  })

  // POST /api/auth/logout
  fastify.post('/logout', {
    preHandler: authenticate,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, jti } = req.authUser
    await AuthService.logout(jti, userId)
    return reply.send({ message: 'Logged out' })
  })

  // GET /api/auth/me
  fastify.get('/me', {
    preHandler: authenticate,
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ userId: req.authUser.userId })
  })
}
