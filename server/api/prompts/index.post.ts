import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'

const promptSchema = z.object({
  module: z.string().optional(),
  prompt: z.string().optional(),
  info: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const payload = getUserFromToken(event)
  if (!payload) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const body = await readValidatedBody(event, promptSchema.parse)

  const prompt = await prisma.promptSetting.create({
    data: {
      module: body.module,
      prompt: body.prompt,
      info: body.info,
    },
  })

  return { prompt }
})
