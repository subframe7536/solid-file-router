import { createRouter } from '@solidjs/router'
import { fileRoutes } from '@solidjs/router/fs'
import { getRequestEvent } from '@solidjs/web'
import type { ResponseStub } from '@solidjs/web'
import { announcePages } from 'prerender-crawler/announce'
import { createComponent, createContext, useContext } from 'solid-js'
import manifest, { pageRoutes } from 'virtual:routes'

import { adaptFileRoutes, collectRouteMeta, staticPathsOf } from './route'
import type { RouteEntry, RouteInfo, RouteMetaCollection, RouteMetadata } from './route'

export {
  adaptFileRoutes,
  collectRouteMeta,
  definePage,
  defineRoute,
  staticPathsOf,
  type ErrorComponentProps,
  type RouteConfig,
  type SfrRouteConfig,
  type RouteEntry,
  type RouteInfo,
  type RouteMetaCollection,
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

const RouteDataContext = createContext<RouteMetaCollection | undefined>(undefined)

let activeRouteData: RouteMetaCollection | undefined
let defaultRouteData: RouteMetaCollection | undefined

function getDefaultRouteData(): RouteMetaCollection {
  return (defaultRouteData ??= collectRouteMeta(fileRoutes(pageRoutes) as RouteEntry[]))
}

/**
 * Returns the collected route `info` map without importing the app's `Router`
 * instance, avoiding circular imports when route modules need route metadata.
 */
export function getRouteInfo(): Readonly<Record<string, RouteInfo>> {
  return (activeRouteData ?? getDefaultRouteData()).routeInfo
}

/**
 * Returns the collected route `metadata` map without importing the app's
 * `Router` instance.
 */
export function getRouteMetadata(): Readonly<Record<string, RouteMetadata>> {
  return (activeRouteData ?? getDefaultRouteData()).routeMetadata
}

/**
 * Reads the collected route `info` map from the active router context, falling
 * back to `getRouteInfo()` when called outside `<Router>`.
 */
export function useRouteInfo(): Readonly<Record<string, RouteInfo>> {
  return useContext(RouteDataContext)?.routeInfo ?? getRouteInfo()
}

/**
 * Reads the collected route `metadata` map from the active router context,
 * falling back to `getRouteMetadata()` when called outside `<Router>`.
 */
export function useRouteMetadata(): Readonly<Record<string, RouteMetadata>> {
  return useContext(RouteDataContext)?.routeMetadata ?? getRouteMetadata()
}

/** Creates the application router instance from the generated route manifest. */
export function createFileRouter(options?: FileRouterOptions): FileRouter {
  const entries = options?.routes ?? pageRoutes
  const adapted = adaptFileRoutes(fileRoutes(entries) as RouteEntry[])
  const routeData: RouteMetaCollection = {
    routeInfo: adapted.routeInfo,
    routeMetadata: adapted.routeMetadata,
  }
  activeRouteData = routeData
  const BaseRouter = createRouter({ ...options?.router, routes: adapted.routes })
  const Router = ((props: Parameters<typeof BaseRouter>[0]) =>
    createComponent(RouteDataContext, {
      value: routeData,
      get children() {
        return createComponent(BaseRouter, props)
      },
    })) as typeof BaseRouter
  return Object.assign(Router, BaseRouter, {
    fileRoutes: adapted.routes,
    routeInfo: adapted.routeInfo,
    routeMetadata: adapted.routeMetadata,
  }) as FileRouter
}

let staticPages: string[] | undefined

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
  const pages = (staticPages ??= staticPathsOf(manifest.map((entry) => entry.path)))
  return announcePages(event.request, response.headers, [...pages, ...extraPaths], options)
}
