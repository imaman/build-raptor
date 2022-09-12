import { Config, Lambda } from 'aws-sdk'

import { Creds } from './creds'

export class LambdaClient {
  private readonly lambda

  constructor(creds: Creds, region: string) {
    const conf = new Config({
      region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    })
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
