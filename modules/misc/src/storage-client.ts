export type Key = string | number | boolean | null | Key[] | { [p: string]: Key }

export interface StorageClient {
  putObject(key: Key, content: string | Buffer): Promise<void | string>
  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  objectExists(key: Key): Promise<boolean>
}
