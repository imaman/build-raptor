import { Logger } from 'logger'
import { z } from 'zod'

import { S3StorageClient } from './s3-storage-client'

const AwsAccessKey = z.object({
  AccessKey: z.object({
    UserName: z.string(),
    Status: z.string(),
    CreateDate: z.string(),
    SecretAccessKey: z.string(),
    AccessKeyId: z.string(),
  }),
})
type AwsAccessKey = z.infer<typeof AwsAccessKey>

// TODO(imaman): cover
export function getS3StorageClientFactory() {
  const s3CacheEnvVar = 's3_cache'
  const s3CacheString = process.env[s3CacheEnvVar] // eslint-disable-line no-process-env
  process.env[s3CacheEnvVar] = '_' // eslint-disable-line no-process-env

  if (!s3CacheString) {
    return undefined
  }

  return async (logger: Logger) => {
    let awsAccessKey: AwsAccessKey
    try {
      const parsed = JSON.parse(s3CacheString)
      awsAccessKey = AwsAccessKey.parse(parsed)
    } catch (e) {
      const err = new Error(`Failed to parse env variable neede for caching`)
      logger.error(`parsing of s3CacheString failed`, err)
      throw e
    }

    return new Promise<S3StorageClient>(res => {
      const creds = {
        accessKeyId: awsAccessKey.AccessKey.AccessKeyId,
        secretAccessKey: awsAccessKey.AccessKey.SecretAccessKey,
      }
      const ret = new S3StorageClient('moojo-dev-infra', 'build-raptor/cache-v1', creds, logger)
      logger.info(`S3StorageClient created successfully`)

      setTimeout(() => res(ret), 1)
    })
  }
}
