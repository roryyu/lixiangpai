import { config } from './config'
import Tesseract from 'tesseract.js';
import sharp from 'sharp'


/**
 * Step 2: OCR 文字提取（简化版）
 * 由于服务端安装 Tesseract/PaddleOCR 较复杂，这里先提供接口框架
 * 实际部署时可以：
 * 1. 调用外部 OCR 服务（如阿里云 OCR、百度 OCR）
 * 2. 部署独立的 OCR 服务并通过 HTTP 调用
 * 3. 安装 tesseract.js（需要系统依赖）
 */
export async function ocrStep(binaryPath: string, binary90Path: string, binary180Path: string, binary270Path: string, consoleLog: (msg: string) => void):  Promise<any> {

  consoleLog(`- 引擎: ${config.ocr.engine}`)
  const ocrData = await ocrWithTesseract(binaryPath,consoleLog,0);
  consoleLog(`- Tesseract 进度: 25% 旋转0°`);
  const ocrData90 = await ocrWithTesseract(binary90Path,consoleLog,90);
  consoleLog(`- Tesseract 进度: 50% 旋转90°`);
  const ocrData180 = await ocrWithTesseract(binary180Path,consoleLog,180);
  consoleLog(`- Tesseract 进度: 75% 旋转180°`);
  const ocrData270 = await ocrWithTesseract(binary270Path,consoleLog,270);
  consoleLog(`- Tesseract 进度: 100% 旋转270°`);
  const allWords = [...ocrData.words, ...ocrData90.words, ...ocrData180.words, ...ocrData270.words];
  const filteredWords = deduplicateWords(allWords);
  const allFullText = ocrData.fullText+' '+ocrData90.fullText+' '+ocrData180.fullText+' '+ocrData270.fullText;
  consoleLog(`- 合并分析结果`);

  const dimensions = filteredWords
    .filter(w => /^\d+([xX×]\d+)?$/.test(w.text))
    .map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, type: 'dimension' }));

  const labels = filteredWords
    .filter(w => !/^\d+([xX×]\d+)?$/.test(w.text))
    .map(w => ({ ...w, type: 'label' }));

  consoleLog(`  ✓ 识别到 ${filteredWords.length} 个文字区域`);
  consoleLog(`  ✓ 尺寸标注: ${dimensions.length} 个`);
  consoleLog(`  ✓ 文字标注: ${labels.length} 个`);

  return {
    allWords: filteredWords,
    dimensions,
    labels,
    fullText: allFullText,
    engine: config.ocr.engine,
  };
}

/**
 * Tesseract OCR
 */
async function ocrWithTesseract(imagePath: string, consoleLog: (msg: string) => void, angle: number):  Promise<any> {
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
  const imgMeta = await sharp(imagePath).metadata();
  const words = data.words
    .filter(w => w.confidence > 40)
    .map(w => {
        let bbox = { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 };
        // 根据旋转角度反向变换坐标
        if (angle === 90) {
          // 逆时针 90° 旋转后的坐标变换        
          const w = imgMeta.width;
          bbox = {
            x0: w - bbox.y1,
            y0: bbox.x0,
            x1: w - bbox.y0,
            y1: bbox.x1,
          };
        } else if (angle === 180) {         
          const w = imgMeta.width;
          const h = imgMeta.height;
          bbox = {
            x0: w - bbox.x1,
            y0: h - bbox.y1,
            x1: w - bbox.x0,
            y1: h - bbox.y0,
          };
        } else if (angle === 270) {          
          const h = imgMeta.height;
          bbox = {
            x0: bbox.y0,
            y0: h - bbox.x1,
            x1: bbox.y1,
            y1: h - bbox.x0,
          };
        }
        return {
          text: w.text.trim(),
          confidence: w.confidence,
          bbox,
          rotation: angle, // 记录识别时的旋转角度
        };
    });
  return { words, fullText: data.text };
}


/**
 * 去重：合并重叠的文字区域
 */
function deduplicateWords(words: any[]) {
  const result = [];
  const used = new Set();

  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;

    const w1 = words[i];
    let bestMatch = w1;

    // 查找与当前文字重叠的其他识别结果
    for (let j = i + 1; j < words.length; j++) {
      if (used.has(j)) continue;

      const w2 = words[j];

      // 计算 bbox 重叠度
      const overlap = calculateOverlap(w1.bbox, w2.bbox);

      if (overlap > 0.5) {
        // 保留置信度更高的
        if (w2.confidence > bestMatch.confidence) {
          bestMatch = w2;
        }
        used.add(j);
      }
    }

    result.push(bestMatch);
    used.add(i);
  }

  return result;
}

/**
 * 计算两个 bbox 的重叠度（IoU）
 */
function calculateOverlap(b1: any, b2: any) {
  const xOverlap = Math.max(0, Math.min(b1.x1, b2.x1) - Math.max(b1.x0, b2.x0));
  const yOverlap = Math.max(0, Math.min(b1.y1, b2.y1) - Math.max(b1.y0, b2.y0));
  const overlapArea = xOverlap * yOverlap;

  const area1 = (b1.x1 - b1.x0) * (b1.y1 - b1.y0);
  const area2 = (b2.x1 - b2.x0) * (b2.y1 - b2.y0);
  const minArea = Math.min(area1, area2);

  return minArea > 0 ? overlapArea / minArea : 0;
}