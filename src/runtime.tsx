import type { Component } from 'solid-js'
import type { RouteDefinition, RouteSectionProps } from '@solidjs/router'

interface ErrorComponentProps {
  error: Error
  reset: VoidFunction
}

export type RouteConfig<T = unknown> = Pick<
  RouteDefinition<string, T>,
  'info' | 'matchFilters' | 'preload'
> & {
  component: Component<RouteSectionProps<T>>
  errorComponent?: Component<ErrorComponentProps>
  loadingComponent?: Component<RouteSectionProps<T>>
}

/**
 * Indicate the route export
 *
 * @example
 * ```ts
 * export default createRoute({})
 * ```
 */
export function createRoute<T>(config: RouteConfig<T>): RouteConfig<T> {
  return config
}

export interface RoutePath {}

export function generatePath<T extends keyof RoutePath & string>(
  path: T,
  params: RoutePath[T] extends never
    ? Record<string, unknown>
    : RoutePath[T] & Record<string, unknown>,
): string {
  if (!params) {
    return path
  }
  let result = path as string
  const searchParam = new URLSearchParams()
  for (const [k, v] of Object.keys(params)) {
    if (k.startsWith('$')) {
      result = result.replace(k, v)
    } else {
      searchParam.append(k, v)
    }
  }

  return result + searchParam.toString()
}
