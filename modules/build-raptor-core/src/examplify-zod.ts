import { shouldNeverHappen } from 'misc'
import {
  z,
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  ZodTypeAny,
  ZodUnion,
} from 'zod'

type ZodTypeName = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'union' | 'unknown'

function getZodTypeName(schema: ZodTypeAny): ZodTypeName {
  if (schema instanceof ZodString) {
    return 'string'
  }
  if (schema instanceof ZodNumber) {
    return 'number'
  }
  if (schema instanceof ZodBoolean) {
    return 'boolean'
  }
  if (schema instanceof ZodObject) {
    return 'object'
  }
  if (schema instanceof ZodArray) {
    return 'array'
  }
  if (schema instanceof ZodUnion) {
    return 'union'
  }
  return 'unknown'
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return unwrap(schema.unwrap())
  }
  if (schema instanceof ZodDefault) {
    return unwrap(schema.removeDefault())
  }
  return schema
}

function getDescription(schema: ZodTypeAny): string | undefined {
  if (schema.description) {
    return schema.description
  }

  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return getDescription(schema.unwrap())
  }
  if (schema instanceof ZodDefault) {
    return getDescription(schema.removeDefault())
  }

  return undefined
}

type Reflected = { description: string | undefined; defaultValue: unknown } & (
  | { tag: 'string' | 'boolean' | 'number' | 'array' | 'unknown' }
  | { tag: 'union' }
  | { tag: 'object'; of: Partial<Record<string, Reflected>> }
)

function reflect(schema: z.ZodTypeAny): Reflected {
  const unwrapped = unwrap(schema)
  const typeName = getZodTypeName(unwrapped)
  const description = getDescription(schema)

  if (typeName === 'array') {
    return { tag: 'array', description, defaultValue: [] }
  }
  if (typeName === 'boolean' || typeName === 'string' || typeName === 'number' || typeName === 'unknown') {
    const d =
      schema instanceof ZodDefault
        ? schema.parse(undefined)
        : { boolean: false, string: '', number: 0, unknown: null }[typeName]
    return { tag: typeName, description, defaultValue: d }
  }

  if (typeName === 'union') {
    if (!(unwrapped instanceof z.ZodUnion)) {
      throw new Error(`type name mismatch - expected: ${typeName}, got: ${unwrapped.constructor.name}`)
    }

    const options = unwrapped.options
    if (!Array.isArray(options)) {
      throw new Error(`type name mismatch - expected: an array, got: ${options.constructor.name}`)
    }

    const casted = options as z.ZodTypeAny[] // eslint-disable-line @typescript-eslint/consistent-type-assertions
    const mapped = casted.map(at => reflect(at))
    const d = schema instanceof ZodDefault ? schema.parse(undefined) : mapped[0].defaultValue
    return { tag: 'union', description, defaultValue: d }
  }

  if (typeName === 'object') {
    if (!(unwrapped instanceof z.ZodObject)) {
      throw new Error(`type name mismatch - expected: ${typeName}, got: ${unwrapped.constructor.name}`)
    }

    const obj = Object.fromEntries(
      Object.entries(unwrapped.shape).map(kv => {
        const k: string = kv[0]
        const v = kv[1]
        return [k, reflect(v as z.ZodTypeAny)] // eslint-disable-line @typescript-eslint/consistent-type-assertions
      }),
    )

    return { tag: 'object', of: obj, description, defaultValue: {} }
  }

  shouldNeverHappen(typeName)
}

type OutputBlock =
  | {
      tag: 'line'
      nesting: number
      parts: string[]
    }
  | {
      tag: 'writer'
      writer: Writer
    }

class Writer {
  private blocks: OutputBlock[] = []
  private curr: Extract<OutputBlock, { tag: 'line' }>

  constructor(private readonly nesting: number) {
    this.curr = this.makeNewCurr()
  }

  nest() {
    const ret = new Writer(this.nesting + 1)
    this.blocks.push({ tag: 'writer', writer: ret })
    return ret
  }

  write(...strings: string[]) {
    this.curr.parts.push(...strings)
  }

  private makeNewCurr() {
    const ret: OutputBlock = { tag: 'line', nesting: this.nesting, parts: [] }
    this.blocks.push(ret)
    return ret
  }

  newline() {
    this.curr = this.makeNewCurr()
  }

  collectOutput(acc: string[], options: Required<ExamplifyZodOptions>) {
    for (const block of this.blocks) {
      if (block.tag === 'writer') {
        block.writer.collectOutput(acc, options)
      } else if (block.tag === 'line') {
        // Skip blocks with no parts ([]). A blank (comment) line can still be produced if block.parts is ['']
        if (block.parts.length) {
          const addComment = options.comment && (block.nesting > 0 || options.commentAlsoOutermostBraces)
          acc.push((addComment ? '//' : '') + '  '.repeat(block.nesting) + block.parts.join(''))
        }
      } else {
        shouldNeverHappen(block)
      }
    }
  }
}

function format(r: Reflected, w: Writer, path: string[]) {
  const trimmed = r.description?.trim()
  if (trimmed) {
    for (const line of trimmed.split('\n')) {
      w.write(line)
      w.newline()
    }
  }
  if (path.length) {
    w.write(path.at(-1) ?? '', ': ')
  }
  if (
    r.tag === 'array' ||
    r.tag === 'boolean' ||
    r.tag === 'number' ||
    r.tag === 'string' ||
    r.tag === 'union' ||
    r.tag === 'unknown'
  ) {
    w.write(JSON.stringify(r.defaultValue), path.length ? ',' : '')
    w.newline()
    return
  }

  if (r.tag === 'object') {
    w.write('{')
    const nestedWriter = w.nest()
    for (const [k, v] of Object.entries(r.of)) {
      if (!v) {
        continue
      }
      format(v, nestedWriter, [...path, k])
    }
    w.newline()
    w.write('}', path.length ? ',' : '')
    return
  }
  shouldNeverHappen(r.tag)
}

/**
 * Generates a JSON5 template string from a Zod schema.
 * All properties are commented out with their default values.
 *
 * @param schema The main Zod object schema
 */
export function examplifyZod(input: z.ZodTypeAny, options: ExamplifyZodOptions = {}): string {
  const r = reflect(input)
  const w = new Writer(0)
  format(r, w, [])
  const acc: string[] = []
  w.collectOutput(acc, { comment: true, commentAlsoOutermostBraces: false, commentIndentation: 2, ...options })
  return acc.join('\n')
}

export interface ExamplifyZodOptions {
  comment?: boolean
  commentAlsoOutermostBraces?: boolean
  commentIndentation?: number
}
