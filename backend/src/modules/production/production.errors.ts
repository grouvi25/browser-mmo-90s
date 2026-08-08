import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
export const ProductionErrors = { notFound: () => new AppError(ErrorCode.WORK_OBJECT_NOT_FOUND, 'Production object not found', 404) }
