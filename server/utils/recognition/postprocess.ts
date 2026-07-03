import { config } from './config'

import type { VisionResult } from './vision'
import { createQwenClient, callQwenVL, buildRecognitionPrompt, buildRoughPrompt, buildRefinePrompt, parseQwenJson, sleep } from './qwen'
/**
 * Step 4: 后处理 — 合并 OCR 与视觉结果，校验，结构化输出
 */
export async function postprocessStep(ocrResult: any, visionResult: VisionResult, metadata: any, consoleLog: (msg: string) => void) {
  

  const { result } = visionResult
  const issues: string[] = []

  // ---- 1. 尺寸补充：Qwen 常遗漏尺寸标注 ----
  await consoleLog('- 尺寸补充...')
  const ocrDims = ocrResult.dimensions || []
  const visionDims = result.dimensions || []
  const missingDims = ocrDims.filter((od) => !visionDims.some((vd: any) => vd.value === od.text || vd.value?.includes(od.text)))

  if (missingDims.length > 0) {
    issues.push(`大模型遗漏 ${missingDims.length} 个尺寸标注，已从 OCR 补充`)
    result.dimensions = [
      ...visionDims,
      ...missingDims.map((d) => ({
        value: d.text,
        target: 'OCR补充（未关联到具体元素）',
        position: `(${d.bbox?.x0 || 0},${d.bbox?.y0 || 0})`,
        source: 'ocr_fallback',
      })),
    ]
  }

  // ---- 2. 置信度重评估：Qwen 常虚标 high ----
  await consoleLog('- 置信度重评估...')
  const elements = result.elements || []
  let downgraded = 0
  for (const el of elements) {
    if (el.confidence === 'high') {
      const hasProps =
        el.properties && Object.values(el.properties).some((v) => v && v.toString().trim().length > 0)
      const hasDesc = el.description && el.description.length >= config.postprocess.confidenceDescMinLength

      if (!hasProps || !hasDesc) {
        el.confidence = 'medium'
        el._downgraded = true
        downgraded++
      }
    }
  }
  if (downgraded > 0) {
    issues.push(`${downgraded} 个元素置信度从 high 降级为 medium`)
  }

  // ---- 3. 尺寸校验：工程常识范围检查 ----
  await consoleLog('- 尺寸校验...')
  const dimensionChecks = []
  for (const dim of result.dimensions || []) {
    const value = parseFloat(dim.value)
    if (isNaN(value)) continue

    let valid = true
    let note = ''

    if (value < config.postprocess.dimensionMin) {
      note = `尺寸过小 (${value}mm < ${config.postprocess.dimensionMin}mm)，可能是标注错误或单位问题`
      valid = false
    } else if (value > config.postprocess.dimensionMax) {
      note = `尺寸过大 (${value}mm > ${config.postprocess.dimensionMax}mm)，请确认单位`
      valid = false
    }

    dimensionChecks.push({ value: dim.value, valid, note })
  }

  const invalidDims = dimensionChecks.filter((d) => !d.valid)
  if (invalidDims.length > 0) {
    issues.push(`${invalidDims.length} 个尺寸标注超出合理范围`)
  }

  // ---- 4. 面积交叉计算 ----
  await consoleLog('- 面积交叉计算...')
  if (result.spaces && result.dimensions) {
    for (const room of result.spaces) {
      const relatedDims = findRelatedDimensions(room, result.dimensions)
      if (relatedDims.length >= 2) {
        const nums = relatedDims.map((d) => parseFloat(d.value)).filter((n) => !isNaN(n))
        if (nums.length >= 2) {
          // 假设前两个数字是长和宽（mm → m）
          const [l, w] = nums.sort((a, b) => b - a).map((n) => n / 1000)
          const area = (l * w).toFixed(2)
          room._calculated_area = `${area}㎡`
          room.estimated_area = `${area}㎡ (基于尺寸 ${relatedDims.map((d) => d.value).join('×')} 计算)`
        }
      }
    }
  }

  // ---- 5. OCR 覆盖率统计 ----
  await consoleLog('- OCR 覆盖率统计...')
  const ocrTotal = (ocrResult.allWords || []).length
  const ocrVerifiedCount = (result.ocr_verified || []).length
  const ocrCoverage = ocrTotal > 0 ? ((ocrVerifiedCount / ocrTotal) * 100).toFixed(1) : 'N/A'

  // ---- 6. 置信度统计 ----
  await consoleLog('- 置信度统计...')
  const confidenceStats = {
    high: elements.filter((e) => e.confidence === 'high').length,
    medium: elements.filter((e) => e.confidence === 'medium').length,
    low: elements.filter((e) => e.confidence === 'low').length,
  }

  // ---- 7. 构建最终输出 ----
  await consoleLog('- 构建最终输出...')
  const finalResult = {
    _meta: {
      model: config.qwen.model,
      mode: visionResult.mode || 'unknown',
      processedAt: new Date().toISOString(),
      imageWidth: metadata?.processedWidth,
      imageHeight: metadata?.processedHeight,
      originalWidth: metadata?.originalWidth,
      originalHeight: metadata?.originalHeight,
      tileCount: visionResult.tileCount || 1,
      totalTokens: visionResult.usage?.total_tokens || 0,
    },
    _quality: {
      confidenceStats,
      ocrCoverage: `${ocrCoverage}%`,
      ocrTotalWords: ocrTotal,
      ocrVerifiedWords: ocrVerifiedCount,
      ocrFallbackDims: missingDims.length,
      downgradedElements: downgraded,
      dimensionChecks,
      issues,
    },
    drawing_info: result.drawing_info || {},
    elements,
    spaces: result.spaces || [],
    dimensions: result.dimensions || [],
    annotations: result.annotations || [],
    ocr_verified: result.ocr_verified || [],
    ocr_unverified: result.ocr_unverified || [],
    summary: result.summary || '',
  }
  //console.log(finalResult)
  //console.log(confidenceStats)
  //console.log(result)
  // ---- 打印摘要 ----
  await consoleLog(`  ✓ 元素: ${elements.length} 个 (高:${confidenceStats.high} 中:${confidenceStats.medium} 低:${confidenceStats.low})`)
  await consoleLog(`  ✓ 空间: ${(result.spaces || []).length} 个`)
  await consoleLog(`  ✓ 尺寸: ${(result.dimensions || []).length} 个`)
  await consoleLog(`  ✓ OCR 覆盖率: ${ocrCoverage}%`)
  await consoleLog(`  ✓ Token 用量: ${finalResult._meta.totalTokens}`)
  if (issues.length > 0) {
    await consoleLog(`  ⚠ 质量提示: ${issues.join('; ')}`)
  }

  return finalResult
}

/**
 * 查找与房间相关的尺寸标注
 */
function findRelatedDimensions(room: any, dimensions: any[]) {
  if (!room.name || !room.position) return []

  return dimensions.filter((dim) => {
    const target = (dim.target || '').toLowerCase()
    const roomName = room.name.toLowerCase()
    return target.includes(roomName) || (dim.position && room.position && dim.position.includes(room.position))
  })
}
