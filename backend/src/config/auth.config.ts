import { env } from './env'

export const AuthConfig = {
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },
  bcrypt: {
    rounds: env.BCRYPT_ROUNDS,
  },
  session: {
    // Redis TTL in seconds (matches JWT expiry)
    ttl: 60 * 60 * 24 * 7, // 7 days
  },
} as const
