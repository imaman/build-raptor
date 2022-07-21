import { Logger } from 'logger'
import { computeHash, StorageClient } from 'misc'
import { Publisher } from 'repo-protocol'
import { UnitMetadata } from 'unit-metadata'

export class DefaultAssetPublisher implements Publisher {
  constructor(private readonly storageClient: StorageClient, private readonly logger: Logger) {}

  async publishAsset(u: UnitMetadata, content: Buffer, name: string): Promise<void> {
    const fingerprint = computeHash(content)
    const resolved = this.storageClient.putObject({ fingerprint }, content)
    if (typeof resolved !== 'string') {
      throw new Error(`Bad type returned from put-object: ${typeof resolved}`)
    }

    this.logger.info(`Asset ${u.id}/${name} uploaded to ${resolved}`)
  }
}
