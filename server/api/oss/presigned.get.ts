import { getPresignedUrl } from '../../utils/oss'
import { getUserFromToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = getUserFromToken(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const query = getQuery(event)
  const bucket = query.bucket as string
  const key = query.osskey as string

  if (!bucket || !key) {
    throw createError({
      statusCode: 400,
      message: 'bucket 和 osskey 都是必需参数',
    })
  }

  const url = await getPresignedUrl(bucket, key)

  return { url }
})
