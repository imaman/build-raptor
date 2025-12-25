import { chaoticDeterministicString, slurpDir } from '../src'
import { FilesystemStorageClient } from '../src/file-system-storage-client.js'
import { folderify } from '../src/folderify.js'
import { storageClientContract } from './storage-client-contract.js'

describe('file-system-storage-client', () => {
  storageClientContract(async () => await FilesystemStorageClient.create(await folderify({})))

  describe('cleanup', () => {
    test('when the options is specified cleans up files if total size exceeds the given threshold', async () => {
      const dir = await folderify({})

      const fsc = await FilesystemStorageClient.create(dir)
      expect(Object.keys(await slurpDir(dir))).toHaveLength(0)
      await fsc.putObject('a', chaoticDeterministicString(100, '_'))
      await fsc.putObject('b', chaoticDeterministicString(100, '_'))
      await fsc.putObject('c', chaoticDeterministicString(100, '_'))
      expect(Object.keys(await slurpDir(dir))).toHaveLength(3)

      await FilesystemStorageClient.create(dir, { triggerCleanupIfByteSizeExceeds: 300 })
      expect(Object.keys(await slurpDir(dir))).toHaveLength(3)

      await FilesystemStorageClient.create(dir, { triggerCleanupIfByteSizeExceeds: 299 })
      expect(Object.keys(await slurpDir(dir))).toHaveLength(2)
    })
  })
})
