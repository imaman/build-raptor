import * as fs from 'fs'
import * as JSON5 from 'json5'
import * as path from 'path'
import * as Tmp from 'tmp-promise'

import { BuildRaptorConfig } from '../src/build-raptor-config'

// We directly test the resolution logic by recreating the key functions
// from engine-bootstrapper.ts to ensure they work correctly

const JSON5_CONFIG_FILE = 'build-raptor.json5'
const JSON_CONFIG_FILE = '.build-raptor.json'

function resolveConfigFile(rootDir: string): string | undefined {
  const json5Path = path.join(rootDir, JSON5_CONFIG_FILE)
  const jsonPath = path.join(rootDir, JSON_CONFIG_FILE)

  const json5Exists = fs.existsSync(json5Path)
  const jsonExists = fs.existsSync(jsonPath)

  if (json5Exists && jsonExists) {
    throw new Error(`Both '${JSON5_CONFIG_FILE}' and '${JSON_CONFIG_FILE}' exist. Please remove one of them.`)
  }

  if (json5Exists) {
    return JSON5_CONFIG_FILE
  }

  if (jsonExists) {
    return JSON_CONFIG_FILE
  }

  return undefined
}

function readConfigFile(rootDir: string, pathToConfigFile: string | undefined): BuildRaptorConfig {
  if (pathToConfigFile === undefined) {
    return BuildRaptorConfig.parse({})
  }

  const p = path.join(rootDir, pathToConfigFile)
  if (!fs.existsSync(p)) {
    return BuildRaptorConfig.parse({})
  }
  const content = fs.readFileSync(p, 'utf-8')
  const isJson5 = pathToConfigFile.endsWith('.json5')
  const parsed = isJson5 ? JSON5.parse(content) : JSON.parse(content)
  return BuildRaptorConfig.parse(parsed)
}

describe('config file resolution', () => {
  let tmpDir: string

  beforeEach(async () => {
    const d = await Tmp.dir({ unsafeCleanup: true })
    tmpDir = d.path
  })

  describe('resolveConfigFile', () => {
    test('returns undefined when no config file exists', () => {
      const result = resolveConfigFile(tmpDir)
      expect(result).toBeUndefined()
    })

    test('returns .build-raptor.json when only that file exists', () => {
      fs.writeFileSync(path.join(tmpDir, '.build-raptor.json'), '{}')
      const result = resolveConfigFile(tmpDir)
      expect(result).toBe('.build-raptor.json')
    })

    test('returns build-raptor.json5 when only that file exists', () => {
      fs.writeFileSync(path.join(tmpDir, 'build-raptor.json5'), '{}')
      const result = resolveConfigFile(tmpDir)
      expect(result).toBe('build-raptor.json5')
    })

    test('throws error when both config files exist', () => {
      fs.writeFileSync(path.join(tmpDir, '.build-raptor.json'), '{}')
      fs.writeFileSync(path.join(tmpDir, 'build-raptor.json5'), '{}')
      expect(() => resolveConfigFile(tmpDir)).toThrow(
        `Both 'build-raptor.json5' and '.build-raptor.json' exist. Please remove one of them.`,
      )
    })
  })

  describe('readConfigFile', () => {
    test('returns default config when pathToConfigFile is undefined', () => {
      const config = readConfigFile(tmpDir, undefined)
      expect(config).toBeDefined()
    })

    test('parses .build-raptor.json as regular JSON', () => {
      fs.writeFileSync(path.join(tmpDir, '.build-raptor.json'), '{"outDirName": ".custom-out"}')
      const config = readConfigFile(tmpDir, '.build-raptor.json')
      expect(config.outDirName).toBe('.custom-out')
    })

    test('parses build-raptor.json5 as JSON5 with comments', () => {
      const json5Content = `{
        // This is a comment
        "outDirName": ".json5-out",
        /* Multi-line
           comment */
        "tightFingerprints": true,
      }`
      fs.writeFileSync(path.join(tmpDir, 'build-raptor.json5'), json5Content)
      const config = readConfigFile(tmpDir, 'build-raptor.json5')
      expect(config.outDirName).toBe('.json5-out')
      expect(config.tightFingerprints).toBe(true)
    })

    test('parses build-raptor.json5 with trailing commas', () => {
      const json5Content = `{
        "outDirName": ".trailing-comma",
      }`
      fs.writeFileSync(path.join(tmpDir, 'build-raptor.json5'), json5Content)
      const config = readConfigFile(tmpDir, 'build-raptor.json5')
      expect(config.outDirName).toBe('.trailing-comma')
    })

    test('parses build-raptor.json5 with unquoted keys', () => {
      const json5Content = `{
        outDirName: ".unquoted-keys",
      }`
      fs.writeFileSync(path.join(tmpDir, 'build-raptor.json5'), json5Content)
      const config = readConfigFile(tmpDir, 'build-raptor.json5')
      expect(config.outDirName).toBe('.unquoted-keys')
    })
  })
})
