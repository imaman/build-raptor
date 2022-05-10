import { BuildRunId } from 'build-run-id'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { failMe } from 'misc'
import { TaskName } from 'task-name'
import { z } from 'zod'

import { Fingerprint } from './fingerprint'
import { Hasher } from './hasher'

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

export class FingerprintLedger {
  private items: Items = []
  private buildRunId?: BuildRunId
  constructor(private readonly logger: Logger, private readonly ledgerFile: string) {}

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
    // const preexisting = await this.read()
    // preexisting.push(...this.items)
    // await this.write(preexisting)
  }

  private async read() {
    return []
    // if (!(await fse.pathExists(this.ledgerFile))) {
    //   return []
    // }
    // const untyped = await fse.readJSON(this.ledgerFile)
    // return Items.parse(untyped)
  }

  private async write(items: Items) {
    await fse.writeJSON(this.ledgerFile, items)
  }
}
