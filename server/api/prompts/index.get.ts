import { prisma } from '../../utils/prisma'
import { getAdminUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

  const prompts = await prisma.promptSetting.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return { prompts }
})
