import { prisma } from '../../../utils/prisma'
import { getUserFromToken } from '../../../utils/auth'

// 这个接口用于第三方服务回调，通知任务完成或失败
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

  const body = await readBody(event)
  const { status, outputData, errorMsg, progress, message } = body

  const task = await prisma.task.findUnique({
    where: { id: taskId },
  })

  if (!task) {
    throw createError({
      statusCode: 404,
      message: '任务不存在',
    })
  }

  // 更新任务状态
  const updateData: any = {}

  if (status) {
    updateData.status = status
  }
  if (progress !== undefined) {
    updateData.progress = progress
  }
  if (message) {
    updateData.message = message
  }
  if (outputData) {
    updateData.outputData = JSON.stringify(outputData)
  }
  if (errorMsg) {
    updateData.errorMsg = errorMsg
  }
  if (status === 'COMPLETED' || status === 'FAILED') {
    updateData.completedAt = new Date()
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data: updateData,
  })

  return {
    success: true,
    task: {
      id: updatedTask.id,
      status: updatedTask.status,
      progress: updatedTask.progress,
      message: updatedTask.message,
    },
  }
})
