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

const OBJECT_NOT_FOUND = 'OBJECT_NOT_FOUND'

/**
 * Thrown by a StorageClient's getObject()/getContentAddressable() when the requested object does not exist in the
 * underlying storage. Other failures (network, permissions, etc.) are reported via other error types.
 */
export class ObjectNotFoundError extends Error {
  readonly code = OBJECT_NOT_FOUND
  constructor(message: string) {
    super(message)
    this.name = 'ObjectNotFoundError'
  }
}

/**
 * Determines whether the given value is an ObjectNotFoundError. Checks the error code (rather than using `instanceof`)
 * so that it works even if multiple copies of this module are loaded.
 */
export function isObjectNotFoundError(e: unknown): e is ObjectNotFoundError {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === OBJECT_NOT_FOUND
}
