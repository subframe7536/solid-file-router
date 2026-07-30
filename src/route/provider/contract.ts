/** A value that may be returned synchronously or asynchronously. */
export type Promisable<T> = T | Promise<T>

/** Resolves route files for a Vite root. */
export type RouteProviderGlob = (
  glob: typeof import('tinyglobby').glob,
  filter: string,
  root: string,
) => Promisable<string[]>

export interface RouteProviderEntry<TData = unknown> {
  /** Logical file path used for route matching and layout inheritance. */
  path: string
  /**
   * Optional public route ID.
   * @default Derived from `path`.
   */
  routeId?: string
  /** Provider-specific data passed unchanged to `load`. */
  data?: TData
}

export interface RouteProviderLoadContext<TData = unknown> {
  /** Logical file path returned by `transformPath`. */
  path: string
  /** Normalized public route ID. */
  routeId: string
  /** Original source path returned by `glob`. */
  sourcePath: string
  /** Generated virtual module ID for this route provider entry. */
  moduleId: string
  /** Provider-specific data returned by `transformPath`. */
  data?: TData
}

export interface RouteProvider<TData = unknown> {
  /** Glob used for discovery and source-file HMR matching. */
  filter: string
  /**
   * Optional custom glob implementation.
   * @default (glob, filter, root) => glob(filter, { cwd: root, absolute: false })
   */
  glob?: RouteProviderGlob
  /**
   * Maps each discovered source path to its logical route entry.
   * @default (path) => ({ path }).
   */
  transformPath?: (path: string) => RouteProviderEntry<TData>
  /** Loads the generated route module source. */
  load: (
    entry: RouteProviderLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  /**
   * Additional files or globs that trigger provider rescans.
   * @default [].
   */
  watch?: string[]
}

/** Normalizes a route provider and supplies default glob/path transforms. */
export function defineRouteProvider<TData>(provider: RouteProvider<TData>): RouteProvider<TData> {
  return {
    glob: (glob, filter, root) => glob(filter, { cwd: root, absolute: false }),
    transformPath(path) {
      return { path }
    },
    ...provider,
  }
}
