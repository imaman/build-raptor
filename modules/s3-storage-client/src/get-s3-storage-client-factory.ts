import { Logger } from 'logger'
import { StorageClient } from 'misc'
import { z } from 'zod'

import { Creds } from './creds.js'
import { S3StorageClient } from './s3-storage-client.js'

// TODO(imaman): cover
export function getS3StorageClientFactory() {
  const s3CacheEnvVar = 's3_cache'

  const s3CacheString = process.env[s3CacheEnvVar] // eslint-disable-line no-process-env
  process.env[s3CacheEnvVar] = '_' // eslint-disable-line no-process-env

  if (!s3CacheString) {
    return undefined
  }

  return async (logger: Logger) => {
    let parsed
    try {
      parsed = JSON.parse(s3CacheString)
    } catch (cause) {
      const err = new Error(`env var ${s3CacheEnvVar} is not a valid JSON - ${cause}`)
      logger.error(`JSON parsing failed`, err)
      throw err
    }

    const typed = z
      .object({
        AccessKey: z.object({
          SecretAccessKey: z.string(),
          AccessKeyId: z.string(),
        }),
      })
      .or(
        z.object({
          SecretAccessKey: z.string(),
          AccessKeyId: z.string(),
          AccessKey: z.undefined().optional(),
        }),
      )
      .safeParse(parsed)

    if (!typed.success) {
      const err = new Error(`env var ${s3CacheEnvVar} is not well formed - ${typed.error.message}`)
      logger.error(`ZOD parsing failed`, err)
      throw err
    }
    const obj = typed.data.AccessKey === undefined ? typed.data : typed.data.AccessKey
    logger.print(`Using AWS Access key ID "${obj.AccessKeyId}"`)

    return new Promise<StorageClient>(res => {
      const creds: Creds = {
        accessKeyId: obj.AccessKeyId,
        secretAccessKey: obj.SecretAccessKey,
      }
      const ret = new S3StorageClient('moojo-dev-infra', 'build-raptor/cache-v1', creds, logger)
      logger.info(`S3StorageClient created successfully`)

      setTimeout(() => res(ret), 1)
    })
  }
}
