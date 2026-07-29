import { readFile } from 'node:fs/promises'

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
   * @default The built-in tinyglobby `glob` function.
   */
  glob?: RouteSourceGlob
  /**
   * Maps each discovered source path to its logical route entry.
   * @default Returns `{ path }`.
   */
  transformPath?: (path: string) => RouteSourceEntry<TData>
  /** Loads the generated route module source. */
  load: (
    entry: RouteSourceLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  /**
   * Additional files or globs that trigger provider rescans.
   * @default `[]`.
   */
  watch?: string[]
}

export interface FsRouteSourceOptions {
  /**
   * Glob scanned relative to the Vite root.
   * @default Derived from `pagesDir` for JSX and TSX files.
   */
  filter?: string
  /**
   * Directory used by the default filter.
   * @default `'src/pages'`.
   */
  pagesDir?: string
}

const defaultGlob: RouteSourceGlob = (glob, filter, root) =>
  glob(filter, { cwd: root, absolute: false })

/** Normalizes a route source and supplies default glob/path transforms. */
export const defineRouteSource = <TData>(
  provider: RouteSourceProvider<TData>,
): RouteSourceProvider<TData> => ({
  glob: defaultGlob,
  transformPath: (path) => ({ path }),
  ...provider,
})

/**
 * Creates the built-in JSX/TSX filesystem route source.
 * @default `{}`.
 */
export const FsRouteSource = <TData = unknown>(
  options: FsRouteSourceOptions = {},
): RouteSourceProvider<TData> => {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const filter = options.filter ?? `${pagesDir}/**/*.{jsx,tsx}`
  const prefix = `${pagesDir.replace(/^\.\//, '').replace(/\/$/, '')}/`

  return defineRouteSource<TData>({
    filter,
    transformPath(file) {
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file
      return { path: relative.replace(/\.(jsx|tsx)$/i, '.tsx') }
    },
    load: ({ sourcePath }) => readFile(sourcePath, 'utf8'),
  })
}
