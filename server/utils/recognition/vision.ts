import path from 'path'
import { config } from './config'
import { createQwenClient, callQwenVL, buildRecognitionPrompt, buildRoughPrompt, buildRefinePrompt, parseQwenJson, sleep } from './qwen'
import { imageToBase64, splitImage } from './image'
import type { OcrResult, OcrWord } from './ocr'

export interface VisionResult {
  result: any
  usage?: { total_tokens: number }
  rawText: string
  mode: 'single' | 'two-pass' | 'tiled'
  tileCount?: number
  roughResult?: any
}

/**
 * Step 3: Qwen-VL 视觉识别
 */
export async function visionStep(imagePath: string, ocrResult: OcrResult): Promise<VisionResult> {
  console.log('[3/4] Qwen-VL-Max 视觉识别...')

  if (!config.dashscopeApiKey) {
    console.log('  ⚠ DASHSCOPE_API_KEY 未配置，返回模拟结果')
    return getMockVisionResult()
  }

  const client = createQwenClient()

  // 根据配置选择识别策略
  if (config.tile.enabled) {
    return await visionStepTiled(client, imagePath, ocrResult)
  } else if (config.twoPass.enabled) {
    return await visionStepTwoPass(client, imagePath, ocrResult)
  } else {
    return await visionStepSingle(client, imagePath, ocrResult)
  }
}

/**
 * 模式 A: 单轮识别
 */
async function visionStepSingle(
  client: ReturnType<typeof createQwenClient>,
  imagePath: string,
  ocrResult: OcrResult
): Promise<VisionResult> {
  console.log('  模式: 单轮识别')

  const { data, mediaType } = await imageToBase64(imagePath)
  const prompt = buildRecognitionPrompt(ocrResult)

  const response = await callQwenVL(client, data, mediaType, prompt)
  const parsed = parseQwenJson(response.rawText)

  console.log(`  ✓ 完成，token: ${response.usage?.total_tokens || '?'}`)

  return {
    result: parsed || { raw: response.rawText },
    usage: response.usage,
    rawText: response.rawText,
    mode: 'single',
  }
}

/**
 * 模式 B: 两轮精化识别
 */
async function visionStepTwoPass(
  client: ReturnType<typeof createQwenClient>,
  imagePath: string,
  ocrResult: OcrResult
): Promise<VisionResult> {
  console.log('  模式: 两轮精化')

  const { data, mediaType } = await imageToBase64(imagePath)

  // 第一轮：粗识别
  console.log('  [3.1] 第一轮粗识别...')
  const pass1 = await callQwenVL(client, data, mediaType, buildRoughPrompt(), { temperature: 0.2 })
  const roughResult = parseQwenJson(pass1.rawText) || {}
  console.log(`  ✓ 第一轮完成，token: ${pass1.usage?.total_tokens || '?'}`)

  await sleep(300)

  // 第二轮：精识别（带第一轮上下文）
  console.log('  [3.2] 第二轮精化识别...')
  const refinePrompt = buildRefinePrompt(ocrResult, roughResult)
  const pass2 = await callQwenVL(client, data, mediaType, refinePrompt)
  const parsed = parseQwenJson(pass2.rawText)

  const totalTokens = (pass1.usage?.total_tokens || 0) + (pass2.usage?.total_tokens || 0)
  console.log(`  ✓ 第二轮完成，总 token: ${totalTokens}`)

  return {
    result: parsed || { raw: pass2.rawText },
    usage: { total_tokens: totalTokens },
    rawText: pass2.rawText,
    roughResult,
    mode: 'two-pass',
  }
}

/**
 * 模式 C: 分块识别 + 合并
 */
async function visionStepTiled(
  client: ReturnType<typeof createQwenClient>,
  imagePath: string,
  ocrResult: OcrResult
): Promise<VisionResult> {
  console.log(`  模式: 分块识别 (${config.tile.size}px, 重叠${config.tile.overlap})`)

  const tiles = await splitImage(imagePath, config.tile.size, config.tile.overlap)
  console.log(`  分为 ${tiles.length} 块`)

  const tileResults = []

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    console.log(`  [3.${i + 1}/${tiles.length}] 识别第 ${i + 1} 块 (${tile.width}x${tile.height})...`)

    // 提取该块区域内的 OCR 文字
    const localOcr = filterOcrByRegion(ocrResult, tile)

    const { data, mediaType } = await imageToBase64(tile.path)
    const prompt = buildRecognitionPrompt(localOcr)

    const response = await callQwenVL(client, data, mediaType, prompt)
    const parsed = parseQwenJson(response.rawText)

    tileResults.push({
      result: parsed || {},
      tile,
      usage: response.usage,
    })

    // 限流
    if (i < tiles.length - 1) {
      await sleep(config.tile.requestDelay)
    }
  }

  // 合并结果
  const merged = mergeTileResults(tileResults)
  const totalTokens = tileResults.reduce((sum, r) => sum + (r.usage?.total_tokens || 0), 0)

  console.log(`  ✓ 全部完成，总 token: ${totalTokens}`)

  return {
    result: merged,
    usage: { total_tokens: totalTokens },
    rawText: JSON.stringify(merged),
    tileCount: tiles.length,
    mode: 'tiled',
  }
}

/**
 * 过滤指定区域内的 OCR 文字
 */
function filterOcrByRegion(ocrResult: OcrResult, tile: { x: number; y: number; width: number; height: number }): OcrResult {
  const words = (ocrResult?.allWords || []).filter((w) => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2
    const cy = (w.bbox.y0 + w.bbox.y1) / 2
    return cx >= tile.x && cx <= tile.x + tile.width && cy >= tile.y && cy <= tile.y + tile.height
  })

  // 坐标偏移到 tile 局部坐标系
  const localWords = words.map((w) => ({
    ...w,
    bbox: {
      x0: w.bbox.x0 - tile.x,
      y0: w.bbox.y0 - tile.y,
      x1: w.bbox.x1 - tile.x,
      y1: w.bbox.y1 - tile.y,
    },
  }))

  return {
    ...ocrResult,
    allWords: localWords,
    fullText: localWords.map((w) => w.text).join(' '),
  }
}

/**
 * 合并分块识别结果（去重）
 */
function mergeTileResults(tileResults: any[]) {
  const allElements = []
  const allDimensions = []
  const allAnnotations = []
  const allRooms = []
  const ocrVerified = new Set<string>()
  const ocrUnverified = new Set<string>()
  const seen = new Set<string>()

  for (const { result, tile } of tileResults) {
    // 合并元素
    for (const el of result.elements || []) {
      const key = `${el.type}:${el.description}:${el.position}`
      if (!seen.has(key)) {
        seen.add(key)
        allElements.push({ ...el, _tile: tile.index })
      }
    }

    // 合并尺寸
    for (const dim of result.dimensions || []) {
      const key = `dim:${dim.value}:${dim.target}`
      if (!seen.has(key)) {
        seen.add(key)
        allDimensions.push(dim)
      }
    }

    // 合并标注
    for (const ann of result.annotations || []) {
      allAnnotations.push(ann)
    }

    // 合并房间
    for (const room of result.spaces || []) {
      const key = `room:${room.name}:${room.position}`
      if (!seen.has(key)) {
        seen.add(key)
        allRooms.push(room)
      }
    }

    // 合并 OCR 校验
    for (const t of result.ocr_verified || []) ocrVerified.add(t)
    for (const t of result.ocr_unverified || []) ocrUnverified.add(t)
  }

  return {
    drawing_info: tileResults[0]?.result?.drawing_info || {},
    elements: allElements,
    spaces: allRooms,
    dimensions: allDimensions,
    annotations: allAnnotations,
    ocr_verified: [...ocrVerified],
    ocr_unverified: [...ocrUnverified],
    summary: tileResults.map((r) => r.result?.summary).filter(Boolean).join(' | '),
  }
}

/**
 * 模拟视觉识别结果（API Key 未配置时使用）
 */
function getMockVisionResult(): VisionResult {
  return {
    result: {
      drawing_info: {
        title: 'CAD 设计稿识别结果',
        type: '建筑图纸',
        unit: 'mm',
      },
      elements: [
        {
          type: 'wall',
          description: '主要墙体结构',
          position: '四周',
          properties: { thickness: '200mm', material: '混凝土' },
          confidence: 'high',
        },
      ],
      spaces: [
        {
          name: '客厅',
          position: '中心区域',
          function: '会客、娱乐',
          estimated_area: '约 30㎡',
        },
      ],
      dimensions: [
        { value: '3000', target: '客厅宽度', position: '水平标注' },
        { value: '4500', target: '客厅长度', position: '垂直标注' },
      ],
      annotations: [],
      ocr_verified: [],
      ocr_unverified: [],
      summary: '识别完成：包含主要墙体结构和客厅区域',
    },
    usage: { total_tokens: 0 },
    rawText: JSON.stringify({}),
    mode: 'single',
  }
}
