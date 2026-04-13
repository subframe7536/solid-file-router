import type { FileRoutePath } from '../runtime'

type RoutePaths = keyof FileRoutePath & string

export interface SSGRouteEntry {
  path: RoutePaths
  params?: Record<string, string | string[]>
}

export interface SSGConfig {
  /**
   * Routes to prerender. Supports:
   * - Exact paths: `'/about'`
   * - Glob `'*'`: all static routes
   * - Glob patterns: `'/nest/*'` (direct children), `'/nest/**'` (all descendants)
   * - Route entry objects with params for dynamic routes
   */
  routes?: (RoutePaths | '*' | (string & {}) | SSGRouteEntry)[]
  /**
   * Path to the server entry file.
   * Must default-export `(url: string) => Promise<SSGRenderResult>`
   *
   * You can use `renderServer` from `virtual:router-entry` for advanced customization.
   *
   * If not set or the file doesn't exist, a default entry will be generated automatically.
   * @default 'src/entry-server.tsx'
   */
  serverEntry?: string
  crawl?: boolean
  mountId?: string
  timeout?: number
  concurrency?: number
}

export interface SSGRenderResult {
  html: string
  head: string
}

export interface CollectedRoute {
  path: string
  source: 'config' | 'prerender' | 'crawl'
}
