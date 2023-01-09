import { computeObjectHash } from 'misc'
import * as path from 'path'

function main(args: string[]) {
  if (args.length !== 3) {
    console.log(`Usage: ${path.basename(__filename)} <blob-id>`)
    process.exitCode = 1
    return
  }


  const blobId = args[2].trim()
  const key = { type: 'blob', blobId }

  const h = computeObjectHash({ key })

  const f = `std-${h}`

  console.log(f)
}


main(process.argv)