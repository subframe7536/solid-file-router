import { createRouter } from 'radix3'
import type { RadixRouter } from 'radix3'

import { stripRouteGroups } from './tree'

export { createRouter as createRadixRouter }
export type { RadixRouter }

/**
 * The event an API handler receives.
 */
export interface APIEvent {
  request: Request
  params?: Record<string, string>
  [key: string]: unknown
}

/**
 * An API handler function (GET, POST, ...).
 */
export type APIHandler = (event: APIEvent) => unknown

/**
 * A handler module ref as delivered: code-split (`import()`) or eager (`require()`).
 */
export type APIHandlerRef =
  | {
      import: () => Promise<Record<string, APIHandler>>
    }
  | {
      require: () => Record<string, APIHandler>
    }

/** A manifest entry carrying HTTP handlers. */
export interface FileRouteHandlers {
  path: string
  page?: boolean
  $component?: unknown
  $HEAD?: APIHandlerRef
  $GET?: APIHandlerRef
  $POST?: APIHandlerRef
  $PUT?: APIHandlerRef
  $PATCH?: APIHandlerRef
  $DELETE?: APIHandlerRef
  [key: string]: unknown
}

export interface APIMatch {
  handler: APIHandlerRef
  params?: Record<string, string>
  /** `true` when the module also renders a page at this path. */
  isPage: boolean
}

export interface APIHandlerOptions {
  /** A path base stripped from the URL before matching. Defaults to `/`. */
  base?: string
  /**
   * How the adapter reaches the request event it hands to handlers.
   */
  getEvent?: () => APIEvent
}

function containsHTTP(route: FileRouteHandlers): boolean {
  return Boolean(
    route.$HEAD || route.$GET || route.$POST || route.$PUT || route.$PATCH || route.$DELETE,
  )
}

/**
 * Builds a matcher over the flat manifest's handler-carrying entries using a radix3 tree.
 */
export const createAPIMatcher = (
  routes: readonly FileRouteHandlers[],
): ((path: string, method: string) => APIMatch | undefined) => {
  const router = createRouter<{ route: FileRouteHandlers }>({
    routes: routes.reduce<Record<string, { route: FileRouteHandlers }>>((memo, route) => {
      if (!containsHTTP(route)) {
        return memo
      }
      const path = stripRouteGroups(route.path)
        .replace(/\*([^/]*)/g, (_, m: string) => `**:${m}`)
        .split('/')
        .map((s) => (s.startsWith(':') || s.startsWith('*') ? s : encodeURIComponent(s)))
        .join('/')
      if (/:[^/]*\?/g.test(path)) {
        throw new Error(`Optional parameters are not supported in API routes: ${path}`)
      }
      if (memo[path]) {
        throw new Error(
          `Duplicate API routes for "${path}" found at "${memo[path].route.path}" and "${route.path}"`,
        )
      }
      memo[path] = { route }
      return memo
    }, {}),
  })

  return (path: string, method: string): APIMatch | undefined => {
    const match = router.lookup(path)
    if (!match?.route) {
      return undefined
    }
    const route = match.route
    const handler = (method === 'HEAD' ? route.$HEAD || route.$GET : route[`$${method}`]) as
      | APIHandlerRef
      | undefined
    if (handler === undefined) {
      return undefined
    }
    return {
      handler,
      params: match.params,
      isPage: route.page === true && route.$component !== undefined,
    }
  }
}

/** Strips a leading path base: `stripPathBase("/app/x", "/app")` → `/x`. */
export const stripPathBase = (path: string, base: string): string => {
  if (!base || base === '/') {
    return path
  }
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  if (path === normalizedBase) {
    return '/'
  }
  if (path.startsWith(`${normalizedBase}/`)) {
    return path.slice(normalizedBase.length)
  }
  return path
}

const RequestContext = Symbol.for('solid.RequestContext')

function getScopedEvent(): APIEvent {
  const event = (globalThis as any)[RequestContext]?.getStore()
  if (!event) {
    throw new Error(
      'API route dispatched outside a request-event scope. Pass the request event ' +
        'instead of the request, compose the handler inside `provideRequestEvent`, ' +
        'or pass `getEvent`.',
    )
  }
  return event
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) {
    return result
  }
  if (typeof result === 'string') {
    return new Response(result)
  }
  return Response.json(result)
}

/**
 * Fetch-style middleware serving the manifest's API routes.
 */
export const createAPIHandler = (
  routes: readonly FileRouteHandlers[],
  options: APIHandlerOptions = {},
): ((
  input: Request | { request: Request },
  next: (request?: Request) => Response | Promise<Response>,
) => Promise<Response>) => {
  const match = createAPIMatcher(routes)
  return async (input, next) => {
    const request = 'request' in input ? input.request : input
    const url = new URL(request.url)
    const matched = match(stripPathBase(url.pathname, options.base ?? '/'), request.method)
    if (!matched) {
      return next()
    }
    const mod =
      'require' in matched.handler ? matched.handler.require() : await matched.handler.import()
    const fn = request.method === 'HEAD' ? mod.HEAD || mod.GET : mod[request.method]
    if (typeof fn !== 'function') {
      return next()
    }
    const event = options.getEvent?.() ?? ('request' in input ? (input as any) : getScopedEvent())
    event.params = matched.params || {}
    const result = await fn(event)
    if (result !== undefined) {
      return toResponse(result)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new Error(
        `API handler for ${request.method} "${request.url}" did not return a response.`,
      )
    }
    if (!matched.isPage) {
      return new Response(null, { status: 404 })
    }
    return next()
  }
}
