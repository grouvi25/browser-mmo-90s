import { prisma } from '../../shared/db/prisma'
export const WorkRepository = { prisma: () => prisma.workShift }
