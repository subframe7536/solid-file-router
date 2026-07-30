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

export function resolveRouteProviderModuleId(id: string): string | undefined {
  return isRouteProviderModuleId(id) ? normalizePath(id) : undefined
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
