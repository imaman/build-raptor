import { computeHash } from 'misc'
import { Publisher } from 'repo-protocol'
import { UnitMetadata } from 'unit-metadata'

export class NopAssetPublisher implements Publisher {
  constructor() {}

  async publishAsset(_u: UnitMetadata, content: Buffer, _name: string): Promise<string> {
    return computeHash(content)
  }
}
