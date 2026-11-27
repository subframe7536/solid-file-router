import { readFile } from 'node:fs/promises'
import { posix, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { hashString, PACKAGE_NAME, VID_EXTRACT, VID_MDX_ROUTE } from '../const'
import type { ModuleRef } from '../fs'

import { serializeJavaScriptValue } from './frontmatter'
import {
  compileMdxRouteDocument,
  extractMdxRouteData,
  renderMdxComponentModule,
  renderMdxRouteModule,
} from './router'
import type {
  CompiledMdxRouteData,
  ExtractedMdxRouteData,
  MdxLoadContext,
  MdxOptions,
  MdxRouteConfig,
} from './router'

const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i
const REG_MDX_ROUTE_VIRTUAL_ID = new RegExp(
  `^${VID_MDX_ROUTE.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`,
)
const REG_MDX_ROUTE_RESOLVED_ID = /\/node_modules\/\.sfr-mdx-route\/[^/]+\.tsx(?:\?.*)?$/

function stripQuery(id: string): string {
  return id.split('?')[0] ?? id
}

/** Prefix of virtual `$$route` modules emitted for `.md`/`.mdx` routes. */
export const MDX_ROUTE_MODULE_PREFIX = VID_MDX_ROUTE

export type MdxContextResolver = (sourcePath: string) => {
  path?: string
  routePath?: string
}

export interface MdxPluginIntegration {
  plugin: Plugin
  resolveInlineRoute: (ref: ModuleRef) => Promise<{ code: string; watchFile?: string } | undefined>
}

/**
 * Creates the MDX Vite plugin together with an inline `$$route` resolver used
 * by `fileRouter` to embed MDX route configs directly into `virtual:routes`.
 */
export function createMdxIntegration<TData = unknown>(
  options: false | MdxOptions<TData>,
  resolveContext?: MdxContextResolver,
): MdxPluginIntegration {
  let root = ''
  const routeSources = new Map<string, string>()
  const inlinedRouteSources = new Set<string>()
  const lastRouteConfigs = new Map<string, MdxRouteConfig>()
  const cache = new Map<string, { source: string; promise: Promise<CompiledMdxRouteData> }>()
  const routeCache = new Map<string, { source: string; promise: Promise<ExtractedMdxRouteData> }>()

  function resolveMdxContext(sourcePath: string): MdxLoadContext<TData> {
    const resolved = resolveContext?.(sourcePath)
    const fallbackPath = root
      ? normalizePath(relative(root, sourcePath)).replace(/\.[^./]+$/, '')
      : sourcePath
    return {
      path: resolved?.path ?? fallbackPath,
      ...(resolved?.routePath !== undefined ? { routePath: resolved.routePath } : {}),
      sourcePath,
    }
  }

  function compileCached(source: string, rawSourcePath: string): Promise<CompiledMdxRouteData> {
    const sourcePath = normalizePath(rawSourcePath)
    const cached = cache.get(sourcePath)
    if (cached && cached.source === source) {
      return cached.promise
    }
    const promise = compileMdxRouteDocument(
      source,
      sourcePath,
      options as MdxOptions<TData>,
      resolveMdxContext(sourcePath),
    )
      .then((compiled) => {
        lastRouteConfigs.set(sourcePath, compiled.routeConfig)
        return compiled
      })
      .catch((error: unknown) => {
        if (cache.get(sourcePath)?.promise === promise) {
          cache.delete(sourcePath)
        }
        throw error
      })
    cache.set(sourcePath, { source, promise })
    return promise
  }

  function loadRouteCached(source: string, rawSourcePath: string): Promise<ExtractedMdxRouteData> {
    const sourcePath = normalizePath(rawSourcePath)
    const fullCached = cache.get(sourcePath)
    if (fullCached && fullCached.source === source) {
      return fullCached.promise
    }
    const mdxOptions = options as MdxOptions<TData>
    if (!mdxOptions.extendRoute && mdxOptions.extendLoad) {
      return compileCached(source, sourcePath)
    }
    const cached = routeCache.get(sourcePath)
    if (cached && cached.source === source) {
      return cached.promise
    }
    const promise = extractMdxRouteData(
      source,
      sourcePath,
      mdxOptions,
      resolveMdxContext(sourcePath),
    )
      .then((extracted) => {
        lastRouteConfigs.set(sourcePath, extracted.routeConfig)
        return extracted
      })
      .catch((error: unknown) => {
        if (routeCache.get(sourcePath)?.promise === promise) {
          routeCache.delete(sourcePath)
        }
        throw error
      })
    routeCache.set(sourcePath, { source, promise })
    return promise
  }

  async function resolveInlineRoute(
    ref: ModuleRef,
  ): Promise<{ code: string; watchFile?: string } | undefined> {
    if (!options || !ref.src.startsWith(VID_MDX_ROUTE)) {
      return undefined
    }
    const rawSourcePath = ref.src.slice(VID_MDX_ROUTE.length)
    const sourcePath = normalizePath(rawSourcePath)
    inlinedRouteSources.add(sourcePath)
    const source = await readFile(sourcePath, 'utf8')
    const extracted = await loadRouteCached(source, sourcePath)
    const picked: Record<string, unknown> = {}
    for (const key of ref.pick) {
      if (key === 'route') {
        picked.route = extracted.routeConfig
      } else if (key === 'frontmatter') {
        picked.frontmatter = extracted.frontmatter
      }
    }
    return {
      code: serializeJavaScriptValue(picked),
      watchFile: sourcePath,
    }
  }

  const plugin: Plugin = {
    name: `${PACKAGE_NAME}:mdx`,
    apply: () => !!options,
    configResolved(config) {
      root = config.root
    },
    async handleHotUpdate({ file, server }) {
      const sourcePath = normalizePath(file)
      const prevRouteConfig = lastRouteConfigs.get(sourcePath)
      cache.delete(sourcePath)
      routeCache.delete(sourcePath)
      if (!options || !inlinedRouteSources.has(sourcePath) || !server?.environments) {
        return
      }
      try {
        const source = await readFile(sourcePath, 'utf8')
        const next = await loadRouteCached(source, sourcePath)
        if (!isDeepStrictEqual(prevRouteConfig, next.routeConfig)) {
          for (const env of Object.values(server.environments)) {
            const mod = env.moduleGraph.getModuleById(VID_EXTRACT)
            if (!mod) {
              continue
            }
            env.moduleGraph.invalidateModule(mod)
            if (env.name === 'client') {
              void env.reloadModule(mod)
            }
          }
        }
      } catch {
        // File deletion/rename is handled by fileSystemWatcher.
      }
    },
    resolveId: {
      filter: { id: REG_MDX_ROUTE_VIRTUAL_ID },
      handler(id) {
        const [pathname, query] = id.split('?')
        if (!pathname?.startsWith(VID_MDX_ROUTE)) {
          return
        }
        const src = pathname.slice(VID_MDX_ROUTE.length)
        const resolved = `${posix.join(normalizePath(root), 'node_modules/.sfr-mdx-route')}/${hashString(src)}.tsx`
        routeSources.set(resolved, src)
        return query ? `${resolved}?${query}` : resolved
      },
    },
    load: {
      filter: { id: REG_MDX_ROUTE_RESOLVED_ID },
      async handler(id) {
        if (!options) {
          return
        }
        const src = routeSources.get(stripQuery(id))
        if (src === undefined) {
          return
        }
        const source = await readFile(src, 'utf8')
        const extracted = await loadRouteCached(source, src)
        return renderMdxRouteModule(extracted).code
      },
    },
    transform: {
      order: 'pre',
      filter: { id: REG_MARKDOWN_MODULE_ID },
      async handler(code, fullId) {
        if (!options) {
          return
        }
        const sourcePath = stripQuery(fullId)
        const compiled = await compileCached(code, sourcePath)
        return renderMdxComponentModule(compiled).code
      },
    },
  }

  return { plugin, resolveInlineRoute }
}

/** Compiles Markdown route modules and serves their `$$route` virtual modules. */
export function createMdxPlugin<TData = unknown>(
  options: false | MdxOptions<TData>,
  resolveContext?: MdxContextResolver,
): Plugin {
  return createMdxIntegration(options, resolveContext).plugin
}
