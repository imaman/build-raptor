import { Graph } from 'misc'
import { TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

export function generateTaskInfos(
  units: UnitMetadata[],
  graph: Graph<UnitId>,
  depFunc: (t: TaskName) => TaskName[],
  buildOutputLocations: string[],
) {
  return units.flatMap(u => {
    const deps = graph.traverseFrom(u.id).filter(at => at !== u.id)

    const buildTaskName = TaskName(u.id, TaskKind('build'))

    const build: TaskInfo = {
      taskName: buildTaskName,
      inputs: [u.pathInRepo],
      outputLocations: buildOutputLocations.map(at => ({ pathInRepo: u.pathInRepo.expand(at), purge: 'NEVER' })),
      deps: [...deps.map(d => TaskName(d, TaskKind('build'))), ...depFunc(buildTaskName)],
    }

    const testTaskName = TaskName(u.id, TaskKind('test'))
    const test: TaskInfo = {
      taskName: testTaskName,
      inputs: [u.pathInRepo],
      deps: [build.taskName, ...depFunc(testTaskName)],
    }
    return [build, test]
  })
}
