// 图片识别配置
export const config = {
  // DashScope
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',

  // 模型
  qwen: {
    model: process.env.QWEN_MODEL || 'qwen-vl-max',
    temperature: parseFloat(process.env.QWEN_TEMPERATURE || '0.1'),
    maxTokens: parseInt(process.env.QWEN_MAX_TOKENS || '8192', 10),
  },

  // 图片预处理
  image: {
    maxDim: parseInt(process.env.IMAGE_MAX_DIM || '2048', 10),
    minDim: parseInt(process.env.IMAGE_MIN_DIM || '512', 10),
  },

  // 分块识别
  tile: {
    enabled: process.env.TILE_ENABLED !== 'false',
    size: parseInt(process.env.TILE_SIZE || '1024', 10),
    overlap: parseFloat(process.env.TILE_OVERLAP || '0.15'),
    requestDelay: parseInt(process.env.TILE_REQUEST_DELAY || '500', 10),
  },

  // 两轮识别
  twoPass: {
    enabled: process.env.TWO_PASS_ENABLED !== 'false',
  },

  // OCR
  ocr: {
    engine: process.env.OCR_ENGINE || 'tesseract',
    paddleUrl: process.env.PADDLE_OCR_URL || 'http://localhost:8089/ocr',
    tesseractLang: process.env.TESSERACT_LANG || 'chi_sim+eng',
  },

  // 后处理
  postprocess: {
    dimensionMin: parseInt(process.env.DIMENSION_MIN || '10', 10),
    dimensionMax: parseInt(process.env.DIMENSION_MAX || '100000', 10),
    confidenceDescMinLength: parseInt(process.env.CONFIDENCE_DESC_MIN_LENGTH || '4', 10),
  },
}
