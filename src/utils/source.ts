export type Promisable<T> = T | Promise<T>

export interface RouteSourceEntry {
  routeId: string
  routePath: string
  sourcePath: string
}

export interface RouteSourceLoadContext {
  routeId: string
  routePath: string
  sourcePath: string
  moduleId: string
}

export interface RouteSourceProvider {
  scan:
    | string
    | ((glob: typeof import('tinyglobby').glob, root: string) => Promisable<RouteSourceEntry[]>)
  load: (entry: RouteSourceLoadContext) => Promisable<string | null | undefined | false | void>
  watchFiles?: string[]
}
