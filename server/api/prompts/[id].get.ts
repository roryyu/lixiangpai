import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const payload = getUserFromToken(event)
  if (!payload) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const id = getRouterParam(event, 'id')

  const prompt = await prisma.promptSetting.findUnique({
    where: { id },
  })

  if (!prompt) {
    throw createError({
      statusCode: 404,
      message: 'Prompt 不存在',
    })
  }

  return { prompt }
})
