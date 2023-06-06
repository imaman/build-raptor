import * as fs from 'fs'
import * as path from 'path'
import * as Tmp from 'tmp-promise'

import { chaoticDeterministicString } from '../src'
import { cleanDirectory } from '../src/directory-cleaner'

describe('directory-cleaner', () => {
  describe('ALWAYS', () => {
    test('deletes the least recently accessed files', () => {
      const h = new Helper()
      h.createDirectoryWithFiles(3)

      h.setAccessTime('file_0', '2022-01-01')
      h.setAccessTime('file_1', '2022-03-01')
      h.setAccessTime('file_2', '2022-08-01')

      expect(cleanDirectory(h.directoryPath, 0.5, 'ALWAYS')).toEqual({ size: 0, deleted: 1 })

      expect(h.listFiles()).toEqual(['file_1', 'file_2'])
    })
    test('when deletion factor is 0.8 deletes 80% of the files', () => {
      const h = new Helper()
      h.createDirectoryWithFiles(10)

      h.setAccessTime('file_0', '2010-01-01')
      h.setAccessTime('file_1', '2011-01-01')
      h.setAccessTime('file_2', '2012-01-01')
      h.setAccessTime('file_3', '2013-01-01')
      h.setAccessTime('file_4', '2014-01-01')
      h.setAccessTime('file_5', '2015-01-01')
      h.setAccessTime('file_6', '2016-01-01')
      h.setAccessTime('file_7', '2017-01-01')
      h.setAccessTime('file_8', '2018-01-01')
      h.setAccessTime('file_9', '2019-01-01')

      expect(cleanDirectory(h.directoryPath, 0.8, 'ALWAYS')).toEqual({ size: 0, deleted: 8 })

      expect(h.listFiles()).toEqual(['file_8', 'file_9'])
    })
    test('deletes just the least recently accessed files', () => {
      const h = new Helper()
      h.createDirectoryWithFiles(4)

      h.setAccessTime('file_0', '2010-01-01')
      h.setAccessTime('file_1', '2001-01-01')
      h.setAccessTime('file_2', '2002-01-01')
      h.setAccessTime('file_3', '2013-01-01')

      expect(cleanDirectory(h.directoryPath, 0.5, 'ALWAYS')).toEqual({ size: 0, deleted: 2 })
      expect(h.listFiles()).toEqual(['file_0', 'file_3'])

      // Run again with factor of 0.5, so delete half of the remaining half.
      expect(cleanDirectory(h.directoryPath, 0.5, 'ALWAYS')).toEqual({ size: 0, deleted: 1 })
      expect(h.listFiles()).toEqual(['file_3'])
    })
    test('does not mix modification time (which should be just ignroed) with access time', () => {
      const h = new Helper()
      h.createDirectoryWithFiles(4)

      h.setAccessTime('file_0', '2004-01-01', '2015-01-01')
      h.setAccessTime('file_1', '2003-01-01', '2016-01-01')
      h.setAccessTime('file_2', '2004-01-01', '2015-01-01')
      h.setAccessTime('file_3', '2003-01-01', '2016-01-01')

      expect(cleanDirectory(h.directoryPath, 0.5, 'ALWAYS')).toEqual({ size: 0, deleted: 2 })
      expect(h.listFiles()).toEqual(['file_0', 'file_2'])
    })
    describe('sizeTriggerInBytes', () => {
      test('dooes not do any deletion if total size is below this value', () => {
        const h = new Helper()

        // 4 files * 100 bytes = 400 bytes
        h.createDirectoryWithFiles(4, 100)

        expect(cleanDirectory(h.directoryPath, 0.75, 500)).toEqual({ size: 400, deleted: 0 })
        expect(h.listFiles()).toHaveLength(4)

        expect(cleanDirectory(h.directoryPath, 0.75, 401)).toEqual({ size: 400, deleted: 0 })
        expect(h.listFiles()).toHaveLength(4)

        expect(cleanDirectory(h.directoryPath, 0.75, 400)).toEqual({ size: 400, deleted: 0 })
        expect(h.listFiles()).toHaveLength(4)

        expect(cleanDirectory(h.directoryPath, 0.75, 399)).toEqual({ size: 400, deleted: 3 })
        expect(h.listFiles()).toHaveLength(1)
      })
    })
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

  createDirectoryWithFiles(numFiles: number, sizeOfEachFileInBytes = 0) {
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
    fs.utimesSync(
      this.pathToFile(fileName),
      Math.floor(Date.parse(aTimeInMillis) / 1000),
      Math.floor(Date.parse(mTimeInMillis) / 1000),
    )
  }
}

const FIXED_MTIME = '1999-09-09T00:00:00.000Z'
