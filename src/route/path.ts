import { normalizePath } from 'vite'

export const patterns = {
  optional: [/^-(:?[\w-]+|\*)/, '$1?'],
  param: [/\[([^\]]+)]/g, ':$1'],
  slash: [/^index$|\./g, '/'],
  splat: [/\[\.{3}\w+\]/g, '*'],
} as const

const REG_APP = /^_app\.(jsx|tsx)$/
const REG_LAYOUT = /^_layout\.(jsx|tsx)$/
const REG_NOT_FOUND = /^404\.(jsx|tsx)$/
const REG_ROUTE_EXT = /\.(jsx|tsx)$/
const REG_UNSUPPORTED_ROUTE_EXT = /\.mdx$/

function getRouteBasename(file: string) {
  return file.slice(file.lastIndexOf('/') + 1)
}

export function isAppRoute(file: string) {
  return REG_APP.test(getRouteBasename(file))
}

export function isLayoutRoute(file: string) {
  return REG_LAYOUT.test(getRouteBasename(file))
}

export function isNotFoundRoute(file: string) {
  return file === '404' || file.endsWith('/404') || REG_NOT_FOUND.test(getRouteBasename(file))
}

export function hasPrivateSegment(file: string) {
  return file.split('/').some((segment) => segment.startsWith('_'))
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
  if (key.includes('/_') && !isNotFoundRoute(key)) {
    return undefined
  }
  if (isNotFoundRoute(key)) {
    return '/404'
  }

  const path = getRouteKey(key, routeRoot)
    .replace(...patterns.splat)
    .replace(...patterns.param)
    .replace(/(^|\/)_layout(?=\/|$)/g, '')
    .replace(/\([\w-]+\)\//g, '')
    .replace(/\/?index|\./g, '/')
    .replace(/(\w)\/$/g, '$1')
    .split('/')
    .map((segment) => segment.replace(...patterns.optional))
    .join('/')
  if (!path) {
    return undefined
  }
  return path.length > 1 ? `/${path}` : path
}
