import * as fs from 'fs'
import { createNopLogger } from 'logger'
import { FilesystemStorageClient } from 'misc'
import * as os from 'os'
import * as path from 'path'

import { BlobId, TaskStore } from './task-store'

function print(...args: unknown[]) {
  console.log(...args) // eslint-disable-line no-console
}

async function main(args: string[]) {
  if (args.length !== 3) {
    print(`Usage: ${path.basename(__filename)} <blob-id>`)
    process.exitCode = 1
    return
  }

  const sc = await FilesystemStorageClient.create(path.join(os.homedir(), '.build-raptor/storage'))
  const taskStore = new TaskStore(sc, createNopLogger())

  const blobId = BlobId(args[2].trim())

  const outputDir = path.join(process.cwd(), blobId)
  fs.mkdirSync(outputDir)
  await taskStore.restoreBlob(blobId, outputDir)
  print(`Blob restored to ${outputDir}`)
}

main(process.argv)
