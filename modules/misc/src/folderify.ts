import fse from 'fs-extra/esm'
import * as path from 'path'
import * as Tmp from 'tmp-promise'

import { shouldNeverHappen } from './constructs.js'

type Jsonable = { [x: string]: string | number | boolean | string[] | number[] | boolean | Jsonable | Jsonable[] }

export type FolderifyRecipe = Record<string, string | Jsonable>
export async function folderify(prefix: string, recipe: FolderifyRecipe): Promise<string>
export async function folderify(recipe: FolderifyRecipe): Promise<string>
export async function folderify(...args: [string, FolderifyRecipe] | [FolderifyRecipe]): Promise<string> {
  const recipe = args.length === 2 ? args[1] : args.length === 1 ? args[0] : shouldNeverHappen(args)
  const prefix = args.length === 2 ? args[0] : args.length === 1 ? '' : shouldNeverHappen(args)

  const ret = (await Tmp.dir()).path
  await writeRecipe(path.join(ret, prefix), recipe)
  return ret
}

export async function writeRecipe(destinationDir: string, recipe: FolderifyRecipe) {
  const keys = Object.keys(recipe).map(p => path.normalize(p))
  const set = new Set<string>(keys)
  for (const key of keys) {
    if (key === '.') {
      throw new Error(`bad input - the recipe contains a file name which is either empty ('') or a dot ('.')`)
    }
    let curr = key
    while (true) {
      curr = path.dirname(curr)
      if (curr === '.') {
        break
      }

      if (set.has(curr)) {
        throw new Error(`bad input - a file (${key}) is nested under another file (${curr})`)
      }
    }
  }
  const createFile = async (relativePath: string, content: string | Jsonable) => {
    const file = path.join(destinationDir, relativePath)
    const dir = path.dirname(file)
    await fse.mkdirp(dir)
    try {
      if (typeof content === 'string') {
        await fse.writeFile(file, content)
      } else {
        await fse.writeJSON(file, content)
      }
    } catch (e) {
      throw new Error(`writeRecipe() failed to write file ${relativePath} under ${destinationDir}: ${e}`)
    }
  }
  // TODO(imaman): Use promises()
  await Promise.all(Object.entries(recipe).map(async ([key, value]) => await createFile(key, value)))
}
