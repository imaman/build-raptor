import { Logger } from 'logger'
import { z } from 'zod'

import { Creds } from './creds'
import { LambdaClient } from './lambda-client'
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

export type Result = { storageClient: S3StorageClient; lambdaClient?: LambdaClient }

// TODO(imaman): cover
export function getS3StorageClientFactory(logger: Logger) {
  const s3CacheEnvVar = 's3_cache'

  logger.info(`keys of process.env are: ${Object.keys(process.env)}`) // eslint-disable-line no-process-env
  const s3CacheString = process.env[s3CacheEnvVar] // eslint-disable-line no-process-env
  process.env[s3CacheEnvVar] = '_' // eslint-disable-line no-process-env

  if (!s3CacheString) {
    logger.info(`getS3StorageClientFactory() - cache string is fasly`)
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

    return new Promise<Result>(res => {
      const creds: Creds = {
        accessKeyId: awsAccessKey.AccessKey.AccessKeyId,
        secretAccessKey: awsAccessKey.AccessKey.SecretAccessKey,
      }
      const ret: Result = {
        storageClient: new S3StorageClient('moojo-dev-infra', 'build-raptor/cache-v1', creds, logger),
        lambdaClient: new LambdaClient(creds),
      }
      logger.info(`S3StorageClient created successfully`)

      setTimeout(() => res(ret), 1)
    })
  }
}
