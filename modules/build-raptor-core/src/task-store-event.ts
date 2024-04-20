import { TaskName } from 'task-name'
export type TaskStoreEvent = {
  taskStore: {
    opcode: 'RECORDED' | 'RESTORED'
    taskName: TaskName
    // #TD(imaman): rename blobId to bundleId
    blobId: string
    fingerprint: string
    files: string[]
  }
  publicFiles: {
    taskName: TaskName
    /**
     * Maps path-in-repo to the hash of the contnet of the file
     */
    publicFiles: Record<string, string>
  }
}
