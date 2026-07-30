import { relative, resolve } from 'node:path'

import { createFilter, normalizePath } from 'vite'

import type { NormalizedRouteEntry } from './definition'
import { getRoutePath } from './path'
import type { RouteSourceEntry, RouteSourceLoadContext, RouteSourceProvider } from './source'

const REG_ROUTE_SOURCE_EXT = /\.(jsx|tsx|md|mdx)$/i
const REG_GLOB_CHAR = /[*?[{]/
const ROUTE_SOURCE_MODULE_SUFFIX = '-sfr.tsx'

export interface NormalizedRouteSourceEntry<TData> extends NormalizedRouteEntry {
  data?: TData
}

export interface RouteSourceWatchConfig {
  roots: string[]
  filter: (file: string) => boolean
}

export interface RouteSourceState<TData> {
  provider: RouteSourceProvider<TData>
  watch: RouteSourceWatchConfig
  entries: NormalizedRouteSourceEntry<TData>[]
}

export interface RouteSourceModule<TData> {
  provider: RouteSourceProvider<TData>
  context: RouteSourceLoadContext<TData>
}

export function resolveFromRoot(root: string, path: string): string {
  return normalizePath(resolve(root, path || '.'))
}

export function getRouteSourceFilterPath(root: string, file: string): string {
  return normalizePath(relative(root, resolveFromRoot(root, file))).replace(/^(?:\.\.\/)+/, '')
}

export function resolveRouteSourceModuleId(id: string): string | undefined {
  return isRouteSourceModuleId(id) ? normalizePath(id) : undefined
}

export function isRouteSourceModuleId(id: string): boolean {
  return normalizePath(id).replace(/\?.*$/, '').endsWith(ROUTE_SOURCE_MODULE_SUFFIX)
}

export function normalizeRouteSourceEntry<TData>(
  root: string,
  sourcePath: string,
  entry: RouteSourceEntry<TData>,
): NormalizedRouteSourceEntry<TData> {
  const routePath = normalizePath(entry.path).replace(/^(?:\.\/|\/+)|\/+$/g, '') || 'index.tsx'
  const derivedRouteId =
    getRoutePath(routePath, '') ?? `/${routePath.replace(REG_ROUTE_SOURCE_EXT, '')}`
  const normalizedRouteId = normalizePath(entry.routeId ?? derivedRouteId).replace(
    /^(?:\.\/)|\/+$/g,
    '',
  )
  const resolvedSourcePath = resolveFromRoot(root, sourcePath)
  return {
    routeId: normalizedRouteId
      ? normalizedRouteId.startsWith('/')
        ? normalizedRouteId
        : `/${normalizedRouteId}`
      : '/',
    routePath,
    moduleId: `${resolvedSourcePath}${ROUTE_SOURCE_MODULE_SUFFIX}`,
    sourcePath: resolvedSourcePath,
    data: entry.data,
  }
}

export function mergeRouteSourceEntries<TData>(
  sourceEntries: NormalizedRouteSourceEntry<TData>[][],
): NormalizedRouteSourceEntry<TData>[] {
  const merged: NormalizedRouteSourceEntry<TData>[] = []
  const fields = ['routeId', 'routePath', 'sourcePath'] as const
  const firstEntries = fields.map(() => new Map<string, NormalizedRouteSourceEntry<TData>>())

  for (const entries of sourceEntries) {
    for (const entry of entries) {
      for (const [index, field] of fields.entries()) {
        const value = entry[field]!
        const first = firstEntries[index]!.get(value)
        if (first) {
          throw new Error(
            `[solid-file-router] duplicate routeSource.${field}: ${value}; source paths: ${first.sourcePath} and ${entry.sourcePath}`,
          )
        }
        firstEntries[index]!.set(value, entry)
      }
      merged.push(entry)
    }
  }
  return merged
}

export function createRouteSourceWatchConfig(
  root: string,
  sources: string[],
): RouteSourceWatchConfig {
  const includes: string[] = []
  const excludes: string[] = []
  const roots: string[] = []

  for (const source of sources) {
    const isExclude = source.startsWith('!')
    const value = source.slice(isExclude ? 1 : 0)
    if (!value) {
      continue
    }
    const resolved = resolveFromRoot(root, value)
    if (isExclude) {
      excludes.push(resolved, `${resolved}/**`)
      continue
    }
    includes.push(...(REG_GLOB_CHAR.test(resolved) ? [resolved] : [resolved, `${resolved}/**`]))
    const globIndex = resolved.search(REG_GLOB_CHAR)
    const prefix = globIndex < 0 ? resolved : resolved.slice(0, globIndex)
    const lastSlashIndex = prefix.lastIndexOf('/')
    roots.push(globIndex < 0 ? resolved : lastSlashIndex < 0 ? '' : prefix.slice(0, lastSlashIndex))
  }

  return {
    roots: [...new Set(roots)],
    filter:
      includes.length > 0
        ? createFilter(includes, excludes)
        : function () {
            return false
          },
  }
}
