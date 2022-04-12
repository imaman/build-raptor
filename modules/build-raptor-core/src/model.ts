import { BuildRunId } from 'build-run-id'
import { findDups, Graph, uniqueBy } from 'misc'
import * as path from 'path'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Fingerprinter } from './fingerprinter'

export class Model {
  constructor(
    readonly rootDir: string,
    readonly graph: Graph<UnitId>,
    readonly units: UnitMetadata[],
    readonly buildRunId: BuildRunId,
    private readonly fingerprinter: Fingerprinter,
  ) {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`Root dir must be absolute path (got: ${rootDir})`)
    }

    const dupUnitIds = findDups(units, u => u.id).map(u => u.id)
    if (dupUnitIds.length) {
      throw new Error(`Unit ID collision detected: ${JSON.stringify(uniqueBy(dupUnitIds, x => x))}`)
    }
    this.rootDir = path.resolve(rootDir)
  }

  async fingerprintOfDir(pathInRepo: string) {
    return await this.fingerprinter.computeFingerprint(pathInRepo)
  }

  getUnit(id: UnitId): UnitMetadata {
    const ret = this.units.find(u => u.id === id)
    if (!ret) {
      throw new Error(`Unit ${id} not found`)
    }
    return ret
  }

  unitId(id: string): UnitId {
    const ret = this.units.find(u => u.id === id)
    if (!ret) {
      throw new Error(`Unit ${id} not found`)
    }

    return UnitId(id)
  }

  unitDependenciesOf(unitId: UnitId): UnitMetadata[] {
    return this.graph.neighborsOf(unitId).map(at => this.getUnit(at))
  }
}
