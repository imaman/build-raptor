import * as fs from 'fs'
import * as path from 'path'
import * as Tmp from 'tmp-promise'

import { chaoticDeterministicString } from '../src'
import { cleanDirectory } from '../src/directory-cleaner'

describe('directory-cleaner', () => {
  test('g', () => {
    const h = new Helper()
    h.createDirectoryWithFiles(3, 100)

    h.setAccessTime('file_0', '2022-01-01')
    h.setAccessTime('file_1', '2022-03-01')
    h.setAccessTime('file_2', '2022-08-01')

    expect(cleanDirectory(h.directoryPath, 0.5, 200)).toEqual({ size: 300, deleted: 1 })

    expect(h.listFiles()).toEqual(['file_1', 'file_2'])
  })
  describe('helper', () => {
    test('creates files', () => {
      const h1 = new Helper()
      h1.createDirectoryWithFiles(3, 0)
      expect(h1.listFiles()).toEqual(['file_0', 'file_1', 'file_2'])

      const h2 = new Helper()
      h2.createDirectoryWithFiles(5, 0)
      expect(h2.listFiles()).toEqual(['file_0', 'file_1', 'file_2', 'file_3', 'file_4'])
    })
  })
})

class Helper {
  readonly directoryPath

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

  createDirectoryWithFiles(numFiles: number, sizeOfEachFileInBytes: number) {
    // Generate and populate files with random access times
    for (let i = 0; i < numFiles; i++) {
      // Create an empty file
      fs.writeFileSync(this.pathToFile(i), chaoticDeterministicString(sizeOfEachFileInBytes, 'thequickbrownfox'))
    }
  }

  pathToFile(f: number | string) {
    const fileName = typeof f === 'string' ? f : `file_${f}`
    const filePath = path.join(this.directoryPath, fileName)
    return filePath
  }

  setAccessTime(fileName: string, aTimeInMillis: string, mTimeInMillis = FIXED_MTIME) {
    // Set the access time of the file
    fs.utimesSync(this.pathToFile(fileName), Date.parse(aTimeInMillis), Date.parse(mTimeInMillis))
  }
}

const FIXED_MTIME = '1999-09-09T00:00:00.000Z'
