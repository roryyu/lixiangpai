import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../../utils/prisma'

const forgotPasswordSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, forgotPasswordSchema.parse)

  const user = await prisma.user.findUnique({
    where: { email: body.email },
  })

  if (!user) {
    return { message: '如果该邮箱已注册，您将收到重置密码邮件' }
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma.passwordReset.create({
    data: {
      email: body.email,
      token,
      expiresAt,
    },
  })

  // TODO: Send email with reset link
  // In production, send an email with the link: `${process.env.AUTH_ORIGIN}/reset-password?token=${token}`
  console.log(`Password reset token for ${body.email}: ${token}`)

  return { message: '如果该邮箱已注册，您将收到重置密码邮件' }
})
