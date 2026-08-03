import { normalizePath } from 'vite'

export const patterns = {
  optional: [/^-(:?[\w-]+|\*)/, '$1?'],
  param: [/\[([^\]]+)]/g, ':$1'],
  slash: [/^index$|\./g, '/'],
  splat: [/\[\.{3}[\w-]+\]/g, '*'],
} as const

const REG_APP = /^_app\.(jsx|tsx)$/
const REG_LAYOUT = /^_layout\.(jsx|tsx)$/
const REG_NOT_FOUND = /^404\.(jsx|tsx)$/
const REG_ROUTE_EXT = /\.(jsx|tsx)$/
const REG_UNSUPPORTED_ROUTE_EXT = /\.mdx$/

function getRouteBasename(file: string): string {
  return normalizePath(file).slice(normalizePath(file).lastIndexOf('/') + 1)
}

export function isAppRoute(file: string): boolean {
  return REG_APP.test(getRouteBasename(file))
}

export function isLayoutRoute(file: string): boolean {
  return REG_LAYOUT.test(getRouteBasename(file))
}

export function isRootLayoutRoute(file: string, routeRoot?: string): boolean {
  const normalized = routeRoot ? getRouteKey(file, routeRoot) : normalizePath(file)
  return (normalized === '_layout' || isLayoutRoute(normalized)) && !normalized.includes('/')
}

export function isNotFoundRoute(file: string): boolean {
  const normalized = normalizePath(file)
  return (
    normalized === '404' ||
    normalized.endsWith('/404') ||
    REG_NOT_FOUND.test(getRouteBasename(normalized))
  )
}

export function hasPrivateSegment(file: string): boolean {
  return normalizePath(file)
    .split('/')
    .some((segment) => segment.startsWith('_'))
}

export function getRouteKey(file: string, routeRoot: string): string {
  if (file === '/') {
    return '/'
  }

  const normalizedFile = normalizePath(file)
  const normalizedRouteRoot = normalizePath(routeRoot).replace(/\/+$/g, '')
  const prefixedRouteRoot = normalizedRouteRoot ? `${normalizedRouteRoot}/` : ''
  if (prefixedRouteRoot && normalizedFile.startsWith(prefixedRouteRoot)) {
    return normalizedFile.slice(prefixedRouteRoot.length).replace(REG_ROUTE_EXT, '')
  }
  if (prefixedRouteRoot) {
    const suffixIndex = normalizedFile.lastIndexOf(`/${prefixedRouteRoot}`)
    if (suffixIndex >= 0) {
      return normalizedFile
        .slice(suffixIndex + prefixedRouteRoot.length + 1)
        .replace(REG_ROUTE_EXT, '')
    }
  }
  return normalizedFile.replace(REG_ROUTE_EXT, '')
}

export function isLogicalUrlRoutePath(routePath: string, routeRoot: string): boolean {
  return (
    routePath.startsWith('/') &&
    !REG_ROUTE_EXT.test(routePath) &&
    !normalizePath(routePath).startsWith(normalizePath(routeRoot).replace(/\/+$/g, ''))
  )
}

export function getRoutePath(key: string, routeRoot = 'src/pages'): string | undefined {
  if (REG_UNSUPPORTED_ROUTE_EXT.test(key)) {
    return undefined
  }
  if (key === '/') {
    return '/'
  }
  if (isLogicalUrlRoutePath(key, routeRoot)) {
    return key
  }
  if (isNotFoundRoute(key)) {
    return '/404'
  }

  const routeKey = getRouteKey(key, routeRoot)
  if (hasPrivateSegment(routeKey)) {
    return undefined
  }

  const segments: string[] = []
  const transformedKey = routeKey.replace(...patterns.splat).replace(...patterns.param)
  for (const rawSegment of transformedKey.split('/')) {
    for (const dotSegment of rawSegment.split('.')) {
      if (!dotSegment || dotSegment === 'index' || dotSegment === '_layout') {
        continue
      }
      if (/^\([\w-]+\)$/.test(dotSegment)) {
        continue
      }
      const normalizedSegment = dotSegment.replace(...patterns.optional)
      if (normalizedSegment) {
        segments.push(normalizedSegment)
      }
    }
  }

  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}
