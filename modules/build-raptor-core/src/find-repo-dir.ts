export function findRepoDir(dir: string) {
  while (true) {
    const pj = path.join(dir, 'package.json')
    const ex = fs.existsSync(pj)
    if (ex) {
      const content = JSON.parse(fs.readFileSync(pj, 'utf-8'))
      const keys = Object.keys(content)
      if (keys.includes('workspaces')) {
        return dir
      }
    }

    const next = path.dirname(dir)
    if (next === dir) {
      return undefined
    }
    dir = next
  }
}
