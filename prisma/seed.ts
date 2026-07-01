import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcryptjs from 'bcryptjs'

const { Pool } = pg

// 从 DATABASE_URL 解析 schema
function getSchemaFromUrl(url: string | undefined): string {
  if (!url) return 'public'
  const match = url.match(/schema=([^&]+)/)
  return match ? match[1] : 'public'
}

const schema = getSchemaFromUrl(process.env.DATABASE_URL)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
})
const connectionString = process.env.DATABASE_URL!
const adapter = new PrismaPg(connectionString, { schema })
const prisma = new PrismaClient({ adapter })

async function main() {
  // 如果不是 public schema，直接用带 schema 的原始 SQL
  if (schema !== 'public') {
    // 检查是否存在
    const result = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${schema}"."User" WHERE email = $1`,
      'admin@admin.com'
    ) as any[]

    if (result.length > 0) {
      console.log('Admin 账号已存在')
      return
    }

    const hashedPassword = await bcryptjs.hash('admin123', 12)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."User" (id, email, password, name, role, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      crypto.randomUUID(),
      'admin@admin.com',
      hashedPassword,
      'Admin',
      'ADMIN'
    )

    console.log('Admin 账号创建成功: admin@admin.com')
    return
  }

  // public schema 用正常方式
  const adminEmail = 'admin@admin.com'
  const adminPassword = 'admin123'

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  })

  if (existingAdmin) {
    console.log('Admin 账号已存在')
    return
  }

  const hashedPassword = await bcryptjs.hash(adminPassword, 12)

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      password: hashedPassword,
      name: 'Admin',
      role: 'ADMIN',
    },
  })

  console.log(`Admin 账号创建成功: ${admin.email}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
