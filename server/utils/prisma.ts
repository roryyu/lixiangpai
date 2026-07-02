import { PrismaClient } from "@/generated/prisma"
import { PrismaPg } from "@prisma/adapter-pg"
function getSchemaFromUrl(url: string | undefined): string {
  if (!url) return 'public'
  const match = url.match(/[?&]schema=([^&]+)/)
  return match ? match[1] : 'public'
}

const schema = getSchemaFromUrl(process.env.DATABASE_URL)
const prismaClientSingleton = () => {
  const connectionString = process.env.DATABASE_URL!
  const adapter = new PrismaPg(connectionString, { schema })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  })
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

export const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma




