import type { RouteConfig } from '../route'

let yamlPromise: Promise<typeof import('yaml')> | undefined

export type MdxRouteConfig<T = unknown> = Pick<
  RouteConfig<T>,
  'info' | 'matchFilters' | 'inherit' | 'draft' | 'metadata'
>

export interface MdxFrontmatterBlock {
  kind: string
  value: string
}

export interface ParsedMdxFrontmatter<T = unknown> {
  data: Record<string, unknown>
  routeConfig: MdxRouteConfig<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function getYaml(): Promise<typeof import('yaml')> {
  try {
    return await (yamlPromise ??= import('yaml'))
  } catch (error) {
    throw new Error(
      '[solid-file-router] YAML frontmatter requires the optional `yaml` package. Install it with `bun add -d yaml`.',
      { cause: error },
    )
  }
}

function parseMatchFilters(value: unknown): NonNullable<RouteConfig['matchFilters']> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!isRecord(value)) {
    throw new Error('[solid-file-router] frontmatter.matchFilters must be an object')
  }

  const filters: Record<string, RegExp | readonly string[]> = {}
  for (const [key, filter] of Object.entries(value)) {
    if (typeof filter === 'string') {
      const literal = filter.match(/^\/(.*)\/([dgimsuvy]*)$/s)
      try {
        filters[key] = new RegExp(literal?.[1] ?? filter, literal?.[2] ?? '')
      } catch (error) {
        throw new Error(`[solid-file-router] Invalid matchFilters.${key} regular expression`, {
          cause: error,
        })
      }
      continue
    }
    if (Array.isArray(filter) && filter.every((item) => typeof item === 'string')) {
      filters[key] = filter
      continue
    }
    throw new Error(
      `[solid-file-router] frontmatter.matchFilters.${key} must be a string or string array`,
    )
  }
  return filters
}

export function normalizeMdxRouteConfig<T = unknown>(
  data: Record<string, unknown>,
): MdxRouteConfig<T> {
  const { inherit, draft } = data
  if (inherit !== undefined && inherit !== null && typeof inherit !== 'boolean') {
    if (!isRecord(inherit)) {
      throw new Error('[solid-file-router] frontmatter.inherit must be a boolean or object')
    }
    for (const key of ['loading', 'error'] as const) {
      if (key in inherit && typeof inherit[key] !== 'boolean') {
        throw new Error(`[solid-file-router] frontmatter.inherit.${key} must be a boolean`)
      }
    }
  }
  if (draft !== undefined && draft !== null && typeof draft !== 'boolean') {
    throw new TypeError('[solid-file-router] frontmatter.draft must be a boolean')
  }
  return {
    info: data.info as MdxRouteConfig<T>['info'],
    matchFilters: parseMatchFilters(data.matchFilters),
    inherit: inherit as MdxRouteConfig['inherit'],
    draft: draft as boolean | undefined,
    metadata: data.metadata as MdxRouteConfig<T>['metadata'],
  }
}

export async function parseMdxFrontmatter<T = unknown>(
  block?: MdxFrontmatterBlock | null,
): Promise<ParsedMdxFrontmatter<T>> {
  if (!block) {
    const data = {}
    return { data, routeConfig: normalizeMdxRouteConfig<T>(data) }
  }
  if (block.kind.toLowerCase() === 'toml') {
    throw new Error('[solid-file-router] TOML frontmatter is not supported for Markdown routes')
  }
  if (block.kind.toLowerCase() !== 'yaml') {
    throw new Error('[solid-file-router] Only YAML frontmatter is supported for Markdown routes')
  }

  let data: unknown
  try {
    data = (await getYaml()).parse(block.value)
  } catch (error) {
    throw new Error('[solid-file-router] Failed to parse YAML frontmatter', { cause: error })
  }
  if (data === undefined || data === null) {
    data = {}
  }
  if (!isRecord(data)) {
    throw new Error('[solid-file-router] YAML frontmatter must contain an object')
  }

  return { data, routeConfig: normalizeMdxRouteConfig<T>(data) }
}

export function serializeJavaScriptValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value)
  }
  if (value instanceof RegExp) {
    return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`
  }
  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeJavaScriptValue).join(', ')}]`
  }
  if (isRecord(value)) {
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${serializeJavaScriptValue(item)}`)
      .join(', ')} }`
  }
  throw new Error('[solid-file-router] YAML frontmatter contains an unsupported value')
}
