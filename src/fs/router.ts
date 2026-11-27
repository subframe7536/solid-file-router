import { posix, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import picomatch from 'picomatch'
import { convertPathToPattern, globSync } from 'tinyglobby'

import type {
  FileSystemRouterConfig,
  RouteManifestEntry,
  RouterEvent,
  RouterReloadType,
} from './types'

/** Normalize a file path to posix separators. */
export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

/** Strips the route dir prefix and the file extension from a source path. */
export function cleanPath(src: string, config: FileSystemRouterConfig): string {
  const sub = src.slice(config.dir.length)
  const dot = sub.lastIndexOf('.')
  return dot !== -1 && config.extensions.includes(sub.slice(dot + 1)) ? sub.slice(0, dot) : sub
}

/**
 * Scans a directory into a flat, neutral route manifest and keeps it up to date
 * as files are added, changed, and removed.
 */
export class BaseFileSystemRouter extends EventTarget {
  routes: Array<RouteManifestEntry> = []
  /** Bumped on every dispatched reload; consumers use it to skip stale work. */
  version = 0
  private sources = new Map<string, string>()
  config: FileSystemRouterConfig
  private routePaths = new Map<string, string>()
  private buildRoutesPromise?: Promise<Array<RouteManifestEntry>>
  private matcher?: (src: string) => boolean

  constructor(config: FileSystemRouterConfig) {
    super()
    this.config = { ...config, dir: normalizePath(resolve(config.dir)) }
  }

  glob(): string | Array<string> {
    const ext = this.config.extensions
    const suffix = ext.length === 1 ? `.${ext[0]}` : `.{${ext.join(',')}}`
    return posix.join(convertPathToPattern(this.config.dir), `**/*${suffix}`)
  }

  isRoute(src: string): boolean {
    this.matcher ??= picomatch(this.glob())
    return this.matcher(src)
  }

  /**
   * Returns the source path relative to this router's directory with its
   * extension stripped, or `undefined` if `src` is outside the directory.
   */
  relativePath(src: string): string | undefined {
    const normalized = normalizePath(src)
    const prefix = this.config.dir.endsWith('/') ? this.config.dir : `${this.config.dir}/`
    if (!normalized.startsWith(prefix)) {
      return undefined
    }
    return cleanPath(normalized, this.config).replace(/^\/+/, '')
  }

  toPath(src: string): string | undefined {
    if (this.config.toPath) {
      return this.config.toPath(cleanPath(src, this.config), this.config)
    }
    throw new Error('Not implemented')
  }

  toRoute(src: string): RouteManifestEntry | undefined {
    if (this.config.toRoute) {
      return this.config.toRoute(src, this)
    }
    throw new Error('Not implemented')
  }

  _addRoute(route: RouteManifestEntry, src?: string): boolean {
    const idx = this.routes.findIndex((r) => r.path === route.path)
    if (idx >= 0) {
      this.routes[idx] = route
      return true
    }
    if (src !== undefined) {
      this.sources.set(route.path, src)
    }
    const at =
      src === undefined
        ? -1
        : this.routes.findIndex((r) => {
            const other = this.sources.get(r.path)
            return other !== undefined && other > src
          })
    if (at === -1) {
      this.routes.push(route)
    } else {
      this.routes.splice(at, 0, route)
    }
    return false
  }

  async updateRoute(src: string): Promise<void> {
    const normalized = normalizePath(src)
    if (!this.isRoute(normalized)) {
      return
    }
    try {
      const route = this.toRoute(normalized)
      if (!route) {
        this.removeRoute(normalized)
        return
      }
      if (this.routePaths.get(normalized) !== route.path) {
        this.removeRoute(normalized)
      }
      const previous = this.routes.find((r) => r.path === route.path)
      const updated = this._addRoute(route, normalized)
      this.routePaths.set(normalized, route.path)
      // Skip the reload when rescanning produced an identical entry — edits
      // that don't touch exports leave the manifest (and generated code)
      // byte-for-byte the same.
      if (!updated || !isDeepStrictEqual(previous, route)) {
        this.reload(route.path, updated ? 'update' : 'add')
      }
    } catch (error) {
      console.error(error)
    }
  }

  async addRoute(src: string): Promise<void> {
    return this.updateRoute(src)
  }

  reload(route: string, type: RouterReloadType): void {
    this.version++
    this.dispatchEvent(
      new CustomEvent('reload', {
        detail: { route, type },
      }),
    )
  }

  removeRoute(src: string): void {
    const normalized = normalizePath(src)
    const path = this.routePaths.get(normalized)
    if (path === undefined) {
      return
    }
    this.routePaths.delete(normalized)
    const idx = this.routes.findIndex((r) => r.path === path)
    if (idx === -1) {
      return
    }
    this.routes.splice(idx, 1)
    this.sources.delete(path)
    this.reload(path, 'remove')
  }

  on(type: string, cb: (evt: RouterEvent) => void): () => void {
    const listener = cb as EventListener
    this.addEventListener(type, listener)
    return () => this.removeEventListener(type, listener)
  }

  async buildRoutes(): Promise<Array<RouteManifestEntry>> {
    const pattern = this.glob()
    const patterns = Array.isArray(pattern) ? pattern : [pattern]
    const files = new Set<string>()
    for (const p of patterns) {
      for (const src of globSync(p, { absolute: true })) {
        files.add(src)
      }
    }
    await [...files]
      .sort()
      .reduce<Promise<void>>(
        (chain, src) => chain.then(() => this.addRoute(src)),
        Promise.resolve(),
      )
    return this.routes
  }

  async getRoutes(): Promise<Array<RouteManifestEntry>> {
    return (this.buildRoutesPromise ??= this.buildRoutes())
  }
}

/**
 * Combines multiple file-system routers into one. File events, scanning, and
 * manifest mapping delegate to the first child router that owns each file.
 */
export class CompositeFileSystemRouter extends BaseFileSystemRouter {
  readonly children: ReadonlyArray<BaseFileSystemRouter>

  constructor(children: ReadonlyArray<BaseFileSystemRouter>) {
    super({ dir: '.', extensions: [] })
    this.children = children
  }

  override glob(): Array<string> {
    return this.children.flatMap((child) => {
      const pattern = child.glob()
      return Array.isArray(pattern) ? pattern : [pattern]
    })
  }

  override isRoute(src: string): boolean {
    return this.children.some((child) => child.isRoute(src))
  }

  override toPath(src: string): string | undefined {
    return this.children.find((child) => child.isRoute(src))?.toPath(src)
  }

  override toRoute(src: string): RouteManifestEntry | undefined {
    return this.children.find((child) => child.isRoute(src))?.toRoute(src)
  }

  override relativePath(src: string): string | undefined {
    const owner =
      this.children.find((child) => child.isRoute(src)) ??
      this.children.find((child) => child.relativePath(src) !== undefined)
    return owner?.relativePath(src)
  }
}
