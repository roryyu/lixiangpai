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

  const setting = await prisma.systemSetting.findUnique({
    where: { key },
  })

  if (!setting) {
    throw createError({
      statusCode: 404,
      message: '设置不存在',
    })
  }

  return { setting }
})
