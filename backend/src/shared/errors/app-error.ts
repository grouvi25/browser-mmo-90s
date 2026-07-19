import { ErrorCode } from './error-codes'

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly details?: unknown

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  static unauthorized(msg = 'Unauthorized'): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, msg, 401)
  }

  static forbidden(msg = 'Forbidden'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, msg, 403)
  }

  static notFound(entity: string, id?: string): AppError {
    const msg = id ? `${entity} ${id} not found` : `${entity} not found`
    return new AppError(ErrorCode.NOT_FOUND, msg, 404)
  }

  static conflict(msg: string): AppError {
    return new AppError(ErrorCode.CONFLICT, msg, 409)
  }

  static validation(msg: string, details?: unknown): AppError {
    return new AppError(ErrorCode.VALIDATION_ERROR, msg, 422, details)
  }

  static internal(msg = 'Internal server error'): AppError {
    return new AppError(ErrorCode.INTERNAL_ERROR, msg, 500)
  }

  static insufficientFunds(have: number, need: number): AppError {
    return new AppError(
      ErrorCode.INSUFFICIENT_FUNDS,
      `Insufficient funds: have ${have}, need ${need}`,
      400,
      { have, need }
    )
  }
}
