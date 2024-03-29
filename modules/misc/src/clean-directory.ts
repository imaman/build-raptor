import * as fs from 'fs'
import * as path from 'path'

import { sortBy } from './arrays'

export function cleanDirectory(
  directoryPath: string,
  deletionFactor: number,
  triggerCleanupIfByteSizeExceeds: number | 'ALWAYS',
) {
  const size = calculateDirectorySize(directoryPath)
  if (triggerCleanupIfByteSizeExceeds !== 'ALWAYS' && size <= triggerCleanupIfByteSizeExceeds) {
    return { size, deleted: 0 }
  }

  const filesDeleted = deleteFiles(directoryPath, deletionFactor)
  return { size, deleted: filesDeleted.length }
}

function calculateDirectorySize(directoryPath: string) {
  let ret = 0

  for (const f of fs.readdirSync(directoryPath)) {
    const resolved = path.join(directoryPath, f)
    const stats = fs.statSync(resolved)
    ret += stats.size
  }

  return ret
}

function deleteFiles(directoryPath: string, deletionFactor: number) {
  let files

  try {
    files = fs.readdirSync(directoryPath)
  } catch (e) {
    throw new Error(`failed when reading ${directoryPath}: ${e}`)
  }

  const mapped = files.map(f => ({ f, atime: fs.statSync(path.join(directoryPath, f)).atime.toISOString() }))
  const sorted = sortBy(mapped, at => at.atime)

  const numFilesToDelete = Math.min(sorted.length, Math.floor(sorted.length * deletionFactor))
  const ret = sorted.slice(0, numFilesToDelete).map(at => at.f)

  for (const f of ret) {
    const filePath = path.join(directoryPath, f)

    try {
      fs.unlinkSync(filePath)
    } catch (e) {
      throw new Error(`cleanup of ${filePath} failed: ${e}`)
    }
  }

  return ret
}
