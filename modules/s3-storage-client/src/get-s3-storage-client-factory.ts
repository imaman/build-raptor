import { Config, Lambda } from 'aws-sdk'
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

export type Result = { storageClient: S3StorageClient; lambdaClient?: LambdaClient }

interface Creds {
  accessKeyId: string
  secretAccessKey: string
}

class LambdaClient {
  private readonly lambda
  constructor(creds: Creds) {
    const conf = new Config({ credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey } })
    this.lambda = new Lambda(conf)
  }

  async invoke(functionName: string, request: unknown) {
    const invokeResult = await this.lambda
      .invoke({ FunctionName: functionName, InvocationType: 'RequestResponse', Payload: JSON.stringify(request) })
      .promise()
    if (invokeResult.StatusCode !== 200) {
      throw new Error(
        `Invocation of ${functionName} failed with status code ${invokeResult.StatusCode} <${invokeResult.FunctionError}>`,
      )
    }
    if (invokeResult.FunctionError) {
      throw new Error(`Invocation of ${functionName} failed: <${invokeResult.FunctionError}>`)
    }

    const s = invokeResult.Payload?.toString('utf-8')
    return s === undefined ? undefined : JSON.parse(s)
  }
}
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

    return new Promise<Result>(res => {
      const creds = {
        accessKeyId: awsAccessKey.AccessKey.AccessKeyId,
        secretAccessKey: awsAccessKey.AccessKey.SecretAccessKey,
      }
      const ret = {
        storageClient: new S3StorageClient('moojo-dev-infra', 'build-raptor/cache-v1', creds, logger),
        buildTrackerClient: new LambdaClient(creds),
      }
      logger.info(`S3StorageClient created successfully`)

      setTimeout(() => res(ret), 1)
    })
  }
}
