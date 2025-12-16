import { failMe, shouldNeverHappen } from 'misc'
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

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return unwrapSchema(schema.unwrap())
  }
  if (schema instanceof ZodDefault) {
    return unwrapSchema(schema.removeDefault())
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
  | { tag: 'union'; of: Reflected[] }
  | { tag: 'object'; of: Partial<Record<string, Reflected>> }
)

function reflect(schema: z.ZodTypeAny): Reflected {
  const unwrapped = unwrapSchema(schema)
  const typeName = getZodTypeName(unwrapped)
  const description = getDescription(schema)

  if (typeName === 'array') {
    return { tag: 'array', description, defaultValue: '[]' }
  }
  if (typeName === 'boolean' || typeName === 'string' || typeName === 'number' || typeName === 'unknown') {
    const d =
      schema instanceof ZodDefault
        ? schema.parse(undefined)
        : { boolean: 'false', string: '""', number: '0', unknown: 'null' }[typeName]
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
    return { tag: 'union', of: mapped, description, defaultValue: d }
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

class Writer {
  private readonly lines: string[][] = []

  constructor(private readonly prefix: string) {
    this.newline()
  }

  write(...strings: string[]) {
    const last = this.lines.at(-1) ?? failMe('array is empty')
    last.push(...strings)
  }

  newline() {
    this.lines.push([this.prefix])
  }

  getOutput() {
    return this.lines.map(line => line.join('')).join('\n')
  }
}

function format(r: Reflected, w: Writer, indent: string) {
  if (
    r.tag === 'array' ||
    r.tag === 'boolean' ||
    r.tag === 'number' ||
    r.tag === 'string' ||
    r.tag === 'union' ||
    r.tag === 'unknown'
  ) {
    w.write(String(r.defaultValue))
    return
  }

  if (r.tag === 'object') {
    w.write('{')
    w.newline()
    const newIndent = indent + '  '
    for (const [k, v] of Object.entries(r.of)) {
      if (!v) {
        continue
      }
      if (v.description) {
        for (const line of v.description.split('\n')) {
          w.write(newIndent, line)
          w.newline()
        }
      }
      w.write(newIndent, k, ': ')
      format(v, w, newIndent)
      w.write(',')
      w.newline()
    }
    w.write(indent, '}')
    return
  }
  shouldNeverHappen(r.tag)
}

/**
 * Generates a JSON5 template string from a Zod schema.
 * All properties are commented out with their default values.
 *
 * @param schema The main Zod object schema
 * @param nestedSchemas Optional map of property names to nested schemas (for properties like repoProtocol)
 * @returns A JSON5 template string
 */
export function zodToJson5Template(
  input: z.ZodTypeAny,
  _nestedSchemas: Partial<Record<string, z.ZodTypeAny>>,
  comment = true,
): string {
  const w = new Writer(comment ? '//' : '')
  const r = reflect(input)
  format(r, w, '')
  return w.getOutput()
}
