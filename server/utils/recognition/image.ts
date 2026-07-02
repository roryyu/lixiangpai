import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { config } from './config'
import { deleteFile } from '../upload'

/**
 * 预处理图片 — 针对 Qwen-VL 优化
 * - 缩放到最佳尺寸区间 [minDim, maxDim]
 * - 灰度化 + 对比度增强 + 去噪
 * - 输出二值化版本（OCR 用）和预处理版本（视觉模型用）
 */
export async function preprocessImage(inputPath: string, outputBase: string, consoleLog: (msg: string) => void) {
  consoleLog(`- 获取图片元数据`)
  const metadata = await sharp(inputPath).metadata()
  const { maxDim, minDim } = config.image

  // 1. 预处理版本（视觉模型用）
  consoleLog(`- 生成预处理图片（灰度化 + 缩放 + 锐化 + 去噪）`)
  const preprocessedPath = outputBase + '.preprocessed.png'
  let pipeline = sharp(inputPath).greyscale().normalize()

  if (metadata.width! < minDim || metadata.height! < minDim) {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    })
  } else {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  await pipeline
    .sharpen({ sigma: 1.2 })
    .median(3)
    .png({ compressionLevel: 6 })
    .toFile(preprocessedPath)

  // 2. 二值化版本（OCR 用）
  consoleLog(`- 生成二值化图片（用于 OCR）`)
  const binaryPath = outputBase + '.binary.png'
  await sharp(preprocessedPath)
    .threshold(128)
    .png()
    .toFile(binaryPath)

  // 3. 对比度增强版本（扫描件用）
  consoleLog(`- 生成对比度增强图片（用于扫描件）`)
  const enhancedPath = outputBase + '.enhanced.png'
  await sharp(inputPath)
    .greyscale()
    .linear(1.5, -30)
    .normalize()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(enhancedPath)

  const outMeta = await sharp(preprocessedPath).metadata()

  return {
    preprocessedPath,
    binaryPath,
    enhancedPath,
    metadata: {
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      processedWidth: outMeta.width,
      processedHeight: outMeta.height,
      format: metadata.format,
      channels: metadata.channels,
      fileSize: metadata.size,
    },
  }
}

/**
 * 获取图片元数据
 */
export async function getImageMetadata(imagePath: string) {
  const metadata = await sharp(imagePath).metadata()
  const stats = fs.statSync(imagePath)
  return {
    originalWidth: metadata.width,
    originalHeight: metadata.height,
    processedWidth: metadata.width,
    processedHeight: metadata.height,
    fileSize: stats.size,
    format: metadata.format,
    channels: metadata.channels,
  }
}

/**
 * 大图分块 — 带重叠，用于分块识别提高精度
 */
export async function splitImage(inputPath: string, tileSize: number, overlap: number) {
  const { width, height } = await sharp(inputPath).metadata()
  const step = Math.floor(tileSize * (1 - overlap))
  const tiles: Array<{
    index: number
    path: string
    x: number
    y: number
    width: number
    height: number
  }> = []
  let idx = 0

  for (let y = 0; y < height!; y += step) {
    for (let x = 0; x < width!; x += step) {
      const tileWidth = Math.min(tileSize, width! - x)
      const tileHeight = Math.min(tileSize, height! - y)

      // 跳过太小的边缘碎片
      if (tileWidth < tileSize * 0.3 || tileHeight < tileSize * 0.3) continue

      const tilePath = inputPath.replace(/\.(png|jpg|jpeg|webp)$/i, `.tile_${idx}.png`)
      await sharp(inputPath)
        .extract({ left: x, top: y, width: tileWidth, height: tileHeight })
        .png()
        .toFile(tilePath)

      tiles.push({
        index: idx,
        path: tilePath,
        x,
        y,
        width: tileWidth,
        height: tileHeight,
      })
      idx++
    }
  }

  return tiles
}

/**
 * 图片转 base64
 */
export async function imageToBase64(imagePath: string) {
  const buffer = await fs.promises.readFile(imagePath)
  const ext = path.extname(imagePath).toLowerCase().slice(1)
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    bmp: 'image/bmp',
    webp: 'image/webp',
    tiff: 'image/tiff',
  }
  const mediaType = mimeMap[ext] || 'image/png'
  return { data: buffer.toString('base64'), mediaType }
}

/**
 * 压缩图片到指定最大尺寸
 */
export async function resizeImage(inputPath: string, outputPath: string, maxDim = 2048) {
  await sharp(inputPath)
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toFile(outputPath)
  return outputPath
}

/**
 * 清理临时文件
 */
export function cleanupTempFiles(dir: string, baseName: string) {
  const files = fs.readdirSync(dir)
  for (const f of files) {
    if (
      f.startsWith(baseName) &&
      (f.includes('.tile_') ||
        f.includes('.binary') ||
        f.includes('.enhanced') ||
        f.includes('.preprocessed') ||
        f.includes('.resized'))
    ) {
      try {
        fs.unlinkSync(path.join(dir, f))
      } catch (e) {
        // 忽略删除错误
      }
    }
  }
}

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 保存文件
 */
export function saveFile(filePath: string, data: any) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}
