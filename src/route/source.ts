/** A value that may be returned synchronously or asynchronously. */
export type Promisable<T> = T | Promise<T>

/** Resolves route source files for a Vite root. */
export type RouteSourceGlob = (
  glob: typeof import('tinyglobby').glob,
  filter: string,
  root: string,
) => Promisable<string[]>

export interface RouteSourceEntry<TData = unknown> {
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

export interface RouteSourceLoadContext<TData = unknown> {
  /** Logical file path returned by `transformPath`. */
  path: string
  /** Normalized public route ID. */
  routeId: string
  /** Original source path returned by `glob`. */
  sourcePath: string
  /** Generated virtual module ID for this route source. */
  moduleId: string
  /** Provider-specific data returned by `transformPath`. */
  data?: TData
}

export interface RouteSourceProvider<TData = unknown> {
  /** Glob used for discovery and source-file HMR matching. */
  filter: string
  /**
   * Optional custom glob implementation.
   * @default (glob, filter, root) => glob(filter, { cwd: root, absolute: false })
   */
  glob?: RouteSourceGlob
  /**
   * Maps each discovered source path to its logical route entry.
   * @default (path) => ({ path }).
   */
  transformPath?: (path: string) => RouteSourceEntry<TData>
  /** Loads the generated route module source. */
  load: (
    entry: RouteSourceLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  /**
   * Additional files or globs that trigger provider rescans.
   * @default [].
   */
  watch?: string[]
}

function defaultGlob(glob: Parameters<RouteSourceGlob>[0], filter: string, root: string) {
  return glob(filter, { cwd: root, absolute: false })
}

/** Normalizes a route source and supplies default glob/path transforms. */
export function defineRouteSource<TData>(
  provider: RouteSourceProvider<TData>,
): RouteSourceProvider<TData> {
  return {
    glob: defaultGlob,
    transformPath(path) {
      return { path }
    },
    ...provider,
  }
}
