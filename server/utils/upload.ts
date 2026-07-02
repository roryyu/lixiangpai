import fs from 'fs'
import path from 'path'
import { uploadFile as uploadToOSS, getPresignedUrl, getOSSClient } from './oss'
import { prisma } from './prisma'

// 上传目录配置
export const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
export const RESULT_DIR = path.join(process.cwd(), 'results')

// 确保目录存在
export function ensureUploadDirs() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
  if (!fs.existsSync(RESULT_DIR)) {
    fs.mkdirSync(RESULT_DIR, { recursive: true })
  }
}

// 验证文件类型
export function validateImageFile(filename: string): boolean {
  const allowedExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp']
  const ext = path.extname(filename).toLowerCase()
  return allowedExts.includes(ext)
}

// 验证文件大小（默认 50MB）
export function validateFileSize(size: number, maxSize: number = 50 * 1024 * 1024): boolean {
  return size <= maxSize
}

// 生成唯一文件名
export function generateUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName)
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  return `${timestamp}-${random}${ext}`
}

// 保存上传的文件
export async function saveUploadedFile(file: File, filename?: string): Promise<string> {
  ensureUploadDirs()

  const savedFilename = filename || generateUniqueFilename(file.name)
  const filePath = path.join(UPLOAD_DIR, savedFilename)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  fs.writeFileSync(filePath, buffer)

  return filePath
}

// 删除文件
export function deleteFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

// 获取结果文件路径
export function getResultFilePath(filename: string): string {
  const baseName = path.basename(filename, path.extname(filename))
  return path.join(RESULT_DIR, `${baseName}.result.json`)
}

// 读取结果文件
export function readResultFile(filePath: string): any {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
  }
  return null
}

/**
 * 将本地暂存文件上传到 OSS 并更新数据库，然后删除本地文件
 * @param filePath 本地文件路径
 * @param filename 原始文件名（可选，不传则从 filePath 中提取）
 * @returns File 记录
 */
export async function uploadToOSSAndSaveRecord(
  filePath: string,
  filename?: string
): Promise<{ id: string; name: string | null; type: string | null; key: string | null; etag: string | null; ossUrl: string | null }> {
  // 提取文件名和扩展名
  const baseName = filename || path.basename(filePath)
  const ext = path.extname(baseName).toLowerCase()
  
  // 读取文件内容
  const fileBuffer = fs.readFileSync(filePath)
  
  // 生成 OSS key（使用时间戳和随机数避免冲突）
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  const ossKey = `uploads/${timestamp}-${random}${ext}`
  
  // 获取 bucket 配置
  const client = getOSSClient()
  const bucket = (client as any).options.bucket
  
  // 上传到 OSS
  const { etag } = await uploadToOSS({
    bucket,
    key: ossKey,
    body: fileBuffer,
  })
  
  // 获取预签名 URL（用于访问）
  const ossUrl = await getPresignedUrl(bucket, ossKey)
  
  // 检测文件类型
  const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.webp']
  const fileType = imageExts.includes(ext) ? 'image' : 'file'
  
  // 创建数据库记录
  const fileRecord = await prisma.file.create({
    data: {
      name: baseName,
      type: fileType,
      key: ossKey,
      etag,
      ossUrl,
    },
  })
  console.log('baseName',baseName)
  // 删除本地暂存文件
  deleteFile(filePath)
  //删除RESULT_DIR下相关的文件binary，enhanced，preprocessed文件
  console.log(path.join(RESULT_DIR, `${baseName}.binary${ext}`))
  console.log(path.join(RESULT_DIR, `${baseName}.enhanced${ext}`))
  console.log(path.join(RESULT_DIR, `${baseName}.preprocessed${ext}`))

  
  return fileRecord
}
