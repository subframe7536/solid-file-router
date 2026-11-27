import type { RouteManifestEntry, RouteTreeEntry } from './types'

/** Removes `(group)` segments from a route path: `/(app)/home` → `/home`. */
export function stripRouteGroups(path: string): string {
  const stripped = path.replaceAll(/\([^)/]+\)/g, '').replaceAll(/\/+/g, '/')
  return stripped.length > 0 ? stripped : '/'
}

/**
 * Nests a flat manifest by path prefix and strips `(group)` segments, so
 * `/(app)/dashboard` renders at `/dashboard` inside the `/(app)` layout.
 * Children carry their id relative to the parent (`/(app)/blog` under
 * `/(app)` has id `/blog`).
 */
export function buildRouteTree(entries: ReadonlyArray<RouteManifestEntry>): Array<RouteTreeEntry> {
  const tree: Array<RouteTreeEntry> = []
  const nodes = new Map<string, RouteTreeEntry>()
  const sorted = [...entries].sort(
    (a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  )
  for (const route of sorted) {
    const id = route.path
    // The parent is the longest proper segment-prefix that is itself a
    // node; parents are always shorter so they are already registered.
    let ancestor = id
    let parent: RouteTreeEntry | undefined
    while (parent === undefined && ancestor.length > 0) {
      ancestor = ancestor.slice(0, Math.max(ancestor.lastIndexOf('/'), 0))
      parent = nodes.get(ancestor)
    }
    const relative = parent ? id.slice(ancestor.length) : id
    const node: RouteTreeEntry = { ...route, id: relative, path: stripRouteGroups(relative) }
    nodes.set(id, node)
    const siblings = parent ? (parent.children ||= []) : tree
    siblings.push(node)
  }
  return tree
}
