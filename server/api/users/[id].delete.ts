import { prisma } from '../../utils/prisma'
import { getAdminUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const currentUser = await getAdminUser(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      message: '用户ID不能为空',
    })
  }

  if (id === currentUser.id) {
    throw createError({
      statusCode: 400,
      message: '不能删除自己的账号',
    })
  }

  const existingUser = await prisma.user.findUnique({
    where: { id },
  })

  if (!existingUser) {
    throw createError({
      statusCode: 404,
      message: '用户不存在',
    })
  }

  await prisma.user.delete({
    where: { id },
  })

  return { success: true }
})
