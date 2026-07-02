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

  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({
      statusCode: 400,
      message: '任务ID不能为空',
    })
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
  })

  if (!task) {
    throw createError({
      statusCode: 404,
      message: '任务不存在',
    })
  }

  // 验证任务归属
  if (task.userId !== user.userId) {
    throw createError({
      statusCode: 403,
      message: '无权删除此任务',
    })
  }

  // 删除任务
  await prisma.task.delete({
    where: { id: taskId },
  })

  return {
    success: true,
    message: '删除成功',
  }
})
