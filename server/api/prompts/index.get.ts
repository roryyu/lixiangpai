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

  const prompts = await prisma.promptSetting.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return { prompts }
})
