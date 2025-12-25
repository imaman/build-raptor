import * as fs from 'fs'
import { aTimeoutOf } from 'misc'
import * as Tmp from 'tmp-promise'
import { fileURLToPath } from 'url'

import { createDefaultLogger } from '../src/logger.js'

const __filename = fileURLToPath(import.meta.url)

async function awaitFor<T>(ms: number, calc: () => Promise<T | undefined>): Promise<T> {
  const t0 = Date.now()
  while (true) {
    const ret = await calc()
    if (ret) {
      return ret
    }
    const dt = Date.now() - t0
    if (dt > ms) {
      throw new Error('timeout')
    }

    await aTimeoutOf(50).hasPassed()
  }
}

async function readContent(path: string, sentinel: string): Promise<string> {
  return await awaitFor(2000, async () => {
    if (!fs.existsSync(path)) {
      return undefined
    }
    const content = fs.readFileSync(path, 'utf8')
    return content.includes(sentinel) ? content : undefined
  })
}

describe('logger', () => {
  test('writes the message to a file', async () => {
    const f = await Tmp.file({})
    const logger = createDefaultLogger(f.path, 'moderate')
    logger.info('foo')

    const content = await readContent(f.path, 'foo')
    expect(content.trim()).toMatch(
      /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z) \[info\] foo/,
    )
  })
  test('can write errors to a file', async () => {
    const f = await Tmp.file({ keep: true })
    const logger = createDefaultLogger(f.path, 'moderate')
    logger.error(`uh-oh`, new Error(`Huston, we have a problem`))

    const content = await readContent(f.path, 'we have a problem')

    const lines = content.split('\n')
    expect(lines[0]).toMatch(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z) \[error\] uh-oh/)
    expect(lines[1]).toContain(`${__filename.replace('/dist/', '/').replace(/\.js$/, '.ts')}:50:27`)
  })
  test('by default, does not write debug-level messages to the file', async () => {
    const f = await Tmp.file({})
    const logger = createDefaultLogger(f.path, 'moderate')
    logger.info(`Atlantic`)
    logger.debug(`Pacific`)
    logger.info(`Indian`)
    logger.info('-the end-')

    const content = await readContent(f.path, '-the end-')

    expect(content).toContain(`[info] Atlantic`)
    expect(content).toContain(`[info] Indian`)
    expect(content).not.toContain(`Pacific`)
    expect(content).not.toContain(`[debug]`)
  })
  test('when the log level is set to "debug", does write debug-level messages to the file', async () => {
    const f = await Tmp.file({})
    const logger = createDefaultLogger(f.path, 'moderate', 'debug')
    logger.info(`Atlantic`)
    logger.debug(`Pacific`)
    logger.info(`Indian`)
    logger.info('-the end-')

    const content = await readContent(f.path, '-the end-')

    expect(content).toContain(`[info] Atlantic`)
    expect(content).toContain(`[info] Indian`)
    expect(content).toContain(`[debug] Pacific`)
  })
  test('print() sends messages to the UI stream (in addition to the log file)', async () => {
    const f = await Tmp.file({})
    const ui = await Tmp.file({ keep: true })
    const uiStream = fs.createWriteStream(ui.path)

    const logger = createDefaultLogger(f.path, 'moderate', undefined, uiStream)
    logger.info(`Atlantic`)
    logger.print(`Pacific`)
    logger.info(`Indian`)
    logger.info(`-the end-`)

    const fileContent = await readContent(f.path, '-the end-')
    expect(fileContent).toContain(`[info] Pacific\n`)

    const uiContent = fs.readFileSync(ui.path, 'utf-8')
    expect(uiContent.trim()).toEqual('Pacific')
  })
  test(`print() prints the message only if the criticality of the message is higher than the log's`, async () => {
    const { path: lowFile } = await Tmp.file({})

    const { path: lowPrintFile } = await Tmp.file({ keep: true })
    const low = createDefaultLogger(lowFile, 'low', undefined, fs.createWriteStream(lowPrintFile))
    low.print(`Adriatic`, 'low')
    low.print(`Indian`, 'moderate')
    low.print(`Pacific`, 'high')
    low.info('-the end-')
    await readContent(lowFile, '-the end-')
    expect(fs.readFileSync(lowPrintFile, 'utf-8').trim()).toEqual('Adriatic\nIndian\nPacific')

    const { path: moderateFile } = await Tmp.file({})
    const { path: moderatePrintFile } = await Tmp.file({ keep: true })
    const moderate = createDefaultLogger(moderateFile, 'moderate', undefined, fs.createWriteStream(moderatePrintFile))
    moderate.print(`Adriatic`, 'low')
    moderate.print(`Indian`, 'moderate')
    moderate.print(`Pacific`, 'high')
    moderate.info('-the end-')
    await readContent(moderateFile, '-the end-')
    expect(fs.readFileSync(moderatePrintFile, 'utf-8').trim()).toEqual('Indian\nPacific')

    const { path: highFile } = await Tmp.file({})
    const { path: highPrintFile } = await Tmp.file({ keep: true })
    const high = createDefaultLogger(highFile, 'high', undefined, fs.createWriteStream(highPrintFile))
    high.print(`Adriatic`, 'low')
    high.print(`Indian`, 'moderate')
    high.print(`Pacific`, 'high')
    high.info('-the end-')
    await readContent(highFile, '-the end-')
    expect(fs.readFileSync(highPrintFile, 'utf-8').trim()).toEqual('Pacific')
  })
  test('additional objects are logged (in JSON format) after the text message', async () => {
    const f = await Tmp.file({})
    const ui = await Tmp.file({ keep: true })
    const uiStream = fs.createWriteStream(ui.path)

    const logger = createDefaultLogger(f.path, 'moderate', undefined, uiStream)
    logger.info(`Atlantic`, { maxDepth: 8376, waterVolum: '310,410,900 km^3' })
    logger.info(`Indian`, { maxDepth: 7258, surfacrArea: '70,560,000 km^2' })
    logger.info(`-the end-`)

    const fileContent = await readContent(f.path, '-the end-')
    expect(fileContent).toContain(`[info] Atlantic {"maxDepth":8376,"waterVolum":"310,410,900 km^3"}\n`)
    expect(fileContent).toContain(`[info] Indian {"maxDepth":7258,"surfacrArea":"70,560,000 km^2"}\n`)
  })
  test('wipes out the file', async () => {
    const f = await Tmp.file({})

    const logger1 = createDefaultLogger(f.path, 'moderate')
    logger1.info(`Atlantic`)
    logger1.info(`EOF-1`)

    const content1 = await readContent(f.path, 'EOF-1')
    expect(content1.split('\n')[0]).toContain('Atlantic')

    const logger2 = createDefaultLogger(f.path, 'moderate')
    logger2.info(`Indian`)
    logger2.info(`EOF-2`)

    const content2 = await readContent(f.path, 'EOF-2')
    expect(content2).not.toContain('Atlantic')
    expect(content2.split('\n')[0]).toContain('Indian')
  })
})
