import { createRouter } from '@solidjs/router'
import { fileRoutes } from '@solidjs/router/fs'
import { getRequestEvent } from '@solidjs/web'
import type { ResponseStub } from '@solidjs/web'
import { announcePages } from 'prerender-crawler/announce'
import manifest, { pageRoutes } from 'virtual:routes'

import { adaptFileRoutes, staticPathsOf } from './route'
import type { RouteEntry, RouteInfo, RouteMetadata } from './route'

export {
  adaptFileRoutes,
  definePage,
  defineRoute,
  staticPathsOf,
  type ErrorComponentProps,
  type RouteConfig,
  type SfrRouteConfig,
  type RouteEntry,
  type RouteInfo,
} from './route'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from './route'
export { announcePages } from 'prerender-crawler/announce'

export interface FileRouterOptions {
  /** Manifest tree injection point — defaults to the `virtual:routes` module. */
  routes?: typeof pageRoutes
  /** Extra `createRouter` config (`base`, `preloadLinks`, ...) passed through. */
  router?: Parameters<typeof createRouter>[0]
}

export interface FileRouter extends ReturnType<typeof createRouter> {
  /** The adapted route-definition tree passed to `createRouter`. */
  fileRoutes: RouteEntry[]
  /** Collected route `info` keyed by group-stripped path. */
  routeInfo: Record<string, RouteInfo>
  /** Collected route `metadata` keyed by group-stripped path. */
  routeMetadata: Record<string, RouteMetadata>
}

/** Creates the application router instance from the generated route manifest. */
export function createFileRouter(options?: FileRouterOptions): FileRouter {
  const entries = options?.routes ?? pageRoutes
  const adapted = adaptFileRoutes(fileRoutes(entries) as RouteEntry[])
  const Router = createRouter({ ...options?.router, routes: adapted.routes })
  return Object.assign(Router, {
    fileRoutes: adapted.routes,
    routeInfo: adapted.routeInfo,
    routeMetadata: adapted.routeMetadata,
  }) as FileRouter
}

/**
 * Tells a prerender crawl which pages exist: the manifest's static routes
 * plus `extraPaths` (e.g. dynamic routes the app expands from data). Called
 * during server render — reads the ambient request event and sets the
 * `x-prerender` hint header only when the request is the crawler's, so a
 * regular visitor's response is untouched; a no-op on the client.
 *
 * ```tsx
 * // src/App.tsx
 * const Router = createFileRouter()
 * export default () => {
 *   announceRoutes()
 *   return <Router>{(props) => <>{props.children}</>}</Router>
 * }
 * ```
 */
export function announceRoutes(
  extraPaths: readonly string[] = [],
  options: { header?: string } = {},
): boolean {
  const event = getRequestEvent()
  const response = (event as { response?: ResponseStub } | undefined)?.response
  if (!event || !response || response.committed) {
    return false
  }
  const pages = staticPathsOf(manifest.map((entry) => entry.path))
  return announcePages(event.request, response.headers, [...pages, ...extraPaths], options)
}
