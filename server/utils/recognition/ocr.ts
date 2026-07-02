import { config } from './config'
import Tesseract from 'tesseract.js';



/**
 * Step 2: OCR 文字提取（简化版）
 * 由于服务端安装 Tesseract/PaddleOCR 较复杂，这里先提供接口框架
 * 实际部署时可以：
 * 1. 调用外部 OCR 服务（如阿里云 OCR、百度 OCR）
 * 2. 部署独立的 OCR 服务并通过 HTTP 调用
 * 3. 安装 tesseract.js（需要系统依赖）
 */
export async function ocrStep(imagePath: string, consoleLog: (msg: string) => void):  Promise<any> {

  consoleLog(`- 引擎: ${config.ocr.engine}`)
  const ocrData = await ocrWithTesseract(imagePath,consoleLog);
  consoleLog(`- Tesseract 进度: 100%`);
  const dimensions = ocrData.words
    .filter(w => /^\d+([xX×]\d+)?$/.test(w.text))
    .map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, type: 'dimension' }));

  const labels = ocrData.words
    .filter(w => !/^\d+([xX×]\d+)?$/.test(w.text))
    .map(w => ({ ...w, type: 'label' }));

  consoleLog(`  ✓ 识别到 ${ocrData.words.length} 个文字区域`);
  consoleLog(`  ✓ 尺寸标注: ${dimensions.length} 个`);
  consoleLog(`  ✓ 文字标注: ${labels.length} 个`);

  return {
    allWords: ocrData.words,
    dimensions,
    labels,
    fullText: ocrData.fullText,
    engine: config.ocr.engine,
  };
}

/**
 * Tesseract OCR
 */
async function ocrWithTesseract(imagePath: string, consoleLog: (msg: string) => void):  Promise<any> {
  const worker = await Tesseract.createWorker(config.ocr.tesseractLang, 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Tesseract 进度: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
  });

  const { data } = await worker.recognize(imagePath);
  await worker.terminate();
  console.log(''); // 换行
  const words = data.words
    .filter(w => w.confidence > 40)
    .map(w => ({
      text: w.text.trim(),
      confidence: w.confidence,
      bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
    }));

  return { words, fullText: data.text };
}
