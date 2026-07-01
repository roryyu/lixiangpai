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

  const { key } = getRouterParams(event)

  await prisma.systemSetting.delete({
    where: { key },
  })

  return { success: true }
})
