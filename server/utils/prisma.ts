import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function getSchemaFromUrl(url: string | undefined): string {
  if (!url) return 'public'
  const match = url.match(/[?&]schema=([^&]+)/)
  return match ? match[1] : 'public'
}

const schema = getSchemaFromUrl(process.env.DATABASE_URL)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || '',
  options: `-c search_path=${schema}`,
})
const connectionString = process.env.DATABASE_URL!
const adapter = new PrismaPg(connectionString, { schema })

export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}