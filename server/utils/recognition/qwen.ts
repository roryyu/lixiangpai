import { config } from './config'
import { imageToBase64, splitImage } from './image'
import type { OcrResult } from './ocr'

// 简化：直接使用 fetch 调用 OpenAI 兼容接口
export function createQwenClient() {
  return {
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  }
}

/**
 * 调用 Qwen-VL 模型
 */
export async function callQwenVL(
  client: ReturnType<typeof createQwenClient>,
  imageBase64: string,
  mediaType: string,
  prompt: string,
  options: { temperature?: number } = {}
) {
  if (!client.apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置')
  }

  const response = await fetch(`${client.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.apiKey}`,
    },
    body: JSON.stringify({
      model: config.qwen.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: options.temperature ?? config.qwen.temperature,
      max_tokens: config.qwen.maxTokens,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Qwen API 错误: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const rawText = data.choices?.[0]?.message?.content || ''
  const usage = data.usage

  return { rawText, usage }
}

/**
 * 构建识别 Prompt
 */
export function buildRecognitionPrompt(ocrResult: OcrResult): string {
  const ocrContext = ocrResult.fullText ? `\nOCR 提取的文字供参考（可能有误差）：${ocrResult.fullText}` : ''

  return `你是专业的 CAD 设计稿识别专家。请分析这张设计图纸，提取结构化信息。

识别目标：
1. drawing_info: 图纸基本信息（标题、比例、单位、图纸类型）
2. elements: 图纸中的图形元素（墙、门、窗、家具、设备等），每个元素包含：
   - type: 元素类型
   - description: 详细描述
   - position: 位置描述（如"左上角"、"中心偏左"）
   - properties: 尺寸、材质等属性（键值对）
   - confidence: 置信度（high/medium/low）
3. spaces: 识别到的房间/空间（名称、位置、功能、预估面积）
4. dimensions: 尺寸标注（数值、标注对象、位置）
5. annotations: 文字标注、说明（内容、位置）
6. ocr_verified: 视觉确认与 OCR 匹配的文字列表
7. ocr_unverified: OCR 存在但视觉未确认的文字列表
8. summary: 简要总结识别结果

请严格以 JSON 格式输出，不要添加其他说明文字。JSON 结构：
{
  "drawing_info": {},
  "elements": [],
  "spaces": [],
  "dimensions": [],
  "annotations": [],
  "ocr_verified": [],
  "ocr_unverified": [],
  "summary": ""
}
${ocrContext}`
}

/**
 * 构建第一轮粗识别 Prompt
 */
export function buildRoughPrompt(): string {
  return `你是专业的 CAD 设计稿识别专家。请先快速浏览这张设计图纸，给出初步的识别结果。

只需要识别：
- 整体布局和主要区域（如"客厅"、"卧室"、"厨房"的大致位置）
- 明显的大型元素（如墙体、主要家具）
- 最清晰的尺寸标注
- 图纸类型判断

请严格以 JSON 格式输出，结构同上。`
}

/**
 * 构建第二轮精化 Prompt
 */
export function buildRefinePrompt(ocrResult: OcrResult, roughResult: any): string {
  const ocrContext = ocrResult.fullText ? `\nOCR 提取的文字：${ocrResult.fullText}` : ''
  const roughContext = roughResult.summary ? `\n第一轮初步识别结果摘要：${roughResult.summary}` : ''

  return `你是专业的 CAD 设计稿识别专家。${roughContext}

请基于第一轮的初步识别，仔细分析这张设计图纸，进行精细化识别：
1. 补充遗漏的元素和细节
2. 修正第一轮可能的错误
3. 特别关注：小元素、尺寸标注、文字标注、材质说明
4. 检查所有 OCR 提取的文字与视觉内容是否匹配
${ocrContext}

请严格以 JSON 格式输出完整结果，结构同上。`
}

/**
 * 解析 Qwen 返回的 JSON
 */
export function parseQwenJson(rawText: string): any {
  try {
    // 清理 markdown 标记
    let cleanText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .replace(/`/g, '')
      .trim()

    // 尝试提取 JSON 部分
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      cleanText = jsonMatch[0]
    }

    return JSON.parse(cleanText)
  } catch (error) {
    console.warn('解析 Qwen JSON 失败，返回原始文本:', (error as Error).message)
    return { raw: rawText, summary: '解析失败，请查看原始文本' }
  }
}

/**
 * 延时函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
