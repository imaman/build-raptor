import { DirectoryScanner } from 'misc'

async function main() {
  const scanner = new DirectoryScanner('/home/imaman/code/imaman/build-raptor')
  await scanner.scanTree('node_modules', (p, _content, stat) => {
    // eslint-disable-next-line no-console
    console.log(`${p} ${stat.isSymbolicLink() ? 'symlink' : ''}`)
  })
}

main()
