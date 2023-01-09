import { computeObjectHash } from 'misc'
import { TaskStore } from './task-store'
import * as path from 'path'
import * as os from 'os'
import { createNopLogger } from 'logger'
import { dumpFile, FilesystemStorageClient, Int, switchOn, toReasonableFileName } from 'misc'

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

  const blobId = args[2].trim()
  const key = { type: 'blob', blobId }

  const h = computeObjectHash({ key })

  const f = `std-${h}`

  print(f)
}

main(process.argv)
