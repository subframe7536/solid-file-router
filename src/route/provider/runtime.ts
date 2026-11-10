import { posix } from 'node:path'

import { glob } from 'filesystem-routing'
import type { BaseFileSystemRouter, RouteManifestEntry } from 'filesystem-routing'
import { normalizePath } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'

import { hashString } from '../../const'
import { createGlobMatcher } from '../convention'

import type { RouteProvider, RouteProviderLoadContext } from './contract'

const REG_ROUTE_EXPORT = /export\s+(?:const|let|var|function|class)\s+route\b/
const REG_DEFAULT_EXPORT = /export\s+default\b/

/** Internal router seams used to inject non-disk route entries. */
interface RouterInternals {
  _addRoute: (route: RouteManifestEntry, src?: string) => boolean
  routePaths: Map<string, string>
  reload: (route: string, type: 'update' | 'remove' | 'add') => void
  removeRoute: (src: string) => void
}

interface ProviderModule {
  /** Manifest-facing module id (`virtual:sfr/<hash>.tsx`). */
  src: string
  /** Plugin-served id (`<root>/node_modules/.sfr-virtual/<hash>.tsx`). */
  resolvedId: string
  /** Generated module source code. */
  source: string
  /** Neutral route path. */
  path: string
}

function internals(router: BaseFileSystemRouter): RouterInternals {
  return router as unknown as RouterInternals
}

function sanitizeRouteId(value: string): string {
  return value.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'route'
}

/**
 * EXPERIMENTAL: bridges `RouteProvider`s (e.g. CMS sources) onto the official
 * manifest. Provider modules are served from virtual `?pick=`-capable ids so
 * the standard tree-shaking pipeline applies.
 */
export function createRouteProviderPlugin<TData>(
  providers: readonly RouteProvider<TData>[],
  getRouters: () => BaseFileSystemRouter[],
): Plugin {
  let root = ''
  const modules = new Map<string, ProviderModule>()
  const resolvedToSrc = new Map<string, string>()

  const virtualRoot = (): string => posix.join(normalizePath(root), 'node_modules/.sfr-virtual')
  const srcIdFor = (routeId: string): string => `virtual:sfr/${routeId}.tsx`
  const resolvedIdFor = (src: string): string =>
    `${virtualRoot()}/${src.slice('virtual:sfr/'.length)}`

  async function scanProvider(
    provider: RouteProvider<TData>,
    router: BaseFileSystemRouter,
  ): Promise<ProviderModule[]> {
    const files = provider.glob
      ? await provider.glob(provider.filter, root)
      : glob(posix.join(normalizePath(root), provider.filter)).map((path) =>
          normalizePath(path).slice(normalizePath(root).length + 1),
        )
    const routerInternal = internals(router)
    const found: ProviderModule[] = []
    for (const file of files) {
      const entry = provider.transformPath?.(file) ?? { path: file }
      const logical = entry.path.replace(/^\/+/, '')
      const routeId =
        entry.routeId ??
        `${sanitizeRouteId(logical.replace(/\.[^.]+$/, ''))}-${hashString(logical)}`
      const src = srcIdFor(routeId)
      // map the logical file path through the active convention
      const fakeSrc = posix.join(router.config.dir, logical)
      const path = router.toPath(fakeSrc)
      if (path === undefined) {
        continue
      }
      const resolvedId = resolvedIdFor(src)
      const context: RouteProviderLoadContext<TData> = {
        path: entry.path,
        routeId,
        sourcePath: posix.join(normalizePath(root), file),
        moduleId: src,
        data: entry.data,
      }
      const source = await provider.load(context)
      if (typeof source !== 'string' || !source) {
        continue
      }
      const module: ProviderModule = { src, resolvedId, source, path }
      found.push(module)
      const existing = modules.get(src)
      modules.set(src, module)
      resolvedToSrc.set(resolvedId, src)
      const manifestEntry: RouteManifestEntry = {
        page: REG_DEFAULT_EXPORT.test(source),
        $component: REG_DEFAULT_EXPORT.test(source)
          ? { src, pick: ['default', '$css'] }
          : undefined,
        $$route: REG_ROUTE_EXPORT.test(source) ? { src, pick: ['route'] } : undefined,
        path,
      }
      if (!manifestEntry.page && !manifestEntry.$$route) {
        continue
      }
      routerInternal._addRoute(manifestEntry, src)
      routerInternal.routePaths.set(src, path)
      if (existing && existing.source !== source) {
        routerInternal.reload(path, 'add')
      } else if (!existing) {
        routerInternal.reload(path, 'add')
      }
    }
    return found
  }

  async function scanAll(router: BaseFileSystemRouter): Promise<Set<string>> {
    const seen = new Set<string>()
    for (const provider of providers) {
      for (const module of await scanProvider(provider, router)) {
        seen.add(module.src)
      }
    }
    return seen
  }

  async function rescanRouters(): Promise<void> {
    const routers = getRouters()
    const seen = new Set<string>()
    for (const router of routers) {
      for (const src of await scanAll(router)) {
        seen.add(src)
      }
    }
    for (const [src, module] of modules) {
      if (seen.has(src)) {
        continue
      }
      modules.delete(src)
      resolvedToSrc.delete(module.resolvedId)
      for (const router of routers) {
        internals(router).removeRoute(src)
      }
    }
  }

  return {
    name: 'solid-file-router:providers',
    configResolved(config) {
      root = config.root
    },
    async buildStart() {
      await rescanRouters()
    },
    resolveId(id) {
      const [pathname, query] = id.split('?')
      if (pathname?.startsWith('virtual:sfr/')) {
        const resolved = resolvedIdFor(pathname)
        return query ? `${resolved}?${query}` : resolved
      }
    },
    load(id) {
      const [pathname] = id.split('?')
      const src = resolvedToSrc.get(pathname!)
      if (src !== undefined) {
        return modules.get(src)?.source
      }
    },
    configureServer(server: ViteDevServer) {
      const matchers = providers.map((provider) => {
        const watchGlobs = [provider.filter, ...(provider.watch ?? [])].map((glob) =>
          posix.join(normalizePath(root), glob),
        )
        return createGlobMatcher(watchGlobs)
      })
      const rescan = (): void => void rescanRouters()
      server.watcher.on('change', (path) => {
        const normalized = normalizePath(path)
        if (matchers.some((match) => match(normalized))) {
          void rescan()
        }
      })
      server.watcher.on('add', (path) => {
        const normalized = normalizePath(path)
        if (matchers.some((match) => match(normalized))) {
          void rescan()
        }
      })
      server.watcher.on('unlink', (path) => {
        const normalized = normalizePath(path)
        if (matchers.some((match) => match(normalized))) {
          void rescan()
        }
      })
    },
  }
}
