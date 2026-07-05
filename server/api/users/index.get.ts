import { prisma } from '../../utils/prisma'
import { getAdminUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return { users }
})
