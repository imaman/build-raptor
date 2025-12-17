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
      isDesc: boolean
    }
  | {
      tag: 'writer'
      writer: Writer
    }

class Writer {
  private blocks: OutputBlock[] = []

  constructor(private readonly nesting: number) {}

  nest() {
    const ret = new Writer(this.nesting + 1)
    this.blocks.push({ tag: 'writer', writer: ret })
    return ret
  }

  writeln(...parts: string[]) {
    this.blocks.push({ tag: 'line', nesting: this.nesting, parts, isDesc: false })
  }

  writeDescLine(...parts: string[]) {
    this.blocks.push({ tag: 'line', nesting: this.nesting, parts, isDesc: true })
  }

  collectOutput(acc: string[], options: Required<ExamplifyZodOptions>) {
    for (const block of this.blocks) {
      if (block.tag === 'writer') {
        block.writer.collectOutput(acc, options)
      } else if (block.tag === 'line') {
        // Skip blocks with no parts ([]). A blank (comment) line can still be produced if block.parts is ['']
        if (block.parts.length) {
          const content = block.parts.join('')
          if (!content.trim()) {
            acc.push('')
            continue
          }
          const addComment =
            block.isDesc || (options.comment && (block.nesting > 0 || options.commentAlsoOutermostBraces))
          const col = !addComment ? 0 : block.nesting > 0 ? options.commentIndentation : 0
          acc.push(
            (addComment ? ' '.repeat(col) + '// ' : '') + ' '.repeat(Math.max(0, 2 * block.nesting - col)) + content,
          )
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
      w.writeDescLine(line)
    }
  }

  const pref = path.length ? `${path.at(-1) ?? ''}: ` : ``
  if (
    r.tag === 'array' ||
    r.tag === 'boolean' ||
    r.tag === 'number' ||
    r.tag === 'string' ||
    r.tag === 'union' ||
    r.tag === 'unknown'
  ) {
    w.writeln(pref, JSON.stringify(r.defaultValue), path.length ? ',' : '')
    return
  }

  if (r.tag === 'object') {
    w.writeln(pref, '{')
    const nestedWriter = w.nest()
    let isFirst = true
    for (const [k, v] of Object.entries(r.of)) {
      if (!v) {
        continue
      }

      if (!isFirst) {
        nestedWriter.writeln('')
      }
      isFirst = false
      format(v, nestedWriter, [...path, k])
    }
    w.writeln('}', path.length ? ',' : '')
    return
  }
  shouldNeverHappen(r.tag)
}

/**
 * Generates a formatted JSON example from a Zod schema with default values and descriptions.
 *
 * Converts any Zod schema into a human-readable JSON example showing structure and default values.
 * Schema descriptions appear as comments above properties. Supports primitives, objects, arrays,
 * unions, and nested structures. Output can be either a commented example or valid JSON.
 *
 * @param input - Any Zod schema (object, primitive, array, union, etc.)
 * @param options - Formatting options (see {@link ExamplifyZodOptions})
 * @returns Multi-line string. When `comment: true` (default), returns a commented example
 *          with `//` markers. When `comment: false`, returns valid JSON (descriptions remain
 *          commented).
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   port: z.number().default(3000).describe('Server port'),
 *   host: z.string().optional()
 * })
 * examplifyZod(schema)
 * // Returns:
 * // {
 * //   // Server port
 * //   // port: 3000,
 * //
 * //   // host: "",
 * // }
 * ```
 *
 * @remarks
 * - **Default values**: Primitives use type defaults (0, "", false, []). Respects `.default()` modifiers.
 * - **Nullable/optional**: Unwrapped to show underlying type's default. ⚠️ Order matters:
 *   `.nullable().default(5)` uses `5`, but `.default(5).nullable()` uses type default (0).
 * - **Unions**: Default is first option's default, unless explicit `.default()` provided.
 * - **Descriptions**: Always appear as comments above properties (even with `comment: false`),
 *   supporting multi-line text.
 * - **Arrays**: Shown as empty array `[]` without element type information.
 * - **Spacing**: Blank lines separate properties for readability.
 */
export function examplifyZod(input: z.ZodTypeAny, options: ExamplifyZodOptions = {}): string {
  const r = reflect(input)
  const w = new Writer(0)
  format(r, w, [])
  const acc: string[] = []
  w.collectOutput(acc, { comment: true, commentAlsoOutermostBraces: false, commentIndentation: 2, ...options })
  return acc.join('\n')
}

/**
 * Configuration options for formatting Zod schema templates.
 */
export interface ExamplifyZodOptions {
  /**
   * Whether to comment out property lines with '//' markers.
   * When false, outputs valid JSON. When true, outputs commented template.
   * @default true
   */
  comment?: boolean

  /**
   * Whether to also comment the outermost object braces.
   * Only applies when `comment` is true. Useful for embedding in existing JSON.
   * @default false
   */
  commentAlsoOutermostBraces?: boolean

  /**
   * Column position where comment markers ('//' prefix) start.
   * Controls horizontal alignment of comments.
   * @default 2
   */
  commentIndentation?: number
}
