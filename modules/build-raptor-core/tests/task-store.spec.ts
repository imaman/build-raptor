import * as fse from 'fs-extra'
import { createNopLogger } from 'logger'
import { chaoticDeterministicString, folderify, InMemoryStorageClient, Int, slurpDir } from 'misc'
import * as path from 'path'
import { TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'

import { Fingerprint } from '../src/fingerprint'
import { TaskStore } from '../src/task-store'

/* eslint-disable @typescript-eslint/consistent-type-assertions */
// TODO(imaman): introduce a helper function to avoid all those 'as' expressions.
describe('task-store', () => {
  const logger = createNopLogger()
  async function recordVerdict(
    store: TaskStore,
    taskName: TaskName,
    fingerprint: string,
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    const tmpDir = await Tmp.dir()
    return store.recordTask(taskName, Fingerprint(fingerprint), tmpDir.path, [], verdict)
  }
  async function getVerdict(store: TaskStore, taskName: TaskName, fingerprint: string): Promise<string> {
    const tmpDir = await Tmp.dir()
    return store.restoreTask(taskName, Fingerprint(fingerprint), tmpDir.path)
  }
  describe('recordVerdict()/getVerdict()', () => {
    test('presists a verdict for a task', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      await recordVerdict(store, 'foo' as TaskName, Fingerprint('fp-1'), 'OK')
      expect(await getVerdict(store, 'foo' as TaskName, Fingerprint('fp-1'))).toEqual('OK')
    })
    test('does not mix tasks', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      await recordVerdict(store, 'TASK-A' as TaskName, Fingerprint('fp-1'), 'FAIL')
      await recordVerdict(store, 'TASK-B' as TaskName, Fingerprint('fp-1'), 'OK')
      expect(await getVerdict(store, 'TASK-A' as TaskName, Fingerprint('fp-1'))).toEqual('FAIL')
      expect(await getVerdict(store, 'TASK-B' as TaskName, Fingerprint('fp-1'))).toEqual('OK')
    })
    test('does not mix fingerprints', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      await recordVerdict(store, 'task-foo' as TaskName, Fingerprint('FP-1'), 'OK')
      await recordVerdict(store, 'task-foo' as TaskName, Fingerprint('FP-2'), 'FAIL')
      expect(await getVerdict(store, 'task-foo' as TaskName, Fingerprint('FP-1'))).toEqual('OK')
      expect(await getVerdict(store, 'task-foo' as TaskName, Fingerprint('FP-2'))).toEqual('FAIL')
    })
    test('data is persisted across different instances of TaskStore', async () => {
      const sc = new InMemoryStorageClient()

      const storeA = new TaskStore(sc, logger)
      const storeB = new TaskStore(sc, logger)

      await recordVerdict(storeA, 'task-foo' as TaskName, Fingerprint('fp-1'), 'OK')
      await recordVerdict(storeA, 'task-bar' as TaskName, Fingerprint('fp-2'), 'FAIL')
      await recordVerdict(storeB, 'task-foo' as TaskName, Fingerprint('fp-3'), 'FAIL')
      await recordVerdict(storeB, 'task-bar' as TaskName, 'fp-4', 'OK')

      expect(await getVerdict(storeA, 'task-foo' as TaskName, Fingerprint('fp-1'))).toEqual('OK')
      expect(await getVerdict(storeA, 'task-bar' as TaskName, Fingerprint('fp-2'))).toEqual('FAIL')
      expect(await getVerdict(storeA, 'task-foo' as TaskName, Fingerprint('fp-3'))).toEqual('FAIL')
      expect(await getVerdict(storeA, 'task-bar' as TaskName, 'fp-4')).toEqual('OK')

      expect(await getVerdict(storeB, 'task-foo' as TaskName, Fingerprint('fp-1'))).toEqual('OK')
      expect(await getVerdict(storeB, 'task-bar' as TaskName, Fingerprint('fp-2'))).toEqual('FAIL')
      expect(await getVerdict(storeB, 'task-foo' as TaskName, Fingerprint('fp-3'))).toEqual('FAIL')
      expect(await getVerdict(storeB, 'task-bar' as TaskName, 'fp-4')).toEqual('OK')
    })
  })
  describe('recording/restoration of output locations', () => {
    test('it can store an entire directory and the restore it at a given destination', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
      await store.recordTask('foo' as TaskName, Fingerprint('bar'), dir, ['qux'], 'OK')

      const destination = (await Tmp.dir()).path
      await store.restoreTask('foo' as TaskName, Fingerprint('bar'), destination)

      expect(await slurpDir(destination)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
    })
    test('after restore, the destination is identical to the original directory that was recorded', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
      await store.recordTask('foo' as TaskName, Fingerprint('bar'), dir, ['qux'], 'OK')

      const destination = await folderify({
        'qux/f1.txt': 'We choose to go to the Moon',
        'qux/f3.txt': 'in this decade',
      })
      await store.restoreTask('foo' as TaskName, Fingerprint('bar'), destination)

      expect(await slurpDir(destination)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
    })
    test('files outside of the output directories are not changed', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
      })
      await store.recordTask('foo' as TaskName, Fingerprint('bar'), dir, ['qux'], 'OK')

      const destination = await folderify({
        readme: 'very important things',
        'foo/goo/f1.txt': 'We choose to go to the Moon',
      })
      await store.restoreTask('foo' as TaskName, Fingerprint('bar'), destination)

      expect(await slurpDir(destination)).toEqual({
        'qux/f1.txt': 'four scores',
        'qux/f2.txt': 'and seven years ago',
        'foo/goo/f1.txt': 'We choose to go to the Moon',
        readme: 'very important things',
      })
    })
    test('stores only files from the given output directories', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'bourne/i': 'The Bourne Identity',
        'bourne/ii': 'The Bourne Supremacy',
        'bourne/iii': 'The Bourne Ultimatum',
        'starwars/i': 'The Phantom Menace',
        'starwars/ii': 'Attack of the Clones',
        'starwars/iii': 'Revenge of the Sith',
      })
      await store.recordTask('foo' as TaskName, Fingerprint('bar'), dir, ['bourne'], 'OK')

      const destination = await folderify({
        'thegodfather/i': 'The Godfather',
        'thegodfather/ii': 'The Godfather Part II',
        'thegodfather/iii': 'The Godfather Part III',
      })

      await store.restoreTask('foo' as TaskName, Fingerprint('bar'), destination)

      expect(await slurpDir(destination)).toEqual({
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
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'bourne/actors': 'Matt Damon',
        'starwars/actors': 'Mark Hamill',
        'thegodfather/i': 'Al Pacino',
      })
      await store.recordTask('TASK-A' as TaskName, Fingerprint('fp-1'), dir, ['bourne'], 'OK')
      await store.recordTask('TASK-B' as TaskName, Fingerprint('fp-1'), dir, ['starwars'], 'OK')
      await store.recordTask('TASK-C' as TaskName, Fingerprint('fp-1'), dir, ['thegodfather'], 'OK')

      const destination = await folderify({})

      await store.restoreTask('TASK-A' as TaskName, Fingerprint('fp-1'), destination)
      expect(await slurpDir(destination)).toEqual({
        'bourne/actors': 'Matt Damon',
      })

      await store.restoreTask('TASK-B' as TaskName, Fingerprint('fp-1'), destination)
      expect(await slurpDir(destination)).toEqual({
        'bourne/actors': 'Matt Damon',
        'starwars/actors': 'Mark Hamill',
      })

      await store.restoreTask('TASK-C' as TaskName, Fingerprint('fp-1'), destination)
      expect(await slurpDir(destination)).toEqual({
        'bourne/actors': 'Matt Damon',
        'starwars/actors': 'Mark Hamill',
        'thegodfather/i': 'Al Pacino',
      })
    })
    test('does not mix fingerprints', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      await store.recordTask(
        'my-task' as TaskName,
        Fingerprint('FP-1'),
        await folderify({ 'year/starwars': '1977' }),
        ['year'],
        'OK',
      )
      await store.recordTask(
        'my-task' as TaskName,
        Fingerprint('FP-2'),
        await folderify({ 'year/heat': '1995' }),
        ['year'],
        'OK',
      )
      await store.recordTask(
        'my-task' as TaskName,
        Fingerprint('FP-3'),
        await folderify({ 'year/prestige': '2006' }),
        ['year'],
        'OK',
      )

      const dest1 = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('FP-2'), dest1)
      expect(await slurpDir(dest1)).toEqual({
        'year/heat': '1995',
      })
      const dest2 = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('FP-2'), dest2)
      expect(await slurpDir(dest1)).toEqual({
        'year/heat': '1995',
      })
      const dest3 = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('FP-2'), dest3)
      expect(await slurpDir(dest1)).toEqual({
        'year/heat': '1995',
      })
    })
    test('outputs can be files and not just folders', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({ 'a.txt': 'foo' })
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a.txt'], 'OK')

      const dest = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      expect(await slurpDir(dest)).toEqual({
        'a.txt': 'foo',
      })
    })
    test('outputs can be deeply nested under sub-dirs', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/b/c/d/index.js': 'foo',
        'a/b/c/f/index.js': Fingerprint('bar'),
        'a/b/index.js': 'goo',
      })
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a/b/c'], 'OK')

      const dest = await folderify({
        'a/b/index.js': 'moo',
      })
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      expect(await slurpDir(dest)).toEqual({
        'a/b/c/d/index.js': 'foo',
        'a/b/c/f/index.js': Fingerprint('bar'),
        'a/b/index.js': 'moo',
      })
    })
    test('does not include files that happen to be a prefix of the requested output path', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/b/index.js': 'let me in',
        'a/bb/index.js': "don't let me in",
        'a/bbc': 'me neither',
      })
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a/b'], 'OK')

      const dest = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      expect(await slurpDir(dest)).toEqual({
        'a/b/index.js': 'let me in',
      })
    })
    test('restore retains the mtime and mode values of the files', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/f1': 'c1',
        'a/f2': 'c1',
        'a/f3': 'c1',
      })

      await fse.chmod(path.join(dir, 'a/f1'), 0o755)
      await fse.chmod(path.join(dir, 'a/f2'), 0o640)
      await fse.utimes(path.join(dir, 'a/f2'), new Date(0), new Date(2000))
      await fse.utimes(path.join(dir, 'a/f3'), new Date(0), new Date(3000))

      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a'], 'OK')

      const dest = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)

      const stat1 = await fse.stat(path.join(dest, 'a/f1'))
      expect(stat1.mode).toEqual(0o100755)

      const stat2 = await fse.stat(path.join(dest, 'a/f2'))
      expect(stat2.mtime.getTime()).toEqual(2000)
      expect(stat2.mode).toEqual(0o100640)

      const stat3 = await fse.stat(path.join(dest, 'a/f3'))
      expect(stat3.mtime.getTime()).toEqual(3000)
    })
    test('handles multiple output locations', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/b/q/x1.txt': 'this is q/x1',
        'a/b/q/x2.txt': 'this is q/x2',
        'a/b/r/x1.txt': 'this is r/x1',
        'a/b/r/x2.txt': 'this is r/x2',
        'a/b/s/x1.txt': 'this is s/x1',
        'a/b/s/x2.txt': 'this is s/x2',
      })
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a/b/q', 'a/b/r'], 'OK')
      const dest = await folderify({
        'a/b/s/x1.txt': '1',
        'a/b/s/x2.txt': '2',
      })
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      expect(await slurpDir(dest)).toEqual({
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
      const store = new TaskStore(sc, logger)

      const dir = await folderify({})
      await expect(store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a'], 'OK')).rejects.toThrow(
        'Output location <a> does not exist (under',
      )
    })
    test('recreates the chain of directories to the designated location of the output', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/b/c/d/e/f/x1.txt': 'this is x1',
        'a/b/c/d/e/f/x2.txt': 'this is x2',
      })
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a/b/c/d'], 'OK')

      const dest = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      expect(await slurpDir(dest)).toEqual({
        'a/b/c/d/e/f/x1.txt': 'this is x1',
        'a/b/c/d/e/f/x2.txt': 'this is x2',
      })
    })
    test('uses content hashing', async () => {
      // it is hard to prove that we content hash is definitely used, but we can at least show that the amount of
      // additional storage that is needed when the same content is recorded twice is negligible.
      const sc = new InMemoryStorageClient(Int(21000))
      const store = new TaskStore(sc, logger)

      const dir1 = await folderify({
        x: chaoticDeterministicString(20000, 'a'),
      })

      expect(sc.byteCount).toEqual(0)
      await store.recordTask('my-task' as TaskName, Fingerprint('fp-1'), dir1, ['x'], 'OK')
      const c0 = sc.byteCount
      expect(c0).toBeGreaterThanOrEqual(10000)
      await store.recordTask('my-task' as TaskName, Fingerprint('fp-2'), dir1, ['x'], 'OK')
      const c1 = sc.byteCount
      expect(c1 - c0).toBeLessThan(500)
    })
    test('uses compression', async () => {
      // it is hard to prove that compression is definitely used, but we can at least show that the total storage space
      // is significantly smaller than the data that we wanted to store, when this data is highly repeatetive.
      const sc = new InMemoryStorageClient(Int(21000))
      const store = new TaskStore(sc, logger)

      const dir1 = await folderify({
        x: new Array(20000).fill('a').join(''),
      })

      expect(sc.byteCount).toEqual(0)
      await store.recordTask('my-task' as TaskName, Fingerprint('fp-1'), dir1, ['x'], 'OK')
      expect(sc.byteCount).toBeLessThan(500)
    })
    test('yells when output location is "a/b" but "a" is file', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({ a: 'this is a' })
      await expect(store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a/b'], 'OK')).rejects.toThrow(
        'Output location <a/b> does not exist',
      )
    })
    test('preserves modification time', async () => {
      const sc = new InMemoryStorageClient()
      const store = new TaskStore(sc, logger)

      const dir = await folderify({
        'a/b/x1.txt': 'this is x1',
        'a/b/x2.txt': 'this is x2',
      })

      async function takeSanpshot(dir: string) {
        const x1 = await fse.stat(path.join(dir, 'a/b/x1.txt'))
        const x2 = await fse.stat(path.join(dir, 'a/b/x2.txt'))
        return { x1: { mtime: x1.mtimeMs, ctime: x1.ctimeMs }, x2: { mtime: x2.mtimeMs, ctime: x2.ctimeMs } }
      }

      const before = await takeSanpshot(dir)
      await store.recordTask('my-task' as TaskName, Fingerprint('fp'), dir, ['a'], 'OK')

      const dest = await folderify({})
      await store.restoreTask('my-task' as TaskName, Fingerprint('fp'), dest)
      const after = await takeSanpshot(dest)

      expect(after.x1).toEqual(before.x1)
      expect(after.x2).toEqual(before.x2)
    })
  })
})
