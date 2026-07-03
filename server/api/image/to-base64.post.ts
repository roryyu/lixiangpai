import fs from 'fs/promises'
import path from 'path'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const imagePath = body.path as string

  if (!imagePath) {
    throw createError({
      statusCode: 400,
      message: '图片路径是必需参数',
    })
  }

  try {
    const absolutePath = path.resolve(imagePath)
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
