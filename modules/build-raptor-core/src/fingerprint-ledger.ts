import { BuildRunId } from 'build-run-id'
import fse from 'fs-extra/esm'
import { Logger } from 'logger'
import { failMe } from 'misc'
import { TaskName } from 'task-name'
import { z } from 'zod'

import { Fingerprint } from './fingerprint.js'
import { Hasher } from './hasher.js'

const LedgerItem = z.union([
  z.object({
    tag: z.literal('file'),
    buildRunId: z.string(),
    location: z.string(),
    fingerprint: z.string(),
    content: z.string(),
  }),
  z.object({
    tag: z.literal('dir'),
    buildRunId: z.string(),
    location: z.string(),
    fingerprint: z.string(),
    parts: z.record(z.string(), z.string()),
  }),
  z.object({
    tag: z.literal('task'),
    buildRunId: z.string(),
    task: z.string(),
    fingerprint: z.string(),
    parts: z.record(z.string(), z.string()),
  }),
  z.object({ tag: z.literal('run'), buildRunId: z.string() }),
])

type LedgerItem = z.infer<typeof LedgerItem>

const Items = LedgerItem.array()
type Items = z.infer<typeof Items>

export interface FingerprintLedger {
  updateRun(buildRunId: BuildRunId): Promise<void>
  updateFile(h: Hasher, content: string): void
  updateDirectory(h: Hasher): void
  updateTask(task: TaskName, fingerprint: Fingerprint, parts: Record<string, Fingerprint>): void
  close(): Promise<void>
}

export class NopFingerprintLedger implements FingerprintLedger {
  async updateRun(): Promise<void> {}
  updateFile(): void {}
  updateDirectory(): void {}
  updateTask(): void {}
  async close(): Promise<void> {}
}

export class PersistedFingerprintLedger implements FingerprintLedger {
  private items: Items = []
  private buildRunId?: BuildRunId
  constructor(private readonly logger: Logger, private readonly ledgerFile: string) {
    this.logger.info(`fingerprint ledger initialized with file=${this.ledgerFile}`)
  }

  async updateRun(buildRunId: BuildRunId) {
    // Validate the stored content by reading it.
    await this.read()
    this.items.push({ tag: 'run', buildRunId })
    this.buildRunId = buildRunId
  }

  updateFile(h: Hasher, content: string): void {
    const json = h.toJSON()
    this.items.push({
      tag: 'file',
      buildRunId: this.buildRunId ?? failMe('build run ID is missing'),
      location: json.hasherName,
      fingerprint: json.digest ?? failMe(`got an undefined digest in ${JSON.stringify(json)}`),
      content,
    })
  }

  updateDirectory(h: Hasher): void {
    const json = h.toJSON()
    this.items.push({
      tag: 'dir',
      buildRunId: this.buildRunId ?? failMe('build run ID is missing'),
      location: json.hasherName,
      fingerprint: json.digest ?? failMe(`got an undefined digest in ${JSON.stringify(json)}`),
      parts: json.audit,
    })
  }

  updateTask(task: TaskName, fingerprint: Fingerprint, parts: Record<string, Fingerprint>): void {
    this.items.push({
      tag: 'task',
      buildRunId: this.buildRunId ?? failMe('build run ID is missing'),
      task,
      fingerprint,
      parts,
    })

    this.logger.info(`Fingerprint of task ${task} with inputs: ${JSON.stringify(parts)} is ${fingerprint}`)
  }

  async close() {
    const t0 = Date.now()
    try {
      const itemsToWrite = await this.read()
      itemsToWrite.push(...this.items)
      await this.write(itemsToWrite)
    } finally {
      this.logger.info(`.close() took ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    }
  }

  // TODO(imaman): cover
  private async read() {
    const t0 = Date.now()
    try {
      if (!(await fse.pathExists(this.ledgerFile))) {
        return []
      }
      const untyped = await fse.readJSON(this.ledgerFile)
      const ret = Items.parse(untyped)
      const len = JSON.stringify(ret).length
      this.logger.info(`Length of content read from ${this.ledgerFile} is ${len}`)
      if (len > TRUNCATION_THRESHOLD) {
        this.logger.info(
          `Discarding the preexsiting content of ${this.ledgerFile} because its length (${len}) exceeded the preset limit of ${TRUNCATION_THRESHOLD}`,
        )
        ret.length = 0
      }
      return ret
    } finally {
      this.logger.info(`.read() on ${this.ledgerFile} took ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    }
  }

  private async write(items: Items) {
    try {
      await fse.writeJSON(this.ledgerFile, items)
    } catch (e) {
      this.logger.error(`writeFile failed`, e)
      throw new Error(`Could not save ${items.length} items to ${this.ledgerFile} due to: ${e}`)
    }
  }
}

/**
 * If the length of the ledger that was read from the file exceeds this value, the ledger will be purged to avoid
 * errors on the subsequent save.
 */
const TRUNCATION_THRESHOLD = 200 * 1000 * 1000
