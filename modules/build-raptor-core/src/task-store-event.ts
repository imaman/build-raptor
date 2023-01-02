import { TaskName } from 'task-name'
export type TaskStoreEvent = {
  taskRecorded: { taskName: TaskName; blobId: string }
  taskRestored: { taskName: TaskName; blobId: string }
}
