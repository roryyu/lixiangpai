import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'

const settingSchema = z.object({
  key: z.string().min(1, 'key 不能为空'),
  value: z.string().min(1, 'value 不能为空'),
})

export default defineEventHandler(async (event) => {
  const payload = getUserFromToken(event)
  if (!payload) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const body = await readValidatedBody(event, settingSchema.parse)

  const setting = await prisma.systemSetting.upsert({
    where: { key: body.key },
    update: { value: body.value },
    create: { key: body.key, value: body.value },
  })

  return { setting }
})
