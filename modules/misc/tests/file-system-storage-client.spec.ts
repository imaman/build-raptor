import { FilesystemStorageClient } from '../src/file-system-storage-client'
import { folderify } from '../src/folderify'
import { storageClientContract } from './storage-client-contract-test'

describe('file-system-storage-client', () => {
  storageClientContract(async () => await FilesystemStorageClient.create(await folderify({})))
})
