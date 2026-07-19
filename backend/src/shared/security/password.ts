import bcrypt from 'bcryptjs'
import { AuthConfig } from '../../config/auth.config'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, AuthConfig.bcrypt.rounds)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
