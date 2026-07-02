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
      message: '无权访问此任务',
    })
  }
  //console.log(task)
  return {
    success: true,
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      progress: task.progress,
      message: task.message,
      errorMsg: task.errorMsg,
      inputData: task.inputData ? JSON.parse(task.inputData) : null,
      outputData: task.outputData ? JSON.parse(task.outputData) : null,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  }
})
