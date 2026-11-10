import { createRouter } from '@solidjs/router'
import { fileRoutes } from '@solidjs/router/fs'
import { pageRoutes } from 'virtual:routes'

import type { RouteMetadata } from './metadata'
import { adaptFileRoutes } from './route/adapter'
import type { RouteEntry } from './route/adapter'

export {
  adaptFileRoutes,
  defineRoute,
  type ErrorComponentProps,
  type RouteConfig,
  type SfrRouteConfig,
  type RouteEntry,
} from './route/adapter'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from './metadata'

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
  routeInfo: Record<string, unknown>
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
