import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const query = getQuery(event)
  const { status, page = 1, limit = 20 } = query

  const where: any = {
    userId: user.userId,
  }

  if (status) {
    where.status = status
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit),
  })

  const total = await prisma.task.count({ where })

  return {
    success: true,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      progress: task.progress,
      message: task.message,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / Number(limit)),
    },
  }
})
