import { getPresignedUrl } from '../../utils/oss'

export default defineEventHandler(async (event) => {
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
