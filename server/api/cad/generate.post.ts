import { randomUUID } from 'node:crypto'
import { getUserFromToken } from '../../utils/auth'
import { createQwenClient, callQwenDoc, parseQwenJson } from '../../utils/recognition/qwen'
import { config } from '../../utils/recognition/config'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { cadModelSchema, cadMaterialEditSchema, applyCadMaterialEdit } from '../../utils/cad/schema'
import { compactCadText, MAX_CAD_TEXT_LENGTH, MAX_CAD_ANALYSIS_LENGTH } from '../../utils/cad/compact'
import type { CadModel } from '../../../shared/types/cad'
import { z } from 'zod'
import {
  buildCadSystemPrompt,
  buildCadTextPrompt,
  buildCadImagePrompt,
  buildCadMaterialSystemPrompt,
  buildCadMaterialPrompt,
} from '../../utils/cad/prompts'

const requestSchema = z.object({
  text: z.string().trim().max(MAX_CAD_ANALYSIS_LENGTH).default(''),
  autoCompact: z.boolean().default(false),
  imageBase64: z.string().trim().max(20_000_000).default(''),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']).default('image/jpeg'),
  mode: z.enum(['generate', 'material']).default('generate'),
  currentModel: z.unknown().optional(),
}).refine(data => data.text.length <= MAX_CAD_TEXT_LENGTH || (data.autoCompact && data.mode === 'generate'), {
  path: ['text'],
  message: '超长分析需要启用自动精简',
})

/**
 * POST /api/cad/generate
 * 把「文字需求」或「图片(+文字)」转成受约束的 CadModel DSL（CSG 建模树）。
 *
 * 入参：{ text?: string; imageBase64?: string; mediaType?: string }
 *   - imageBase64 为「不含 data: 前缀」的纯 base64 字符串
 * 返回：{ success, model, summary, title }
 * autoCompact=true 时，生成模式支持最多 200000 字分析，超长内容先经文档模型精简；
 * 成功精简后额外返回 normalizedText，供工作台缓存实际用于建模的文本。
 *
 * 说明：这一层对应 text-to-cad 的 L2「生成层」——只做「需求 -> 建模 JSON」，
 * 真正的几何求值在前端 Three.js + three-bvh-csg（L3/L4）完成。
 */
export default defineEventHandler(async (event) => {
  const requestId = randomUUID()
  const startedAt = performance.now()
  let stage = '鉴权'
  let stageStartedAt = startedAt
  let stageDetails: Record<string, string | number | boolean> = {}
  // 只记录阶段与长度等元数据，不输出图纸正文、图片、凭证或模型原文。
  const log = (message: string, details: Record<string, string | number | boolean> = {}) => {
    console.log(`[cad/generate][${requestId}] ${message}`, {
      stage,
      elapsedMs: Math.round(performance.now() - startedAt),
      stageElapsedMs: Math.round(performance.now() - stageStartedAt),
      ...details,
    })
  }
  const onProgress = (message: string, details: Record<string, string | number | boolean> = {}) => {
    stage = message
    stageStartedAt = performance.now()
    stageDetails = details
    log(message, details)
  }
  log('收到请求')
  const heartbeat = setInterval(() => log('处理中，等待当前阶段完成', stageDetails), 10_000)
  heartbeat.unref()

  try {
    const user = getUserFromToken(event)
    if (!user) {
      throw createError({ statusCode: 401, message: '未授权' })
    }

    onProgress('读取并校验请求参数')
    const request = requestSchema.safeParse(await readBody(event))
    if (!request.success) {
      throw createError({ statusCode: 400, message: '请求参数不合法，请检查描述长度、图片格式或编辑模式' })
    }
    const { text, imageBase64, mediaType, mode } = request.data
    onProgress('请求参数校验通过', { mode, autoCompact: request.data.autoCompact, textLength: text.length, hasImage: !!imageBase64, imageLength: imageBase64.length })
    let currentModel: CadModel | undefined
    if (mode === 'material') {
      onProgress('校验现有模型')
      // 在递归校验前限制输入规模，避免把任意超深 JSON 当作模型树解析。
      const rawModel = JSON.stringify(request.data.currentModel)
      if (!rawModel || rawModel.length > 100_000) {
        throw createError({ statusCode: 400, message: '请先生成一个有效模型，当前模型过大或不存在' })
      }
      const current = cadModelSchema.safeParse(request.data.currentModel)
      if (!current.success) throw createError({ statusCode: 400, message: '当前模型无效，请重新生成' })
      currentModel = current.data
    }

    if (!text && !imageBase64) {
      throw createError({ statusCode: 400, message: '请输入文字描述或上传图片' })
    }

    let normalizedText = text
    if (request.data.autoCompact && !currentModel && text.length > MAX_CAD_TEXT_LENGTH) {
      onProgress('开始自动精简分析', { inputLength: text.length })
      const compactStartedAt = performance.now()
      try {
        normalizedText = await compactCadText(text, callQwenDoc, onProgress)
        onProgress('分析精简完成', { inputLength: text.length, outputLength: normalizedText.length, durationMs: Math.round(performance.now() - compactStartedAt) })
      } catch (error) {
        throw createError({ statusCode: 502, message: error instanceof Error ? error.message : '分析内容自动精简失败，请重试生成' })
      }
    } else {
      onProgress('跳过自动精简', { textLength: text.length, reason: !request.data.autoCompact ? '未启用' : currentModel ? '材质编辑模式' : '长度未超限' })
    }
    onProgress('准备建模提示词')
    const systemPrompt = currentModel ? buildCadMaterialSystemPrompt() : buildCadSystemPrompt()
    const userPrompt = currentModel
      ? buildCadMaterialPrompt(normalizedText, currentModel)
      : imageBase64 ? buildCadImagePrompt(normalizedText) : buildCadTextPrompt(normalizedText)
    let rawText = ''
    onProgress('调用建模模型', { mode, channel: imageBase64 ? '视觉模型' : '文档模型', promptLength: userPrompt.length })
    const modelStartedAt = performance.now()

    if (imageBase64) {
      // 图片输入：走 Qwen-VL（视觉）
      const client = createQwenClient()
      const response = await client.chat.completions.create({
        model: config.qwen.model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
              { type: 'text', text: userPrompt }
            ],
          },
        ] as ChatCompletionMessageParam[],
      })
      rawText = response.choices[0]?.message?.content || ''
    } else {
      // 纯文本输入：走文档模型
      console.log(userPrompt, systemPrompt)
      const resp = await callQwenDoc(userPrompt, systemPrompt)
      rawText = resp.rawText
    }

    onProgress('建模模型返回', { outputLength: rawText.length, durationMs: Math.round(performance.now() - modelStartedAt) })
    onProgress('解析模型 JSON')
    const parsed = parseQwenJson(rawText)
    if (!parsed) {
      log('模型 JSON 解析失败', { outputLength: rawText.length })
      throw createError({ statusCode: 502, message: '模型未返回有效的建模 JSON，请重试或换个描述' })
    }

    if (currentModel) {
      onProgress('校验材质编辑参数')
      const edit = cadMaterialEditSchema.safeParse(parsed)
      if (!edit.success) throw createError({ statusCode: 422, message: '材质参数不合法，请换个描述重试' })
      try {
        onProgress('应用材质修改')
        const model = applyCadMaterialEdit(currentModel, edit.data)
        log('请求成功', { mode })
        return { success: true, model, title: model.title || '未命名模型', summary: model.summary || '' }
      } catch (error) {
        throw createError({ statusCode: 422, message: error instanceof Error ? error.message : '材质目标无效' })
      }
    }

    onProgress('校验建模结构')
    const result = cadModelSchema.safeParse(parsed)
    if (!result.success) {
      log('建模结构校验失败', { issueCount: result.error.issues.length })
      throw createError({
        statusCode: 422,
        message: `建模结构校验失败：${result.error.issues.map((i) => i.message).join('；')}`,
      })
    }

    const model = result.data
    log('请求成功', { mode, compacted: normalizedText !== text, outputLength: rawText.length })
    return {
      success: true,
      model,
      title: model.title || '未命名模型',
      summary: model.summary || '',
      ...(normalizedText !== text ? { normalizedText } : {}),
    }
  } catch (err: any) {
    // createError 抛出的 H3Error 直接透传，其余包装为 500
    if (err?.statusCode) {
      log(`请求失败（${err.statusCode}）`, { message: err.message || '' })
      throw err
    }
    log('请求异常', { error: err?.message || String(err) })
    throw createError({ statusCode: 500, message: err?.message || 'CAD 生成失败' })
  } finally {
    clearInterval(heartbeat)
  }
})
