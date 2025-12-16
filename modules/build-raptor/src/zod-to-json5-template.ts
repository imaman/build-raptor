import { z, ZodTypeAny } from 'zod'

interface TemplateEntry {
  key: string
  value: string
  description?: string
}

function getZodTypeName(schema: ZodTypeAny): string {
  return schema._def.typeName
}

function unwrapZodType(schema: ZodTypeAny): ZodTypeAny {
  const typeName = getZodTypeName(schema)

  if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
    return unwrapZodType(schema._def.innerType)
  }

  if (typeName === 'ZodDefault') {
    return unwrapZodType(schema._def.innerType)
  }

  return schema
}

function getDefaultValueForType(schema: ZodTypeAny): string {
  const unwrapped = unwrapZodType(schema)
  const typeName = getZodTypeName(unwrapped)

  switch (typeName) {
    case 'ZodString':
      return '""'
    case 'ZodNumber':
      return '0'
    case 'ZodBoolean':
      return 'false'
    case 'ZodArray':
      return '[]'
    case 'ZodObject':
      return '{}'
    case 'ZodUnion':
    case 'ZodLiteral':
      // For unions/literals, try to determine the underlying type
      if (typeName === 'ZodUnion') {
        const options = unwrapped._def.options
        if (options.length > 0) {
          return getDefaultValueForType(options[0])
        }
      }
      if (typeName === 'ZodLiteral') {
        const value = unwrapped._def.value
        if (typeof value === 'string') return '""'
        if (typeof value === 'number') return '0'
        if (typeof value === 'boolean') return 'false'
      }
      return '""'
    case 'ZodUnknown':
    case 'ZodAny':
      return '{}'
    default:
      return '""'
  }
}

function getDescription(schema: ZodTypeAny): string | undefined {
  // Check for description at the current level
  if (schema._def.description) {
    return schema._def.description
  }

  // Check inner types for description
  const typeName = getZodTypeName(schema)
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    return getDescription(schema._def.innerType)
  }

  return undefined
}

function extractEntriesFromObject(schema: z.ZodObject<z.ZodRawShape>): TemplateEntry[] {
  const entries: TemplateEntry[] = []
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const zodSchema = fieldSchema
    const description = getDescription(zodSchema)
    const defaultValue = getDefaultValueForType(zodSchema)

    entries.push({
      key,
      value: defaultValue,
      description,
    })
  }

  return entries
}

function formatDescription(description: string, indent: string): string {
  const lines = description.split('\n')
  if (lines.length === 1) {
    return `${indent}// ${description}`
  }
  return lines.map(line => `${indent}// ${line}`).join('\n')
}

function formatEntry(entry: TemplateEntry, indent: string, isLast: boolean): string {
  const lines: string[] = []

  if (entry.description) {
    lines.push(formatDescription(entry.description, indent))
  }

  const comma = isLast ? '' : ','
  lines.push(`${indent}// "${entry.key}": ${entry.value}${comma}`)

  return lines.join('\n')
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
  schema: z.ZodObject<z.ZodRawShape>,
  nestedSchemas?: Record<string, z.ZodObject<z.ZodRawShape>>,
): string {
  const entries = extractEntriesFromObject(schema)
  const lines: string[] = ['{']

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1

    // Check if this property has a nested schema
    if (nestedSchemas && nestedSchemas[entry.key]) {
      const nestedSchema = nestedSchemas[entry.key]
      const nestedEntries = extractEntriesFromObject(nestedSchema)

      if (entry.description) {
        lines.push(formatDescription(entry.description, '  '))
      }

      lines.push(`  // "${entry.key}": {`)

      for (let j = 0; j < nestedEntries.length; j++) {
        const nestedEntry = nestedEntries[j]
        const nestedIsLast = j === nestedEntries.length - 1
        const formattedEntry = formatEntry(nestedEntry, '  //   ', nestedIsLast)
        lines.push(formattedEntry)
      }

      const comma = isLast ? '' : ','
      lines.push(`  // }${comma}`)
    } else {
      lines.push(formatEntry(entry, '  ', isLast))
    }

    // Add blank line between entries for readability (except after the last one)
    if (!isLast) {
      lines.push('')
    }
  }

  lines.push('}')

  return lines.join('\n')
}
