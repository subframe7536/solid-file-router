import type { BaseFileSystemRouter } from './router'

export interface ModuleRef {
  /** Absolute path of the source module. */
  src: string
  /** The named exports (or `"default"`) this ref selects from the module. */
  pick: string[]
  /** Deliver eagerly even under code splitting. */
  eager?: boolean
}

export interface RouteManifestEntry {
  /**
   * The route path in the neutral pattern language:
   * `:param`, `:param?` (optional) and `*rest` (catch-all) segments.
   * Group segments (`(name)`) are retained.
   */
  path: string
  /** `true` when the module renders a page (has a default export). */
  page?: boolean
  /** `true` when the page component is a server function. */
  server?: boolean
  /** Lazy ref to the page component module. */
  $component?: ModuleRef
  /** Eager ref to the route config (`route` export), when present. */
  $$route?: ModuleRef
  /** Additional refs and metadata added by convention extensions. */
  [key: string]: unknown
}

export interface RouteTreeEntry extends RouteManifestEntry {
  /** The manifest path this node was nested under, group segments included. */
  id: string
  children?: RouteTreeEntry[]
}

export interface FileSystemRouterConfig {
  /** Route directory to scan. Relative paths are resolved against cwd or vite root. */
  dir: string
  /** File extensions (without the dot) that participate in routing. */
  extensions: string[]
  /** Pluggable filename convention mapping route file to pattern path. */
  toPath?: (routeFile: string, config: FileSystemRouterConfig) => string | undefined
  /** Pluggable module convention mapping source file to manifest entry. */
  toRoute?: (src: string, router: BaseFileSystemRouter) => RouteManifestEntry | undefined
}

export interface PageFileSystemRouterConfig extends FileSystemRouterConfig {
  /** Emit `$component` refs for pages. Defaults to `true`. */
  components?: boolean
  /** Treat these uppercase exports as request handlers. Defaults to `false`. */
  httpMethods?: boolean | readonly string[]
  /** Recognize server-function pages (`"use server"`). Defaults to `false`. */
  serverComponents?: boolean
}

export interface FileRoutesOptions extends Pick<
  PageFileSystemRouterConfig,
  'components' | 'httpMethods' | 'serverComponents' | 'toPath' | 'toRoute'
> {
  /** Route directory, relative to the Vite root. Defaults to `src/routes`. */
  dir?: string
  /** File extensions that participate in routing. Defaults to js/jsx/ts/tsx. */
  extensions?: string[]
  /** Custom file-system router. */
  router?: BaseFileSystemRouter
  /** Per-environment file-system routers, keyed by Vite environment name. */
  routers?: Record<string, BaseFileSystemRouter>
  /** The id the route manifest is served from. Defaults to `virtual:file-routes`. */
  moduleId?: string
  /** Vite environments whose build should take every route module as an entry. */
  buildInputs?: string | string[]
  /** Code-split routes into dynamic imports. Defaults to `true`. */
  codeSplitting?: boolean
  /** Packages to exclude from dependency optimization. */
  optimizeDepsExclude?: string[]
  /** Write declaration for the virtual module. */
  types?: boolean | string
}

export type RouterReloadType = 'update' | 'remove' | 'add'

export type RouterEvent = CustomEvent<{
  route: string
  type: RouterReloadType
}>
