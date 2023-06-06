import * as fs from 'fs'
import * as path from 'path'
import * as Tmp from 'tmp-promise'

describe('directory-cleaner', () => {
  describe('helper', () => {
    test('creates files', () => {
      const h1 = new Helper()
      h1.createDirectoryWithFiles(3)
      expect(h1.listFiles()).toEqual(['file_0', 'file_1', 'file_2'])

      const h2 = new Helper()
      h2.createDirectoryWithFiles(5)
      expect(h2.listFiles()).toEqual(['file_0', 'file_1', 'file_2', 'file_3', 'file_4'])
    })
  })
})

class Helper {
  private directoryPath

  constructor() {
    this.directoryPath = Tmp.dirSync().name
  }

  listFiles() {
    const filePath = this.directoryPath
    const stats = fs.statSync(filePath)

    if (!stats.isDirectory()) {
      throw new Error(`not a directory ${filePath}`)
    }

    return fs.readdirSync(filePath).sort()
  }

  createDirectoryWithFiles(numFiles: number) {
    // Generate and populate files with random access times
    for (let i = 0; i < numFiles; i++) {
      // Create an empty file
      fs.writeFileSync(this.pathToFile(i), '')
    }
  }

  pathToFile(f: number | string) {
    const fileName = typeof f === 'string' ? f : `file_${f}`
    const filePath = path.join(this.directoryPath, fileName)
    return filePath
  }

  setAccessTime(fileName: string, aTimeInMillis: number, mTimeInMillis = FIXED_MTIME) {
    // Set the access time of the file
    fs.utimesSync(this.pathToFile(fileName), aTimeInMillis, mTimeInMillis)
  }
}

const FIXED_MTIME = Date.parse('2022-01-01T00:00:00.000Z')
