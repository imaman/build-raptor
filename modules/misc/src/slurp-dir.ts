import { DirectoryScanner } from './index.js'

export async function slurpDir(rootDir: string): Promise<Record<string, string | string>> {
  const scanner = new DirectoryScanner(rootDir)

  const ret: Record<string, string> = {}
  await scanner.scanTree('', (relativePath, buf) => {
    const str = buf.toString('utf-8')
    ret[relativePath] = str
  })
  return ret
}
