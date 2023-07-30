import { PathInRepo, RepoRoot } from 'core-types'
import * as fse from 'fs-extra'
import { createNopLogger, Logger } from 'logger'
import { chaoticDeterministicString, folderify, InMemoryStorageClient, Int, slurpDir, StorageClient } from 'misc'
import { TaskKind, TaskName } from 'task-name'
import * as TmpSync from 'tmp'
import { UnitId } from 'unit-metadata'

import { Fingerprint } from '../src/fingerprint'
import { TaskStore, acc } from '../src/task-store'

async function slurp(d: RepoRoot) {
  return await slurpDir(d.resolve())
}

describe('task-store', () => {
  const newTaskStore = (sc: StorageClient, logger: Logger, dir?: string) =>
    new TaskStore(RepoRoot(dir ?? TmpSync.dirSync().name), sc, logger)
  const logger = createNopLogger()
  async function recordVerdict(
    store: TaskStore,
    taskName: TaskName,
    fingerprint: string,
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    return store.recordTask(taskName, Fingerprint(fingerprint), [], verdict)
  }

  const taskNameFoo = TaskName(UnitId('a'), TaskKind('foo'))
  const taskNameBar = TaskName(UnitId('a'), TaskKind('bar'))
  const taskNameA = TaskName(UnitId('u'), TaskKind('A'))
  const taskNameB = TaskName(UnitId('u'), TaskKind('B'))
  const taskNameC = TaskName(UnitId('u'), TaskKind('C'))

  async function getVerdict(store: TaskStore, taskName: TaskName, fingerprint: string): Promise<string> {
    return store.restoreTask(taskName, Fingerprint(fingerprint))
  }
  describe('recordVerdict()/getVerdict()', () => {
    test('presists a verdict for a task', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger)

      await recordVerdict(store, taskNameFoo, Fingerprint('fp-1'), 'OK')
      expect(await getVerdict(store, taskNameFoo, Fingerprint('fp-1'))).toEqual('OK')
    })
    test('does not mix tasks', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger)

      await recordVerdict(store, taskNameA, Fingerprint('fp-1'), 'FAIL')
      await recordVerdict(store, taskNameB, Fingerprint('fp-1'), 'OK')
      expect(await getVerdict(store, taskNameA, Fingerprint('fp-1'))).toEqual('FAIL')
      expect(await getVerdict(store, taskNameB, Fingerprint('fp-1'))).toEqual('OK')
    })
    test('does not mix fingerprints', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger)

      await recordVerdict(store, taskNameFoo, Fingerprint('FP-1'), 'OK')
      await recordVerdict(store, taskNameFoo, Fingerprint('FP-2'), 'FAIL')
      expect(await getVerdict(store, taskNameFoo, Fingerprint('FP-1'))).toEqual('OK')
      expect(await getVerdict(store, taskNameFoo, Fingerprint('FP-2'))).toEqual('FAIL')
    })
    test('data is persisted across different instances of TaskStore', async () => {
      const sc = new InMemoryStorageClient()

      const storeA = newTaskStore(sc, logger)
      const storeB = newTaskStore(sc, logger)

      await recordVerdict(storeA, taskNameFoo, Fingerprint('fp-1'), 'OK')
      await recordVerdict(storeA, taskNameBar, Fingerprint('fp-2'), 'FAIL')
      await recordVerdict(storeB, taskNameFoo, Fingerprint('fp-3'), 'FAIL')
      await recordVerdict(storeB, taskNameBar, 'fp-4', 'OK')

      expect(await getVerdict(storeA, taskNameFoo, Fingerprint('fp-1'))).toEqual('OK')
      expect(await getVerdict(storeA, taskNameBar, Fingerprint('fp-2'))).toEqual('FAIL')
      expect(await getVerdict(storeA, taskNameFoo, Fingerprint('fp-3'))).toEqual('FAIL')
      expect(await getVerdict(storeA, taskNameBar, 'fp-4')).toEqual('OK')

      expect(await getVerdict(storeB, taskNameFoo, Fingerprint('fp-1'))).toEqual('OK')
      expect(await getVerdict(storeB, taskNameBar, Fingerprint('fp-2'))).toEqual('FAIL')
      expect(await getVerdict(storeB, taskNameFoo, Fingerprint('fp-3'))).toEqual('FAIL')
      expect(await getVerdict(storeB, taskNameBar, 'fp-4')).toEqual('OK')
    })
  })
  describe('recording/restoration of output locations', () => {
    test('it can store an entire directory and the restore it at a given destination', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'qux/f1.txt': 'four scores',
          'qux/f2.txt': 'and seven years ago',
        }),
      )
      await store.recordTask(taskNameFoo, Fingerprint('bar'), [PathInRepo('qux')], 'OK')

      const destination = newTaskStore(sc, logger)
      await destination.restoreTask(taskNameFoo, Fingerprint('bar'))

      expect(await slurp(destination.repoRootDir)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
    })
    test('after restore, the destination is identical to the original directory that was recorded', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'qux/f1.txt': 'four scores',
          'qux/f2.txt': 'and seven years ago',
        }),
      )
      await store.recordTask(taskNameFoo, Fingerprint('bar'), [PathInRepo('qux')], 'OK')

      const destination = newTaskStore(
        sc,
        logger,
        await folderify({
          'qux/f1.txt': 'We choose to go to the Moon',
          'qux/f3.txt': 'in this decade',
        }),
      )
      await destination.restoreTask(taskNameFoo, Fingerprint('bar'))

      expect(await slurp(destination.repoRootDir)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
    })
    test('files outside of the output directories are not changed', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'qux/f1.txt': 'four scores',
          'qux/f2.txt': 'and seven years ago',
        }),
      )
      await store.recordTask(taskNameFoo, Fingerprint('bar'), [PathInRepo('qux')], 'OK')

      const destination = newTaskStore(
        sc,
        logger,
        await folderify({
          readme: 'very important things',
          'foo/goo/f1.txt': 'We choose to go to the Moon',
        }),
      )
      await destination.restoreTask(taskNameFoo, Fingerprint('bar'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
        'foo/goo/f1.txt': 'We choose to go to the Moon',
        readme: 'very important things',
      })
    })
    test('stores only files from the given output directories', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'bourne/i': 'The Bourne Identity',
          'bourne/ii': 'The Bourne Supremacy',
          'bourne/iii': 'The Bourne Ultimatum',
          'starwars/i': 'The Phantom Menace',
          'starwars/ii': 'Attack of the Clones',
          'starwars/iii': 'Revenge of the Sith',
        }),
      )
      await store.recordTask(taskNameFoo, Fingerprint('bar'), [PathInRepo('bourne')], 'OK')

      const destination = newTaskStore(
        sc,
        logger,
        await folderify({
          'thegodfather/i': 'The Godfather',
          'thegodfather/ii': 'The Godfather Part II',
          'thegodfather/iii': 'The Godfather Part III',
        }),
      )

      await destination.restoreTask(taskNameFoo, Fingerprint('bar'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'bourne/i': 'The Bourne Identity',
        'bourne/ii': 'The Bourne Supremacy',
        'bourne/iii': 'The Bourne Ultimatum',
        'thegodfather/i': 'The Godfather',
        'thegodfather/ii': 'The Godfather Part II',
        'thegodfather/iii': 'The Godfather Part III',
      })
    })
    test('does not mix tasks', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'bourne/actors': 'Matt Damon',
          'starwars/actors': 'Mark Hamill',
          'thegodfather/i': 'Al Pacino',
        }),
      )
      await store.recordTask(taskNameA, Fingerprint('fp-1'), [PathInRepo('bourne')], 'OK')
      await store.recordTask(taskNameB, Fingerprint('fp-1'), [PathInRepo('starwars')], 'OK')
      await store.recordTask(taskNameC, Fingerprint('fp-1'), [PathInRepo('thegodfather')], 'OK')

      const destination = newTaskStore(sc, logger)

      await destination.restoreTask(taskNameA, Fingerprint('fp-1'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'bourne/actors': 'Matt Damon',
      })

      await destination.restoreTask(taskNameB, Fingerprint('fp-1'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'bourne/actors': 'Matt Damon',
        'starwars/actors': 'Mark Hamill',
      })

      await destination.restoreTask(taskNameC, Fingerprint('fp-1'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'bourne/actors': 'Matt Damon',
        'starwars/actors': 'Mark Hamill',
        'thegodfather/i': 'Al Pacino',
      })
    })
    test('does not mix fingerprints', async () => {
      const sc = new InMemoryStorageClient()
      const store1 = newTaskStore(sc, logger, await folderify({ 'year/starwars': '1977' }))
      const store2 = newTaskStore(sc, logger, await folderify({ 'year/heat': '1995' }))
      const store3 = newTaskStore(sc, logger, await folderify({ 'year/prestige': '2006' }))

      await store1.recordTask(taskNameA, Fingerprint('FP-1'), [PathInRepo('year')], 'OK')
      await store2.recordTask(taskNameA, Fingerprint('FP-2'), [PathInRepo('year')], 'OK')
      await store3.recordTask(taskNameA, Fingerprint('FP-3'), [PathInRepo('year')], 'OK')

      const dest1 = newTaskStore(sc, logger)
      await dest1.restoreTask(taskNameA, Fingerprint('FP-2'))
      expect(await slurp(dest1.repoRootDir)).toEqual({ 'year/heat': '1995' })

      const dest2 = newTaskStore(sc, logger)
      await dest2.restoreTask(taskNameA, Fingerprint('FP-2'))
      expect(await slurp(dest2.repoRootDir)).toEqual({ 'year/heat': '1995' })
      const dest3 = newTaskStore(sc, logger)
      await dest3.restoreTask(taskNameA, Fingerprint('FP-2'))
      expect(await slurp(dest3.repoRootDir)).toEqual({ 'year/heat': '1995' })
    })
    test('outputs can be files and not just folders', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger, await folderify({ 'a.txt': 'foo' }))
      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a.txt')], 'OK')

      const destination = newTaskStore(sc, logger)
      await destination.restoreTask(taskNameA, Fingerprint('fp'))
      expect(await slurp(destination.repoRootDir)).toEqual({ 'a.txt': 'foo' })
    })
    test('outputs can be deeply nested under sub-dirs', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/c/d/index.js': 'foo',
          'a/b/c/f/index.js': Fingerprint('bar'),
          'a/b/index.js': 'goo',
        }),
      )
      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a/b/c')], 'OK')

      const destination = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/index.js': 'moo',
        }),
      )
      await destination.restoreTask(taskNameA, Fingerprint('fp'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'a/b/c/d/index.js': 'foo',
        'a/b/c/f/index.js': Fingerprint('bar'),
        'a/b/index.js': 'moo',
      })
    })
    test('does not include files that happen to be a prefix of the requested output path', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/index.js': 'let me in',
          'a/bb/index.js': "don't let me in",
          'a/bbc': 'me neither',
        }),
      )
      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a/b')], 'OK')

      const destination = newTaskStore(sc, logger)
      await destination.restoreTask(taskNameA, Fingerprint('fp'))
      expect(await slurp(destination.repoRootDir)).toEqual({ 'a/b/index.js': 'let me in' })
    })
    test('restore retains the mtime and mode values of the files', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/f1': 'c1',
          'a/f2': 'c1',
          'a/f3': 'c1',
        }),
      )

      const dir = store.repoRootDir
      await fse.chmod(dir.resolve(PathInRepo('a/f1')), 0o755)
      await fse.chmod(dir.resolve(PathInRepo('a/f2')), 0o640)
      await fse.utimes(dir.resolve(PathInRepo('a/f2')), new Date(0), new Date(2000))
      await fse.utimes(dir.resolve(PathInRepo('a/f3')), new Date(0), new Date(3000))

      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a')], 'OK')

      const destination = newTaskStore(sc, logger)
      await destination.restoreTask(taskNameA, Fingerprint('fp'))

      const stat1 = await fse.stat(destination.repoRootDir.resolve(PathInRepo('a/f1')))
      expect(stat1.mode).toEqual(0o100755)

      const stat2 = await fse.stat(destination.repoRootDir.resolve(PathInRepo('a/f2')))
      expect(stat2.mtime.getTime()).toEqual(2000)
      expect(stat2.mode).toEqual(0o100640)

      const stat3 = await fse.stat(destination.repoRootDir.resolve(PathInRepo('a/f3')))
      expect(stat3.mtime.getTime()).toEqual(3000)
    })
    test('handles multiple output locations', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/q/x1.txt': 'this is q/x1',
          'a/b/q/x2.txt': 'this is q/x2',
          'a/b/r/x1.txt': 'this is r/x1',
          'a/b/r/x2.txt': 'this is r/x2',
          'a/b/s/x1.txt': 'this is s/x1',
          'a/b/s/x2.txt': 'this is s/x2',
        }),
      )
      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a/b/q'), PathInRepo('a/b/r')], 'OK')
      const destination = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/s/x1.txt': '1',
          'a/b/s/x2.txt': '2',
        }),
      )
      await destination.restoreTask(taskNameA, Fingerprint('fp'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'a/b/q/x1.txt': 'this is q/x1',
        'a/b/q/x2.txt': 'this is q/x2',
        'a/b/r/x1.txt': 'this is r/x1',
        'a/b/r/x2.txt': 'this is r/x2',
        'a/b/s/x1.txt': '1',
        'a/b/s/x2.txt': '2',
      })
    })
    test('record() yells if output location do not exist on the file system', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger)

      await expect(store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a')], 'OK')).rejects.toThrow(
        'Output location <a> does not exist (under',
      )
    })
    test('recreates the chain of directories to the designated location of the output', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          'a/b/c/d/e/f/x1.txt': 'this is x1',
          'a/b/c/d/e/f/x2.txt': 'this is x2',
        }),
      )
      await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a/b/c/d')], 'OK')

      const destination = newTaskStore(sc, logger)
      await destination.restoreTask(taskNameA, Fingerprint('fp'))
      expect(await slurp(destination.repoRootDir)).toEqual({
        'a/b/c/d/e/f/x1.txt': 'this is x1',
        'a/b/c/d/e/f/x2.txt': 'this is x2',
      })
    })
    test('uses content hashing', async () => {
      // it is hard to prove that we content hash is definitely used, but we can at least show that the amount of
      // additional storage that is needed when the same content is recorded twice is negligible.
      const sc = new InMemoryStorageClient(Int(20000))
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          x: chaoticDeterministicString(20000, 'a'),
        }),
      )

      expect(sc.byteCount).toEqual(0)
      await store.recordTask(taskNameA, Fingerprint('fp-1'), [PathInRepo('x')], 'OK')
      const c0 = sc.byteCount
      expect(c0).toBeGreaterThanOrEqual(10000)
      await store.recordTask(taskNameA, Fingerprint('fp-2'), [PathInRepo('x')], 'OK')
      const c1 = sc.byteCount
      expect(c1 - c0).toBeLessThan(500)
    })
    test('uses compression', async () => {
      // it is hard to prove that compression is definitely used, but we can at least show that the total storage space
      // is significantly smaller than the data that we wanted to store, when this data is highly repeatetive.
      const sc = new InMemoryStorageClient(Int(21000))
      const store = newTaskStore(
        sc,
        logger,
        await folderify({
          x: new Array(20000).fill('a').join(''),
        }),
      )

      expect(sc.byteCount).toEqual(0)
      await store.recordTask(taskNameA, Fingerprint('fp-1'), [PathInRepo('x')], 'OK')
      expect(sc.byteCount).toBeLessThan(500)
    })
    test('yells when output location is "a/b" but "a" is file', async () => {
      const sc = new InMemoryStorageClient()
      const store = newTaskStore(sc, logger, await folderify({ a: 'this is a' }))
      await expect(store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a/b')], 'OK')).rejects.toThrow(
        'Output location <a/b> does not exist',
      )
    })
    test('preserves modification time in milliseconds granularity', async () => {
      let n = 0
      let ok = 0
      let fail = 0
      let before: {x1: {mtime: number}, x2: {mtime: number}} = {x1: {mtime: 3}, x2: {mtime:3}}
      let after: {x1: {mtime: number}, x2: {mtime: number}} = {x1: {mtime: 0}, x2: {mtime:0}}
      for (let i = 0; i < 100; ++i) {
        acc.length = 0
        ++n
        try {
          const sc = new InMemoryStorageClient()
          const store = newTaskStore(
            sc,
            logger,
            await folderify({
              'a/b/x1.txt': 'this is x1',
              'a/b/x2.txt': 'this is x2',
            }),
          )

          async function takeSanpshot(root: RepoRoot) {
            const x1 = await fse.stat(root.resolve(PathInRepo('a/b/x1.txt')))
            const x2 = await fse.stat(root.resolve(PathInRepo('a/b/x2.txt')))
            return { x1: { mtime: x1.mtime.getTime() }, x2: { mtime: x2.mtime.getTime() } }
          }

          before = await takeSanpshot(store.repoRootDir)
          await store.recordTask(taskNameA, Fingerprint('fp'), [PathInRepo('a')], 'OK')

          const dest = newTaskStore(sc, logger)
          await dest.restoreTask(taskNameA, Fingerprint('fp'))
          after = await takeSanpshot(dest.repoRootDir)

          expect(after.x1).toEqual(before.x1)
          expect(after.x2).toEqual(before.x2)
          ++ok
        } catch (e) {
          console.log(JSON.stringify({acc, before, after}))
          ++fail
        }
      }
      expect({ n, ok, fail }).toEqual({ n: 100, ok: 100, fail: 0 })
    })
  })
})

// 20
