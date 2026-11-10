import type { RouteManifestEntry, RouteTreeEntry } from './types'

/** Removes `(group)` segments from a route path: `/(app)/home` → `/home`. */
export function stripRouteGroups(path: string): string {
  const stripped = path.replace(/\([^)/]+\)/g, '').replace(/\/+/g, '/')
  return stripped.length > 0 ? stripped : '/'
}

/**
 * Nests a flat manifest by path prefix and strips `(group)` segments, so
 * `/(app)/dashboard` renders at `/dashboard` inside the `/(app)` layout.
 */
export function buildRouteTree(entries: readonly RouteManifestEntry[]): RouteTreeEntry[] {
  function processRoute(routes: RouteTreeEntry[], route: RouteManifestEntry, id: string): void {
    const parentRoute = routes.find((o) => id.startsWith(`${o.id}/`))
    if (!parentRoute) {
      routes.push({ ...route, id, path: stripRouteGroups(id) })
      return
    }
    parentRoute.children ||= []
    processRoute(parentRoute.children, route, id.slice(parentRoute.id.length))
  }

  return [...entries]
    .sort(
      (a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    )
    .reduce<RouteTreeEntry[]>((routes, route) => {
      processRoute(routes, route, route.path)
      return routes
    }, [])
}
