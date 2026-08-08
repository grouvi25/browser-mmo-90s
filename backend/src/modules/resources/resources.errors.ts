import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
export const ResourcesErrors = { conflict: (message: string) => new AppError(ErrorCode.CONFLICT, message, 409) }
