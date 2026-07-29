export type Promisable<T> = T | Promise<T>

export interface RouteSourceEntry<TData = unknown> {
  routeId?: string
  routePath: string
  sourcePath: string
  data?: TData
}

export interface RouteSourceLoadContext<TData = unknown> {
  routeId: string
  routePath: string
  sourcePath: string
  moduleId: string
  data?: TData
}

export interface RouteSourceProvider<TData = unknown> {
  scan:
    | string
    | ((
        glob: typeof import('tinyglobby').glob,
        root: string,
      ) => Promisable<RouteSourceEntry<TData>[]>)
  load: (
    entry: RouteSourceLoadContext<TData>,
  ) => Promisable<string | null | undefined | false | void>
  watchFiles?: string[]
}

export const defineRouteSource = <TData>(
  provider: RouteSourceProvider<TData>,
): RouteSourceProvider<TData> => provider
