import { prisma } from '../../utils/prisma'
import { getAdminUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

  const id = getRouterParam(event, 'id')

  await prisma.promptSetting.delete({
    where: { id },
  })

  return { success: true }
})
