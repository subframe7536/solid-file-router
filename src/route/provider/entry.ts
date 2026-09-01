import { resolve } from 'node:path'

import { normalizePath } from 'vite'

import type { NormalizedRouteEntry } from '../definition'
import { getRoutePath } from '../path'

import type { RouteProviderEntry } from './contract'

const REG_ROUTE_PROVIDER_EXT = /\.(jsx|tsx|md|mdx)$/i
const ROUTE_PROVIDER_MODULE_SUFFIX = '-sfr.tsx'

export interface NormalizedRouteProviderEntry<TData> extends NormalizedRouteEntry {
  data?: TData
}

export function resolveFromRoot(root: string, path: string): string {
  return normalizePath(resolve(root, path || '.'))
}

export function resolveRouteProviderModuleId(id: string, root?: string): string | undefined {
  const normalized = normalizePath(id)
  if (!isRouteProviderModuleId(normalized)) {
    return undefined
  }
  // When Vite's import-analysis rewrites absolute paths that lie within root into
  // root-relative URLs (e.g. /routes/_app.tsx-sfr.tsx?route), the leading slash
  // makes the path look relative and non-existent on disk. Resolve it against root
  // so downstream lookup in the module registry uses the same absolute form.
  if (root && !normalized.startsWith(root) && /^\/[^/]/.test(normalized)) {
    return normalizePath(resolve(root, `.${normalized}`))
  }
  return normalized
}

export function isRouteProviderModuleId(id: string): boolean {
  return normalizePath(id).replace(/\?.*$/, '').endsWith(ROUTE_PROVIDER_MODULE_SUFFIX)
}

export function normalizeRouteProviderEntry<TData>(
  root: string,
  sourcePath: string,
  entry: RouteProviderEntry<TData>,
): NormalizedRouteProviderEntry<TData> {
  const routePath = normalizePath(entry.path).replace(/^(?:\.\/|\/+)|\/+$/g, '') || 'index.tsx'
  const derivedRouteId =
    getRoutePath(routePath, '') ?? `/${routePath.replace(REG_ROUTE_PROVIDER_EXT, '')}`
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
    moduleId: `${resolvedSourcePath}${ROUTE_PROVIDER_MODULE_SUFFIX}`,
    sourcePath: resolvedSourcePath,
    data: entry.data,
  }
}

export function mergeRouteProviderEntries<TData>(
  sourceEntries: NormalizedRouteProviderEntry<TData>[][],
): NormalizedRouteProviderEntry<TData>[] {
  const merged: NormalizedRouteProviderEntry<TData>[] = []
  const fields = ['routeId', 'routePath', 'sourcePath'] as const
  const firstEntries = fields.map(() => new Map<string, NormalizedRouteProviderEntry<TData>>())

  for (const entries of sourceEntries) {
    for (const entry of entries) {
      for (const [index, field] of fields.entries()) {
        const value = entry[field]!
        const first = firstEntries[index]!.get(value)
        if (first) {
          throw new Error(
            `[solid-file-router] duplicate routeProvider.${field}: ${value}; source paths: ${first.sourcePath} and ${entry.sourcePath}`,
          )
        }
        firstEntries[index]!.set(value, entry)
      }
      merged.push(entry)
    }
  }
  return merged
}

export { ROUTE_PROVIDER_MODULE_SUFFIX }
