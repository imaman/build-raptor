import { Logger } from 'logger'
import { StorageClient } from 'misc'
import { Publisher } from 'repo-protocol'
import { UnitMetadata } from 'unit-metadata'

export class DefaultAssetPublisher implements Publisher {
  constructor(
    private readonly storageClient: StorageClient,
    private readonly logger: Logger,
    private readonly callback: (u: UnitMetadata, resolved: string) => Promise<void>,
  ) {}

  async publishAsset(u: UnitMetadata, content: Buffer, name: string): Promise<string> {
    const resolved = await this.storageClient.putContentAddressable(content)
    this.logger.info(`Asset ${u.id}/${name} uploaded to CAS ${resolved}`)
    await this.callback(u, resolved)
    return resolved
  }
}
