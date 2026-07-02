import path from 'path'
import fs from 'fs'
import { preprocessImage, ensureDir, saveFile } from './image'
import { ocrStep } from './ocr'
import { visionStep } from './vision'
import { postprocessStep } from './postprocess'

export interface RecognitionOptions {
  outputDir?: string
  tileEnabled?: boolean
  twoPassEnabled?: boolean
  ocrEngine?: string
}


/**
 * 完整的图片识别流程
 */
export async function recognizeImage(imagePath: string, options: RecognitionOptions = {}, consoleLog: (msg: string) => void) {
  const startTime = Date.now()
  const baseName = path.basename(imagePath, path.extname(imagePath))

  // 准备输出目录
  const outputDir = options.outputDir || path.join(path.dirname(imagePath), 'results')
  ensureDir(outputDir)

  try {
    // Step 1: 图片预处理
    consoleLog(`[1/4] 图纸预处理...`) 
    const preprocessResult = await preprocessImage(imagePath, path.join(outputDir, baseName),consoleLog)

    // Step 2: OCR 文字提取
    const ocrResult = await ocrStep(preprocessResult.binaryPath)

    // Step 3: Qwen-VL 视觉识别
    const visionResult = await visionStep(preprocessResult.preprocessedPath, ocrResult)

    // Step 4: 后处理与结构化
    const finalResult = postprocessStep(ocrResult, visionResult, preprocessResult.metadata)

    // 保存结果
    const resultPath = path.join(outputDir, `${baseName}.result.json`)
    saveFile(resultPath, finalResult)

    const elapsed = (Date.now() - startTime) / 1000
    consoleLog(`识别完成，耗时 ${elapsed.toFixed(1)}s`)

    return {
      success: true,
      elapsed: `${elapsed.toFixed(1)}s`,
      result: finalResult,
      resultFile: resultPath,
    }
  } catch (error) {
    console.error('识别失败:', (error as Error).message)
    return {
      success: false,
      error: (error as Error).message,
    }
  }
}

export * from './config'
export * from './image'
export * from './ocr'
export * from './vision'
export * from './postprocess'
