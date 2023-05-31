import { TaskName } from 'task-name'
export type TaskStoreEvent = {
  taskStore: {
    opcode: 'RECORDED' | 'RESTORED'
    taskName: TaskName
    blobId: string
    fingerprint: string
    files: string[]
  }
}
