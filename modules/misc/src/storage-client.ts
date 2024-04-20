export type Key = string | number | boolean | null | Key[] | { [p: string]: Key }

export interface StorageClient {
  putContentAddressable(content: string | Buffer): Promise<string>
  getContentAddressable(hash: string): Promise<Buffer>
  putObject(key: Key, content: string | Buffer): Promise<void>
  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  objectExists(key: Key): Promise<boolean>
}
