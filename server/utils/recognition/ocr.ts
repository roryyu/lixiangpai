import { config } from './config'

export interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  type?: 'dimension' | 'label'
}

export interface OcrResult {
  allWords: OcrWord[]
  dimensions: OcrWord[]
  labels: OcrWord[]
  fullText: string
  engine: string
}

/**
 * Step 2: OCR 文字提取（简化版）
 * 由于服务端安装 Tesseract/PaddleOCR 较复杂，这里先提供接口框架
 * 实际部署时可以：
 * 1. 调用外部 OCR 服务（如阿里云 OCR、百度 OCR）
 * 2. 部署独立的 OCR 服务并通过 HTTP 调用
 * 3. 安装 tesseract.js（需要系统依赖）
 */
export async function ocrStep(imagePath: string): Promise<OcrResult> {
  console.log('[2/4] OCR 文字提取...')
  console.log(`  引擎: ${config.ocr.engine}`)

  // 简化版本：返回空的 OCR 结果
  // 实际项目中根据需要实现具体的 OCR 逻辑
  const mockWords: OcrWord[] = []

  console.log(`  ✓ 识别到 ${mockWords.length} 个文字区域`)

  return {
    allWords: mockWords,
    dimensions: [],
    labels: [],
    fullText: '',
    engine: config.ocr.engine,
  }
}

/**
 * 通过 HTTP 调用 PaddleOCR 服务
 */
async function ocrWithPaddle(imagePath: string): Promise<{ words: OcrWord[]; fullText: string }> {
  const fs = await import('fs')
  const path = await import('path')

  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = path.extname(imagePath).toLowerCase().slice(1)
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    bmp: 'image/bmp',
  }

  const formData = new FormData()
  formData.append('image', base64)
  formData.append('mime_type', mimeMap[ext] || 'image/png')
  formData.append('lang', 'ch')

  const resp = await fetch(config.ocr.paddleUrl, {
    method: 'POST',
    body: formData,
  })

  if (!resp.ok) {
    throw new Error(`PaddleOCR 服务错误: ${resp.status}`)
  }

  const data = await resp.json()

  const words = (data.results || []).map((item: any) => ({
    text: item.text,
    confidence: item.confidence * 100,
    bbox: {
      x0: item.bbox[0][0],
      y0: item.bbox[0][1],
      x1: item.bbox[2][0],
      y1: item.bbox[2][1],
    },
  }))

  return { words, fullText: words.map((w: OcrWord) => w.text).join(' ') }
}

/**
 * 分类 OCR 结果：尺寸数字 vs 文字标注
 */
export function classifyOcrWords(words: OcrWord[]) {
  const dimensions = words
    .filter((w) => /^\d+([xX×]\d+)?$/.test(w.text))
    .map((w) => ({ ...w, type: 'dimension' as const }))

  const labels = words
    .filter((w) => !/^\d+([xX×]\d+)?$/.test(w.text))
    .map((w) => ({ ...w, type: 'label' as const }))

  return { dimensions, labels }
}
