import type { RouteDefinition, RouteSectionProps } from '@solidjs/router'
import type { Component } from 'solid-js'
import { createComponent, ErrorBoundary, Suspense, untrack } from 'solid-js'
import { hydrate, render, renderToStringAsync } from 'solid-js/web'

type AnyComp = Component<any>

/** Wraps a route component with loading and error boundaries. */
export function __loader__(Comp: AnyComp, Loading: AnyComp, Error: AnyComp) {
  return (props: RouteSectionProps) => {
    const Catch =
      Error || ((props) => (import.meta.env.DEV && console.error(untrack(() => props.error)), null))
    return createComponent(ErrorBoundary, {
      fallback: (error, reset) =>
        createComponent(Catch, {
          error,
          reset,
        }),
      children: Loading
        ? createComponent(Suspense, {
            get fallback() {
              return createComponent(Loading, props)
            },
            get children() {
              return createComponent(Comp, props)
            },
          })
        : createComponent(Comp, props),
    })
  }
}

/** Generated route path declarations augmented by the application. */
export interface FileRoutePath {}
/** Generated route metadata declarations augmented by the application. */
export interface FileRouteInfo {}
export type FileRouteInfoMap = Partial<
  Record<keyof FileRoutePath & string, FileRouteInfo | undefined>
>
/** A matched route entry returned by the Solid router. */
export interface FileRouteMatch {
  info?: FileRouteInfo
  route?: {
    info?: FileRouteInfo
  }
}

interface ErrorComponentProps {
  error: Error
  reset: VoidFunction
}

/**
 * Configuration object for defining route behavior.
 *
 * When used in `_app.tsx` or `_layout.tsx` files, the `loadingComponent` and
 * `errorComponent` properties serve as defaults for all descendant routes.
 *
 * **Component Inheritance:**
 * Routes automatically inherit loading and error components through a three-tier
 * fallback chain:
 * 1. Route-specific component (defined in the route's own `createRoute()`)
 * 2. Nearest ancestor `_layout.tsx` default
 * 3. `_app.tsx` application-wide default
 * 4. None (if not defined anywhere)
 *
 * **Controlling Inheritance:**
 * Use the `inherit` property to control inheritance behavior for individual routes:
 * - `inherit: false` - Disable all inheritance for this route
 * - `inherit: { loading: false }` - Disable loading component inheritance only
 * - `inherit: { error: false }` - Disable error component inheritance only
 *
 * @example
 * // In _app.tsx - Define application-wide defaults
 * export default createRoute({
 *   component: (props) => <div>{props.children}</div>,
 *   loadingComponent: () => <div>Loading...</div>,
 *   errorComponent: (props) => <div>Error: {props.error.message}</div>
 * })
 *
 * @example
 * // In dashboard/_layout.tsx - Override for dashboard section
 * export default createRoute({
 *   component: (props) => <DashboardLayout>{props.children}</DashboardLayout>,
 *   loadingComponent: () => <DashboardSpinner />
 *   // errorComponent inherits from _app.tsx
 * })
 *
 * @example
 * // In dashboard/users.tsx - Route-specific override
 * export default createRoute({
 *   component: () => <UsersList />,
 *   loadingComponent: () => <UsersLoadingSkeleton />
 *   // Overrides dashboard/_layout.tsx default
 * })
 *
 * @example
 * // Disable inheritance for a specific route
 * export default createRoute({
 *   component: () => <SpecialPage />,
 *   inherit: false // No loading/error components from layouts
 * })
 *
 * @example
 * // Selectively disable inheritance
 * export default createRoute({
 *   component: () => <CustomPage />,
 *   loadingComponent: () => <CustomLoader />,
 *   inherit: { error: false } // Use custom loader, but no error boundary
 * })
 */
export type RouteConfig<T = unknown> = Pick<
  RouteDefinition<string, T>,
  'matchFilters' | 'preload'
> & {
  info?: FileRouteInfo
  /** Whether this route is only available during development. */
  draft?: boolean
  component: Component<RouteSectionProps<T>>
  errorComponent?: Component<ErrorComponentProps>
  loadingComponent?: Component<RouteSectionProps<T>>
  /**
   * Control component inheritance from layouts.
   *
   * - `false`: Disable all inheritance (loading and error components)
   * - `{ loading: false }`: Disable loading component inheritance only
   * - `{ error: false }`: Disable error component inheritance only
   * - `undefined` or `true`: Enable inheritance (default behavior)
   *
   * @default undefined (inheritance enabled)
   */
  inherit?:
    | boolean
    | {
        loading?: boolean
        error?: boolean
      }
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

/** Reads route metadata from the deepest matched route. */
export function readRouteInfo<T extends FileRouteInfo = FileRouteInfo>(
  matches: readonly FileRouteMatch[],
): T | undefined {
  const route = matches.at(-1)
  return (route?.route?.info ?? route?.info) as T | undefined
}

/** Generates a route URL from typed path and query parameters. */
export function generatePath<T extends keyof FileRoutePath & string>(
  path: T,
  params: FileRoutePath[T] extends never
    ? Record<string, unknown>
    : FileRoutePath[T] & Record<string, unknown>,
): string {
  if (!params) {
    return path
  }
  let result = path as string
  let searchParam: URLSearchParams | undefined
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith('$')) {
      result = result.replace(`:${k.slice(1)}`, v as string)
    } else {
      if (!searchParam) {
        searchParam = new URLSearchParams()
      }
      searchParam.append(k, v as string)
    }
  }

  if (searchParam) {
    result += `?${searchParam.toString()}`
  }

  return result
}

/** Mounts or hydrates the client application at the supplied element. */
export function createClientEntry(
  component: Parameters<typeof render>[0],
  mount: Parameters<typeof render>[1],
) {
  if (import.meta.env.DEV) {
    render(component, mount)
  } else if ('_$HY' in window) {
    hydrate(component, mount)
  } else {
    render(component, mount)
  }
}

/** Creates an SSR renderer for the supplied application component. */
export async function createServerEntry(component: Component<{ url: string; base: string }>) {
  if (!import.meta.env.SSR) {
    throw new Error('[solid-file-router] createServerEntry can only run during SSR')
  }

  return (props: { url: string }) => {
    return renderToStringAsync(() =>
      component({
        get base() {
          return import.meta.env.BASE_URL
        },
        get url() {
          return props.url
        },
      }),
    )
  }
}
