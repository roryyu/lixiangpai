import { prisma } from '../../utils/prisma'
import { getUserFromToken } from '../../utils/auth'
import { saveUploadedFile, validateImageFile, validateFileSize, RESULT_DIR,uploadToOSSAndSaveRecord,uploadToOSSbyUrl } from '../../utils/upload'
import { recognizeImage } from '../../utils/recognition'
import { callQwenDoc,generateImage } from '../../utils/recognition/qwen'
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
  const continueTask = formData.get('continue') as string
  if(continueTask){
    const taskid = formData.get('taskid') as string
    const imagePath = formData.get('imagePath') as string
    const userRequirement = formData.get('userRequirement') as string
    executeRecognitionTask(taskid, imagePath, userRequirement)
    return {
      success: true
    }
  }
  const imageFile = formData.get('image') as File
  const userRequirement=formData.get('name') as string


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
  const getTaskName= await callQwenDoc(userRequirement,'请根据用户需求，生成一个任务名称，格式是【谁的什么事情】，任务名称不能超过10个字符，仅返回任务名')
  const taskName = getTaskName.rawText.trim()
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
        userRequirement,
        originalName: imageFile.name,
        fileSize: imageFile.size,
      }),
    },
  })
  console.log('@@@@@@@@@@@@@@@taskid',task.id)
  // 异步执行识别任务
  executeRecognitionTask(task.id, imagePath,userRequirement)

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
function buildDocPrompt(Result: any, userRequirement:any,taskPrompt:any): string {


  return `
# 任务描述：
${taskPrompt}
# 用户需求如下：
${userRequirement}
# 以下为图纸分析出了结构化的数据。
## 识别规格（按优先级）
### 第一优先：文字标注核对
- 逐个核对上述 OCR 文字，确认每个文字在图中的位置和作用
- 区分：尺寸数字、空间名称、材料说明、标题栏文字、索引符号
- 输出 ocr_verified（已确认）和 ocr_unverified（无法定位）
### 第二优先：几何元素
- 板：用"水平/垂直"描述走向，估算长宽高度（120/200/240/370mm）
- 空间/柜体：名称 + 四至范围
- 其他配饰：名称 + 位置
### 第三优先：尺寸关联
- 把尺寸数字关联到对应的板/空间/柜体
- 例如 "3600" 标注的是哪板/空间/柜体的长宽高度或厚度
## 输出格式
严格输出 JSON（不要包含 markdown 代码块标记），结构如下：
{
  "drawing_info": {
    "title": "图名",
    "scale": "比例",
    "type": "平面图/立面图/剖面图/详图",
    "date": "日期"
  },
  "elements": [
    {
      "id": 1,
      "type": "板|空间/柜体|其他配饰",
      "description": "具体描述",
      "position": "图中位置（用方位词：左上/中/右下等）",
      "properties": {
        "width": "",
        "height": "",
        "material": "",
        "thickness": ""
      },
      "confidence": "high|medium|low"
    }
  ],
  "spaces": [
    {
      "name": "空间/柜体名称",
      "estimated_area": "估算面积",
      "connections": ["相邻空间/柜体"],
      "position": "位置描述"
    }
  ],
  "dimensions": [
    {
      "value": "尺寸值",
      "target": "标注对象",
      "position": "位置"
    }
  ],
  "annotations": [
    {
      "text": "文字内容",
      "type": "label|note|title|index",
      "position": "位置"
    }
  ],
  "ocr_verified": ["已确认的OCR文字列表"],
  "ocr_unverified": ["无法在图中定位的OCR文字列表"],
  "summary": "一句话总结图纸内容"
}
## 数据结果如下：
  ${JSON.stringify(Result)}
`;
}
async function executeRecognitionTask(taskId: string, imagePath: string,userRequirement: string) {
  let logs: string[] = []
  let progressIndex = 0
  async function consoleLog(msg: string) {
      logs.push(msg)
      const message = logs.join('\n\r')
      if(/\[3\/4\]/.test(message)){
        progressIndex = 75
      }else if(/\[2\/4\]/.test(message)){
        progressIndex = 50
      }else if(/\[1\/4\]/.test(message)){
        progressIndex = 25
      }

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          progress: progressIndex<99?progressIndex++:99,
          message: message,
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
    // 生成建议
    await consoleLog('设计分析...')
    //获取prompt
    const systemPrompt = await prisma.promptSetting.findFirst({
      where: {
        module: 'task-system',
      },
    })
    const taskPrompt = await prisma.promptSetting.findFirst({
      where: {
        module: 'task',
      },
    })
    const taskImagePrompt = await prisma.promptSetting.findFirst({
      where: {
        module: 'task-image',
      },
    })
    const getSuggestion= await callQwenDoc(buildDocPrompt(result.result,userRequirement,taskPrompt?.prompt || ''),systemPrompt?.prompt || '')
    const suggestion = getSuggestion.rawText.trim()
    if (result.result) {
      ;(result.result as any).suggestion = suggestion
    }
    await consoleLog('设计分析完成...')
    // 用uploadToOSSAndSaveRecord上传图纸
    await consoleLog('生成效果图...')
    const resultImage = await generateImage(buildDocPrompt(result.result,userRequirement+"\n\r# 修改建议：\n\r"+suggestion,taskImagePrompt?.prompt || '')) 
    //const resultImage = await generateImage('建议：'+suggestion+'\n\r任务：'+taskImagePrompt?.prompt || '')
    // TODO：转存到oss，返回url，并返回bucket和ossKey，更新outputData
    if(resultImage){
      const ossImage = await uploadToOSSbyUrl(resultImage)
      ;(result.result as any).resultImage = ossImage.ossUrl
      ;(result.result as any).resultImageBucket = ossImage.bucket
      ;(result.result as any).resultImageOssKey = ossImage.ossKey
    }
    
    await consoleLog('清理缓存...')
    const imageObj = await uploadToOSSAndSaveRecord(imagePath)
    // 完成
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        message: logs.join('\n\r'),
        inputData: JSON.stringify({
          "userRequirement": userRequirement,
          "bucket": imageObj.bucket, 
          "ossKey": imageObj.ossKey
        }),
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
