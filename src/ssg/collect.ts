import type { CollectedRoute, SSGConfig, SSGRouteEntry } from './types'

export function expandDynamicRoute(
  pathPattern: string,
  params: Record<string, string | string[]>,
): string[] {
  const paramEntries = Object.entries(params).map(([key, value]) => [
    key,
    Array.isArray(value) ? value : [value],
  ]) as [string, string[]][]

  if (paramEntries.length === 0) {
    return []
  }

  // Cartesian product of all param values
  let combinations: Record<string, string>[] = [{}]
  for (const [key, values] of paramEntries) {
    const next: Record<string, string>[] = []
    for (const combo of combinations) {
      for (const value of values) {
        next.push({ ...combo, [key]: value })
      }
    }
    combinations = next
  }

  return combinations.map((combo) => {
    let result = pathPattern
    for (const [key, value] of Object.entries(combo)) {
      result = result.replace(`:${key}`, value)
    }
    return result
  })
}

/**
 * Walk fileRoutes tree and collect all static (non-dynamic) paths.
 */
function collectAllStaticRoutes(fileRoutes: any[], parentPath = ''): string[] {
  const paths: string[] = []

  for (const route of fileRoutes) {
    if (!route) {
      continue
    }

    const currentPath =
      route.path === '/'
        ? parentPath || '/'
        : route.path === '*'
          ? null
          : `${parentPath}/${route.path}`.replace(/\/+/g, '/')

    if (currentPath && !currentPath.includes(':') && route.path !== '*') {
      paths.push(currentPath)
    }

    if (route.children) {
      paths.push(...collectAllStaticRoutes(route.children, currentPath || parentPath))
    }
  }

  return paths
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: `*` (single segment), `**` (any depth), exact prefix
 */
function globToRegex(pattern: string): RegExp {
  // Normalize: ensure leading /
  const p = pattern.startsWith('/') ? pattern : `/${pattern}`

  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (except * and ?)
    .replace(/\*\*/g, '__GLOBSTAR__') // placeholder for **
    .replace(/\*/g, '[^/]+') // * matches single segment
    .replace(/__GLOBSTAR__/g, '.*') // ** matches anything

  return new RegExp(`^${escaped}$`)
}

function isGlobPattern(s: string): boolean {
  return s.includes('*')
}

export function collectRoutesFromConfig(config: SSGConfig, fileRoutes?: any[]): CollectedRoute[] {
  const routes: CollectedRoute[] = []

  if (!config.routes) {
    return routes
  }

  // Lazily collect all static routes only if a glob pattern is used
  let allStatic: string[] | undefined

  for (const entry of config.routes) {
    if (typeof entry === 'string') {
      if (!isGlobPattern(entry)) {
        routes.push({ path: entry, source: 'config' })
      } else if (fileRoutes) {
        // Glob pattern: match against all static routes
        allStatic ??= collectAllStaticRoutes(fileRoutes)

        if (entry === '*') {
          // Special case: all static routes
          for (const path of allStatic) {
            routes.push({ path, source: 'config' })
          }
        } else {
          const regex = globToRegex(entry)
          for (const path of allStatic) {
            if (regex.test(path)) {
              routes.push({ path, source: 'config' })
            }
          }
        }
      }
    } else {
      const routeEntry = entry as SSGRouteEntry
      if (routeEntry.params) {
        const expanded = expandDynamicRoute(routeEntry.path, routeEntry.params)
        for (const path of expanded) {
          routes.push({ path, source: 'config' })
        }
      } else {
        routes.push({ path: routeEntry.path, source: 'config' })
      }
    }
  }

  return routes
}

export function collectRoutesFromPrerender(fileRoutes: any[], parentPath = ''): CollectedRoute[] {
  const routes: CollectedRoute[] = []

  for (const route of fileRoutes) {
    if (!route) {
      continue
    }

    const currentPath =
      route.path === '/'
        ? parentPath || '/'
        : route.path === '*'
          ? null
          : `${parentPath}/${route.path}`.replace(/\/+/g, '/')

    if (currentPath && route.prerender !== undefined) {
      if (route.prerender === true) {
        if (!currentPath.includes(':') && !currentPath.includes('*')) {
          routes.push({ path: currentPath, source: 'prerender' })
        }
      } else if (route.prerender && typeof route.prerender === 'object' && route.prerender.params) {
        const expanded = expandDynamicRoute(currentPath, route.prerender.params)
        for (const path of expanded) {
          routes.push({ path, source: 'prerender' })
        }
      }
    }

    if (route.children) {
      routes.push(...collectRoutesFromPrerender(route.children, currentPath || parentPath))
    }
  }

  return routes
}

export function crawlLinks(html: string, visited: Set<string>): string[] {
  const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi
  const links: string[] = []
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1]

    if (!href.startsWith('/')) {
      continue
    }
    if (href.includes('://') || href.startsWith('//')) {
      continue
    }

    const path = href.split(/[?#]/)[0]
    const normalized = path === '' ? '/' : path

    if (!visited.has(normalized)) {
      links.push(normalized)
    }
  }

  return [...new Set(links)]
}
