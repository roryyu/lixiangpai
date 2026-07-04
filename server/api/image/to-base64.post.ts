import fs from 'fs/promises'
import path from 'path'
import { getUserFromToken } from '../../utils/auth'
import { UPLOAD_DIR, RESULT_DIR } from '../../utils/upload'

export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const body = await readBody(event)
  const imagePath = body.path as string

  if (!imagePath) {
    throw createError({
      statusCode: 400,
      message: '图片路径是必需参数',
    })
  }

  const absolutePath = path.resolve(imagePath)
  const allowedDirs = [UPLOAD_DIR, RESULT_DIR]
  const isAllowed = allowedDirs.some(dir => absolutePath.startsWith(dir))

  if (!isAllowed) {
    throw createError({
      statusCode: 403,
      message: '不允许访问该路径',
    })
  }

  try {
    const imageBuffer = await fs.readFile(absolutePath)
    const base64 = imageBuffer.toString('base64')

    return {
      success: true,
      base64: `data:image/jpeg;base64,${base64}`,
    }
  } catch (error) {
    throw createError({
      statusCode: 404,
      message: '图片文件不存在或无法读取',
    })
  }
})
