import { relative } from 'node:path'

import { createFilter, normalizePath } from 'vite'

import { resolveFromRoot } from './entry'

const REG_GLOB_CHAR = /[*?[{]/

export interface RouteProviderWatchConfig {
  roots: string[]
  filter: (file: string) => boolean
}

export function getRouteProviderFilterPath(root: string, file: string): string {
  return normalizePath(relative(root, resolveFromRoot(root, file))).replace(/^(?:\.\.\/)+/, '')
}

export function createRouteProviderWatchConfig(
  root: string,
  patterns: string[],
): RouteProviderWatchConfig {
  const includes: string[] = []
  const excludes: string[] = []
  const roots: string[] = []

  for (const pattern of patterns) {
    const isExclude = pattern.startsWith('!')
    const value = pattern.slice(isExclude ? 1 : 0)
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
