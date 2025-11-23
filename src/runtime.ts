import type { Component } from 'solid-js'
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router'

export namespace FileRouteInfo {
  export interface Path {}
  export interface Info {}
}

interface ErrorComponentProps {
  error: Error
  reset: VoidFunction
}

export type RouteConfig<T = unknown> = Pick<
  RouteDefinition<string, T>,
  'matchFilters' | 'preload'
> & {
  info?: FileRouteInfo.Info
  component: Component<RouteSectionProps<T>>
  errorComponent?: Component<ErrorComponentProps>
  loadingComponent?: Component<RouteSectionProps<T>>
}

/**
 * Indicate the route export entry
 *
 * @example
 * ```ts
 * export default createRoute({})
 * ```
 */
export function createRoute<T>(config: RouteConfig<T>): RouteConfig<T> {
  return config
}

export function generatePath<T extends keyof FileRouteInfo.Path & string>(
  path: T,
  params: FileRouteInfo.Path[T] extends never
    ? Record<string, unknown>
    : FileRouteInfo.Path[T] & Record<string, unknown>,
): string {
  if (!params) {
    return path
  }
  let result = path as string
  let searchParam: URLSearchParams | undefined
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('$')) {
      result = result.replace(':' + k.slice(1), v as string)
    } else {
      if (!searchParam) {
        searchParam = new URLSearchParams()
      }
      searchParam.append(k, v as string)
    }
  }

  if (searchParam) {
    result += '?' + searchParam.toString()
  }

  return result
}
