import { z } from 'zod'
import { getUserFromToken } from '../../utils/auth'
import { prisma } from '../../utils/prisma'

export default defineEventHandler(async (event) => {
  const user = await getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未登录',
    })
  }

  const histories = await prisma.history.findMany({
    where: {
      userId: user.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return histories
})
