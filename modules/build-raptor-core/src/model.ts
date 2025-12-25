import { BuildRunId } from 'build-run-id'
import { PathInRepo, RepoRoot } from 'core-types'
import { findDups, Graph, uniqueBy } from 'misc'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Fingerprinter } from './fingerprinter'

export class Model {
  constructor(
    readonly rootDir: RepoRoot,
    readonly graph: Graph<UnitId>,
    readonly units: UnitMetadata[],
    readonly buildRunId: BuildRunId,
    private readonly fingerprinter: Fingerprinter,
  ) {
    const dupUnitIds = findDups(units, u => u.id).map(u => u.id)
    if (dupUnitIds.length) {
      throw new Error(`Unit ID collision detected: ${JSON.stringify(uniqueBy(dupUnitIds, x => x))}`)
    }
  }

  async fingerprintOfDir(pathInRepo: PathInRepo) {
    return await this.fingerprinter.computeFingerprint(pathInRepo.val)
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
