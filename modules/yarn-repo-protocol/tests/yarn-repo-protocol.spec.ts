import { createDefaultLogger } from 'logger'
import { folderify } from 'misc'
import { UnitId } from 'unit-metadata'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

describe('yarn-repo-protocol', () => {
  const logger = createDefaultLogger('/tmp/abc')
  test('finds all deps', async () => {
    const d = await folderify({
      'package.json': {
        workspaces: ['modules/*'],
        private: true,
      },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        dependencies: {
          b: '1.0.0',
          foo: '100.200.300',
        },
      },
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        dependencies: {
          b: '1.0.0',
          bar: '400.500.600',
        },
      },
    })

    const yrp = new YarnRepoProtocol(logger)
    await yrp.initialize(d)

    const p = await yrp.computePackingPackageJson(UnitId('a'))
    expect(p).toEqual({
      name: 'a',
      version: '1.0.0',
      dependencies: {
        foo: '100.200.300',
      },
    })
  })

  test('lorem ipsum', () => {
    expect(5).toEqual(5)
  })
})
