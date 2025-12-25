import { BuildRunId } from 'build-run-id'
import { RepoRoot } from 'core-types'
import { createNopLogger } from 'logger'
import { DirectoryScanner, Graph } from 'misc'
import * as Tmp from 'tmp-promise'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Fingerprinter } from '../src/fingerprinter.js'
import { Model } from '../src/model.js'

describe('model', () => {
  test('yells on duplicate unit IDs', async () => {
    const g = new Graph<UnitId>(x => x)
    const units = [
      new UnitMetadata('p1', UnitId('a')),
      new UnitMetadata('p1', UnitId('b')),
      new UnitMetadata('p1', UnitId('a')),
    ]

    const ds = new DirectoryScanner((await Tmp.dir()).path)
    const fingerprinter = new Fingerprinter(ds, createNopLogger(), '8')

    expect(() => new Model(RepoRoot('/d'), g, units, BuildRunId('a'), fingerprinter)).toThrowError(
      'Unit ID collision detected: ["a"]',
    )
  })
})
