import { config } from './config'
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';


/**
 * 创建 Qwen-VL 客户端（OpenAI 兼容模式）
 */
export function createQwenClient(): OpenAI {
  if (!config.dashscopeApiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置，请在 .env 中设置');
  }

  return new OpenAI({
    apiKey: config.dashscopeApiKey,
    baseURL: config.dashscopeBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
}

interface QwenCallOverrides {
  temperature?: number;
  maxTokens?: number;
}

interface QwenResponse {
  rawText: string;
  usage: OpenAI.CompletionUsage | undefined;
}

/**
 * 调用 Qwen-VL API（简化的 OpenAI 兼容格式）
 */
export async function callQwenVL(
  client: OpenAI,
  imageBase64: string,
  mediaType: string,
  promptText: string,
  overrides: QwenCallOverrides = {}
): Promise<QwenResponse> {
  const temperature = overrides.temperature ?? config.qwen.temperature;
  const maxTokens = overrides.maxTokens ?? config.qwen.maxTokens;

  // MaaS 平台兼容的消息格式：不使用嵌套的 image_url 对象
  // https://www.alibabacloud.com/help/en/model-studio/vision#c01e63074ae0
  // https://www.alibabacloud.com/help/en/model-studio/visual-reasoning?spm=a2c63.p38356.help-menu-2400256.d_0_3_1_2.3aa25a5beYPE28
  //console.log(`- 调用 Qwen-VL 模型 ${config.qwen.model}，prompt: ${promptText}`)
  const response = await client.chat.completions.create({
    model: config.qwen.model,
    messages: [
      {
        role: 'system',
        content: '你是一位专业的室内工程师，擅长室内空间规划、柜体设计和精确解读 CAD 设计稿。请严格按 JSON 格式输出，不要包含多余文字，不要使用 markdown 代码块。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {url: `data:${mediaType};base64,${imageBase64}`}
          },
          {
            type: 'text',
            text: promptText
          },
        ],
      },
    ] as ChatCompletionMessageParam[],
  });
//console.log(`- 大模型完成`,response)
  return {
    rawText: response.choices[0]?.message?.content || '',
    usage: response.usage,
  };
}

interface OcrWord {
  text: string;
}

interface OcrResult {
  allWords?: OcrWord[];
}

/**
 * 构建 Qwen-VL 识别 prompt — 针对 Qwen 优化
 * - 结构化、具体化指令
 * - OCR 文字作为必须核对的清单
 * - 要求输出 ocr_verified / ocr_unverified 交叉校验
 */
export function buildRecognitionPrompt(ocrResult: OcrResult | null): string {
  const ocrTexts = (ocrResult?.allWords || [])
    .map(w => `"${w.text}"`)
    .join('、');

  const ocrSection = ocrTexts
    ? `\n## OCR 预提取文字（你必须逐个核对后纳入结果）\n${ocrTexts}\n`
    : '\n## OCR 未提取到文字\n请完全依赖视觉识别。\n';

  return `## 任务
你是一位资深室内设计师，请精确分析这张 CAD 设计稿图片。

${ocrSection}

## 识别要求（按优先级）

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
}`;
}

/**
 * 构建第一轮粗识别 prompt
 */
export function buildRoughPrompt(): string {
  return `请快速扫描这张 CAD 设计稿图片，列出所有可见的元素类型和大致位置。
不需要详细属性，只需概览。

输出 JSON 格式：
{
  "rough_elements": [
    {
      "type": "元素类型",
      "position": "大致位置",
      "count": 数量
    }
  ],
  "text_regions": ["文字密集区域描述"],
  "overall_layout": "整体布局描述"
}`;
}

interface RoughResult {
  rough_elements: Array<{
    type: string;
    position: string;
    count: number;
  }>;
  text_regions: string[];
  overall_layout: string;
}

/**
 * 构建第二轮精化 prompt
 */
export function buildRefinePrompt(ocrResult: OcrResult | null, roughResult: RoughResult): string {
  const basePrompt = buildRecognitionPrompt(ocrResult);
  const roughJson = JSON.stringify(roughResult, null, 2);

  return `${basePrompt}

## 第一轮粗识别结果（供参考）
${roughJson}

请在此基础上补充详细属性、尺寸关联、空间信息。
特别注意检查是否有遗漏的元素。
输出完整 JSON。`;
}

/**
 * 解析 Qwen 返回的 JSON（带容错）
 */
export function parseQwenJson(rawText: string): unknown {
  // 尝试直接解析
  try { return JSON.parse(rawText); } catch (_) {}

  // 尝试提取 markdown 代码块
  const mdMatch = rawText.match(/```json\n?([\s\S]*?)\n?```/);
  if (mdMatch) {
    try { return JSON.parse(mdMatch[1]); } catch (_) {}
  }

  // 尝试提取最外层 {}
  const braceMatch = rawText.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (_) {}
  }

  return null;
}

/**
 * sleep 工具
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}


export function buildDocPrompt(Result: any): string {


  return `

## 第一轮粗识别结果（供参考）


请在此基础上补充详细属性、尺寸关联、空间信息。
特别注意检查是否有遗漏的元素。
输出完整 JSON。`;
}


export async function callQwenDoc(prompt: string,systemPrompt:string): Promise<QwenResponse>{
  const client = createQwenClient()
  //prompt的字符串长度
  const response = await client.chat.completions.create({
    model: prompt.length < 200 ? config.qwen.flashModel : config.qwen.docmodel,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
        ],
      },
    ] as ChatCompletionMessageParam[],
  });
  return {
    rawText: response.choices[0]?.message?.content || '',
    usage: response.usage,
  };
}


export async function generateImage(prompt: any): Promise<any> {
  try {
    const client = createQwenClient()
    const response:any = await client.chat.completions.create({
      model: config.qwen.imageModel, // 必须指定模型名称
      messages: [
        {
          role: "user",
          content: [
            // 提示词文本
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ],
      // 百炼特有参数（需按需配置）
      extra_body: {
        parameters: {
          size: "2048*2048", // 支持 1024x1024/1024x1536/1536x1024
          n: 1,               // 生成图片数量（1-6）
          negative_prompt: "低画质，模糊，文字扭曲", // 负向提示词
          watermark: false,    // 是否添加水印
          prompt_extend: false,
        }
      }
    });

    // 提取生成的图片 URL（有效期 24 小时）
    const imageUrl = response.output.choices[0]?.message?.content[0]?.image;
    console.log("@@@@@@@@@@@@@@@@@@@@@@@@生成图片地址:", response.output.choices[0]?.message?.content[0]);
    return imageUrl;
  } catch (error) {
    console.error("API 调用失败:", error.response?.data || error.message);
  }
}

export async function generateImageBySize(prompt: string, size: string = '2048*2048'): Promise<any> {
  try {
    const apiUrl = config.dashscopeAntropicBaseUrl+'/services/aigc/multimodal-generation/generation';
    const apiKey = config.dashscopeApiKey;

    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY 未配置，请在 .env 中设置');
    }

    const payload = {
      model: config.qwen.imageModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                text: prompt
              }
            ]
          }
        ]
      },
      parameters: {
        negative_prompt: '低分辨率，低画质，画面过饱和，无细节，过度光滑，构图混乱，文字模糊，文字乱码，文字扭曲',
        prompt_extend: false,
        watermark: false,
        n: 1,
        size: size
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const imageUrl = result.output.choices[0]?.message?.content[0]?.image;
    console.log("生成图片地址:", imageUrl);
    return imageUrl;
  } catch (error: any) {
    console.error("API 调用失败:", error.message);
    throw error;
  }
}