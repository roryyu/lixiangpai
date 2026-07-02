import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'
import { saveUploadedFile, validateImageFile, validateFileSize, RESULT_DIR } from '../../utils/upload'
import { recognizeImage } from '../../utils/recognition'

// 简单的 sleep 辅助函数
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const formData = await readFormData(event)
  const imageFile = formData.get('image') as File
  const taskName = (formData.get('name') as string) || '图片识别任务'

  // 验证文件
  if (!imageFile) {
    throw createError({
      statusCode: 400,
      message: '请上传图片文件',
    })
  }

  if (!validateImageFile(imageFile.name)) {
    throw createError({
      statusCode: 400,
      message: '不支持的图片格式，支持 PNG/JPG/BMP/TIFF/WEBP',
    })
  }

  if (!validateFileSize(imageFile.size, 50 * 1024 * 1024)) {
    throw createError({
      statusCode: 400,
      message: '文件大小不能超过 50MB',
    })
  }

  // 保存上传文件
  const imagePath = await saveUploadedFile(imageFile)

  // 创建任务
  const task = await prisma.task.create({
    data: {
      userId: user.userId,
      name: taskName,
      status: 'PENDING',
      progress: 0,
      message: '任务已创建，等待处理...',
      inputData: JSON.stringify({
        imagePath,
        originalName: imageFile.name,
        fileSize: imageFile.size,
      }),
    },
  })

  // 异步执行识别任务
  executeRecognitionTask(task.id, imagePath)

  return {
    success: true,
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      progress: task.progress,
      message: task.message,
      createdAt: task.createdAt,
    },
  }
})

/**
 * 异步执行识别任务，分阶段更新进度
 */
async function executeRecognitionTask(taskId: string, imagePath: string) {
  let logs: string[] = []
  async function consoleLog(msg: string) {
      console.log(msg)
      logs.push(msg)
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          progress: logs.length,
          message: logs.join('\n'),
        },
      })
  }
  try {
    // 更新为 RUNNING
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        progress: 0,
        message: '任务启动...',
      },
    })
    // 执行实际识别
    const result = await recognizeImage(imagePath, {
      outputDir: RESULT_DIR,
    },consoleLog)

    if (!result.success) {
      throw new Error(result.error || '识别失败')
    }

    // 完成
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        message: '识别完成',
        outputData: JSON.stringify(result.result),
        completedAt: new Date(),
      },
    })

  } catch (error) {
    console.error('任务执行失败:', error)
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'FAILED',
        progress: 0,
        message: '任务执行失败',
        errorMsg: error instanceof Error ? error.message : '未知错误',
        completedAt: new Date(),
      },
    })
  }
}
