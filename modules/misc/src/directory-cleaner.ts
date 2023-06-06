import * as fs from 'fs'
import * as path from 'path'

export function cleanDirectory(directoryPath: string, deletionFactor: number, sizeTrigger: number) {
  const size = calculateDirectorySize(directoryPath)
  if (size < sizeTrigger) {
    return { size, deleted: 0 }
  }

  const deleted = deleteFiles(directoryPath, deletionFactor)
  return { size, deleted }
}

function calculateDirectorySize(directoryPath: string) {
  let totalSize = 0

  for (const f of fs.readdirSync(directoryPath)) {
    const subFilePath = path.join(directoryPath, f)
    const stats = fs.statSync(subFilePath)
    totalSize += stats.size
  }

  return totalSize
}

function deleteFiles(directoryPath: string, deletionFactor: number) {
  let files

  try {
    files = fs.readdirSync(directoryPath)
  } catch (e) {
    throw new Error(`failed when reading ${directoryPath}: ${e}`)
  }

  // Sort files based on last access time in ascending order
  files.sort((fileA, fileB) => {
    const statA = fs.statSync(path.join(directoryPath, fileA))
    const statB = fs.statSync(path.join(directoryPath, fileB))
    return statA.atime.getTime() - statB.atime.getTime()
  })

  // Calculate the number of files to delete (half of the total)
  const numFilesToDelete = Math.min(files.length, Math.floor(files.length * deletionFactor))

  // Delete the oldest files
  for (let i = 0; i < numFilesToDelete; i++) {
    const filePath = path.join(directoryPath, files[i])

    try {
      fs.unlinkSync(filePath)
    } catch (e) {
      throw new Error(`cleanup of ${filePath} failed: ${e}`)
    }
  }

  return numFilesToDelete
}
