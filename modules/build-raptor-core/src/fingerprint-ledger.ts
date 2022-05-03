import { BuildRunId } from 'build-run-id'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { failMe } from 'misc'
import { TaskName } from 'task-name'
import { z } from 'zod'

import { Fingerprint } from './fingerprint'
import { Hasher } from './hasher'

const LedgerItem = z.union([
  z.object({ tag: z.literal('file'), file: z.string(), fingerprint: z.string() }),
  z.object({ tag: z.literal('task'), task: z.string(), fingerprint: z.string(), locations: z.string().array() }),
  z.object({ tag: z.literal('run'), buildRunId: z.string() }),
])

type LedgerItem = z.infer<typeof LedgerItem>

const Items = LedgerItem.array()
type Items = z.infer<typeof Items>

export class FingerprintLedger {
  private items: Items = []
  constructor(private readonly logger: Logger, private readonly ledgerFile: string) {}

  async updateRun(buildRunId: BuildRunId) {
    // Validate the stored content by reading it.
    await this.read()
    this.items.push({ tag: 'run', buildRunId })
  }

  update(h: Hasher): void {
    const json = h.toJSON()
    this.items.push({
      tag: 'file',
      fingerprint: json.digest ?? failMe(`got an undefined digest in ${JSON.stringify(json)}`),
      file: json.hasherName,
    })
  }

  updateTask(task: TaskName, fingerprint: Fingerprint, locations: string[]): void {
    this.items.push({ tag: 'task', task, fingerprint, locations })

    this.logger.info(`Fingerprint of task ${task} with inputs: ${JSON.stringify(locations)} is ${fingerprint}`)
  }

  async close() {
    const preexisting = await this.read()
    preexisting.push(...this.items)
    await this.write(preexisting)
  }

  private async read() {
    if (!(await fse.pathExists(this.ledgerFile))) {
      return []
    }
    const untyped = await fse.readJSON(this.ledgerFile)
    return Items.parse(untyped)
  }

  private async write(items: Items) {
    await fse.writeJSON(this.ledgerFile, items)
  }
}
