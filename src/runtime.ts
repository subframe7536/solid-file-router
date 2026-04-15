import type { RouteDefinition, RouteSectionProps } from '@solidjs/router'
import type { Accessor, Component, JSX } from 'solid-js'
import { createComponent } from 'solid-js'
import {
  generateHydrationScript,
  render,
  hydrate,
  renderToStringAsync,
  getAssets,
} from 'solid-js/web'

export interface FileRoutePath {}
export interface FileRouteInfo {}
export type FileRouteInfoMap = Partial<
  Record<keyof FileRoutePath & string, FileRouteInfo | undefined>
>
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
  /**
   * Whether to prerender this route during static site generation (SSG).
   *
   * - `true`: Prerender this route
   * - `false`: Explicitly exclude from prerendering
   * - `{ params: Record<string, string | string[]> }`: Prerender with specific parameter values for dynamic routes
   *
   * @default undefined (not prerendered unless specified in plugin config)
   */
  prerender?: boolean | { params: Record<string, string | string[]> }
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

export function readRouteInfo<T extends FileRouteInfo = FileRouteInfo>(
  matches: readonly FileRouteMatch[],
): T | undefined {
  const route = matches.at(-1)
  return (route?.route?.info ?? route?.info) as T | undefined
}

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

/**
 * Render a Solid application to the DOM for client-side rendering (CSR) or hydration.
 * In development mode, this function always uses `render()` for faster updates and better debugging.
 * In production mode, it checks for the presence of the `_$HY` property on the `window` object to determine whether to use `hydrate()` (if server-rendered content is detected) or `render()` (for client-only rendering).
 *
 * @param component - A function that returns the root JSX element of the application
 * @param elementId - The ID of the DOM element to render into
 */
export function renderClient(component: Accessor<JSX.Element>, elementId: string) {
  if (import.meta.env.DEV) {
    render(component, document.getElementById(elementId)!)
  } else {
    ;('_$HY' in window ? hydrate : render)(component, document.getElementById(elementId)!)
  }
}

export interface RenderServerResult {
  html: string
  head: string
}

type Promisable<T> = Promise<T> | T

export interface RenderServerOptions {
  Router?: Component<{ url?: string }>
  renderApp?: (app: () => JSX.Element, url: string) => Promisable<string>
  extraHead?: (context: { url: string; html: string }) => Promisable<string | void>
  onRenderError?: (context: {
    error: unknown
    url: string
  }) => Promisable<RenderServerResult | void>
  transformResult?: (
    context: RenderServerResult & { url: string },
  ) => Promisable<RenderServerResult>
}

/**
 * Render a Solid application to an HTML string for server-side rendering (SSR).
 *
 * @param options - Configuration options for server rendering
 */
export function renderServer(
  component: Accessor<JSX.Element>,
  options: RenderServerOptions = {},
): (url: string) => Promise<RenderServerResult> {
  const { renderApp, extraHead, onRenderError, transformResult } = options

  return async (url) => {
    const app = () => createComponent(component, { url })

    let html
    try {
      html = renderApp ? await renderApp(app, url) : await renderToStringAsync(app)
    } catch (error) {
      if (onRenderError) {
        const handled = await onRenderError({ error, url })
        if (handled) {
          return handled
        }
      }
      throw error
    }

    const extra = extraHead ? await extraHead({ url, html }) : getAssets()

    const result = {
      html,
      head: generateHydrationScript() + (extra || ''),
    }

    return transformResult ? await transformResult({ ...result, url }) : result
  }
}
