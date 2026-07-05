import { prisma } from '../../utils/prisma'
import { getAdminUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

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
