import { getUserFromToken } from '../../utils/auth'
import { createQwenClient, callQwenDoc, parseQwenJson } from '../../utils/recognition/qwen'
import { config } from '../../utils/recognition/config'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { cadModelSchema } from '../../utils/cad/schema'
import {
  buildCadSystemPrompt,
  buildCadTextPrompt,
  buildCadImagePrompt,
} from '../../utils/cad/prompts'

/**
 * POST /api/cad/generate
 * 把「文字需求」或「图片(+文字)」转成受约束的 CadModel DSL（CSG 建模树）。
 *
 * 入参：{ text?: string; imageBase64?: string; mediaType?: string }
 *   - imageBase64 为「不含 data: 前缀」的纯 base64 字符串
 * 返回：{ success, model, summary, title }
 *
 * 说明：这一层对应 text-to-cad 的 L2「生成层」——只做「需求 -> 建模 JSON」，
 * 真正的几何求值在前端 Three.js + three-bvh-csg（L3/L4）完成。
 */
export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({ statusCode: 401, message: '未授权' })
  }

  const body = await readBody<{ text?: string; imageBase64?: string; mediaType?: string }>(event)
  const text = (body?.text || '').trim()
  const imageBase64 = (body?.imageBase64 || '').trim()
  const mediaType = body?.mediaType || 'image/jpeg'

  if (!text && !imageBase64) {
    throw createError({ statusCode: 400, message: '请输入文字描述或上传图片' })
  }

  const systemPrompt = buildCadSystemPrompt()

  try {
    let rawText = ''

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
              { type: 'text', text: buildCadImagePrompt(text) },
            ],
          },
        ] as ChatCompletionMessageParam[],
      })
      rawText = response.choices[0]?.message?.content || ''
    } else {
      // 纯文本输入：走文档模型
      const resp = await callQwenDoc(buildCadTextPrompt(text), systemPrompt)
      rawText = resp.rawText
    }

    const parsed = parseQwenJson(rawText)
    if (!parsed) {
      console.error('[cad/generate] 模型未返回可解析的 JSON:', rawText?.slice(0, 500))
      throw createError({ statusCode: 502, message: '模型未返回有效的建模 JSON，请重试或换个描述' })
    }

    const result = cadModelSchema.safeParse(parsed)
    if (!result.success) {
      console.error('[cad/generate] DSL 校验失败:', result.error.issues)
      throw createError({
        statusCode: 422,
        message: `建模结构校验失败：${result.error.issues.map((i) => i.message).join('；')}`,
      })
    }

    const model = result.data
    return {
      success: true,
      model,
      title: model.title || '未命名模型',
      summary: model.summary || '',
    }
  } catch (err: any) {
    // createError 抛出的 H3Error 直接透传，其余包装为 500
    if (err?.statusCode) throw err
    console.error('[cad/generate] 生成失败:', err)
    throw createError({ statusCode: 500, message: err?.message || 'CAD 生成失败' })
  }
})
