import { StorageClient } from 'misc'
import { Publisher } from 'repo-protocol'
import { UnitMetadata } from 'unit-metadata'

export class DefaultAssetPublisher implements Publisher {
  constructor(private readonly storageClient: StorageClient) {}

  publishAsset(_u: UnitMetadata, _content: Buffer, _name: string): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
