import bcrypt from 'bcrypt'
import { AuthConfig } from '../../config/auth.config'

// bcrypt (native) — uses libuv thread pool, does NOT block event loop
// Critical for performance: bcryptjs (pure JS) was blocking at 30+ concurrent requests

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, AuthConfig.bcrypt.rounds)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
