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

  await prisma.promptSetting.delete({
    where: { id },
  })

  return { success: true }
})
