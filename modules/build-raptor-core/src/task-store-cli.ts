import { computeObjectHash } from 'misc'
import * as path from 'path'

function print(...args: unknown[]) {
  console.log(...args) // eslint-disable-line no-console
}

function main(args: string[]) {
  if (args.length !== 3) {
    print(`Usage: ${path.basename(__filename)} <blob-id>`)
    process.exitCode = 1
    return
  }

  const blobId = args[2].trim()
  const key = { type: 'blob', blobId }

  const h = computeObjectHash({ key })

  const f = `std-${h}`

  print(f)
}

main(process.argv)
