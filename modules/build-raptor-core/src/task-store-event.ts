import { TaskName } from 'task-name'
export type TaskStoreEvent = {
  taskStore: {
    opcode: 'RECORDED' | 'RESTORED'
    taskName: TaskName
    blobId: string
    bytes: number
    files: readonly string[]
  }
}
