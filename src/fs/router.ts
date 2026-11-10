import { posix, resolve } from 'node:path'

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
  return path.replace(/\\/g, '/')
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
  routes: RouteManifestEntry[] = []
  private sources = new Map<string, string>()
  config: FileSystemRouterConfig
  private routePaths = new Map<string, string>()
  private buildRoutesPromise?: Promise<RouteManifestEntry[]>
  private matcher?: (src: string) => boolean

  constructor(config: FileSystemRouterConfig) {
    super()
    this.config = { ...config, dir: normalizePath(resolve(config.dir)) }
  }

  glob(): string {
    const ext = this.config.extensions
    const suffix = ext.length === 1 ? `.${ext[0]}` : `.{${ext.join(',')}}`
    return posix.join(convertPathToPattern(this.config.dir), `**/*${suffix}`)
  }

  isRoute(src: string): boolean {
    this.matcher ??= picomatch(this.glob())
    return this.matcher(src)
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
      const updated = this._addRoute(route, normalized)
      this.routePaths.set(normalized, route.path)
      this.reload(route.path, updated ? 'update' : 'add')
    } catch (e) {
      console.error(e)
    }
  }

  async addRoute(src: string): Promise<void> {
    return this.updateRoute(src)
  }

  reload(route: string, type: RouterReloadType): void {
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

  async buildRoutes(): Promise<RouteManifestEntry[]> {
    for (const src of globSync(this.glob(), { absolute: true }).sort()) {
      await this.addRoute(src)
    }
    return this.routes
  }

  async getRoutes(): Promise<RouteManifestEntry[]> {
    return (this.buildRoutesPromise ??= this.buildRoutes())
  }
}
