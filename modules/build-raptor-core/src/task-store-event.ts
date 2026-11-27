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
  /**
   * A verdict was found for the task but some of the objects it refers to (the bundle, or a public file) are missing
   * from the storage. The task store treats this as a cache miss.
   */
  taskStoreIncomplete: {
    taskName: TaskName
    blobId: string
    fingerprint: string
    /**
     * Describes the object that was found missing
     */
    missing: string
  }
  publicFiles: {
    taskName: TaskName
    /**
     * Maps path-in-repo to the hash of the contnet of the file
     */
    publicFiles: Record<string, string>
  }
}
