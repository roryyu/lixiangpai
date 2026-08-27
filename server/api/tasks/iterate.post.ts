import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'
import { uploadToOSSbyUrl } from '../../utils/upload'
import { callQwenDoc, generateImageBySize } from '../../utils/recognition/qwen'

export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const body = await readBody(event)
  const { taskId, userMessage, contextSummary } = body

  if (!taskId || !userMessage || !contextSummary) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数: taskId, userMessage, contextSummary',
    })
  }

  // 获取父任务信息
  const parentTask = await prisma.task.findUnique({
    where: { id: taskId },
  })

  if (!parentTask || parentTask.userId !== user.userId) {
    throw createError({
      statusCode: 404,
      message: '父任务不存在或无权限',
    })
  }

  if (parentTask.status !== 'COMPLETED') {
    throw createError({
      statusCode: 400,
      message: '父任务尚未完成，无法进行迭代',
    })
  }

  // 获取图片提示词配置
  const taskImagePrompt = await prisma.promptSetting.findFirst({
    where: { module: 'task-image' },
  })

  // 构建迭代 prompt：上下文 + 新需求
  const iteratePrompt = `
# 背景上下文
${contextSummary}

# 用户新的需求
${userMessage}

# 任务要求
基于以上背景上下文和用户的新需求，生成一张新的室内设计效果图。
请保持与原始设计的整体风格和空间布局一致，同时融入用户新的需求变更。

# 生成指令
${taskImagePrompt?.prompt || ''}
`

  // 同步生成效果图
  const resultImage = await generateImageBySize(iteratePrompt, '2368*1728')

  if (!resultImage) {
    throw createError({
      statusCode: 500,
      message: '效果图生成失败',
    })
  }

  // 上传到 OSS
  const ossImage = await uploadToOSSbyUrl(resultImage)

  // 读取现有的 outputData，追加迭代记录
  const existingOutput = parentTask.outputData ? JSON.parse(parentTask.outputData) : {}
  const iterations = existingOutput.iterations || []

  iterations.push({
    userMessage,
    resultImage: ossImage.ossUrl,
    resultImageBucket: ossImage.bucket,
    resultImageOssKey: ossImage.ossKey,
    createdAt: new Date().toISOString(),
  })

  // 重新压缩上下文：将已有上下文 + 本次迭代需求 + 本次操作结果合并压缩
  let updatedContextSummary = contextSummary
  try {
    const compressPrompt = `
# 已有上下文摘要
${contextSummary}

# 本次迭代操作
- 用户需求：${userMessage}
- 操作结果：已根据需求生成新的效果图

# 要求
请将已有上下文和本次迭代信息合并，压缩为一段简洁的上下文摘要（500字以内），
保留所有关键信息（原始设计概况、所有迭代历史及结果），供后续迭代使用。
直接输出文本，不要使用JSON格式。`
    const compressResult = await callQwenDoc(compressPrompt, '你是一个专业的上下文压缩助手，请精准提炼关键信息。')
    updatedContextSummary = compressResult.rawText.trim()
  } catch (e) {
    console.error('上下文压缩失败，保留原上下文:', e)
  }

  // 更新父任务：保留原始数据，追加 iterations，更新压缩后的上下文
  const updatedOutputData = {
    ...existingOutput,
    contextSummary: updatedContextSummary,
    iterations,
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      outputData: JSON.stringify(updatedOutputData),
      updatedAt: new Date(),
    },
  })

  console.log(`迭代任务 ${taskId} 完成，共 ${iterations.length} 次迭代`)

  // 直接返回结果，前端无需轮询
  return {
    success: true,
    resultImage: ossImage.ossUrl,
    resultImageBucket: ossImage.bucket,
    resultImageOssKey: ossImage.ossKey,
    contextSummary: updatedContextSummary,
  }
})
