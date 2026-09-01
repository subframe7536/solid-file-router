import type { Logger, Plugin } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT, VID_EXTRACT_RESOLVED } from '../const'

import { extract, getAstCacheKey } from './extract'
import { isRouteProviderModuleId, resolveRouteProviderModuleId } from './provider'
import type { RouteRegistry, RouteRegistryChange } from './registry'

const REG_ROUTE_QUERY = /\?(route|comp)$/
const REG_ROUTE_PROVIDER_MODULE_ID = /-sfr\.tsx(?:\?.*)?$/
const routeProperties = new Map<string, string[]>([
  [
    'route',
    [
      'info',
      'metadata',
      'preload',
      'matchFilters',
      'inherit',
      'draft',
      'loadingComponent',
      'errorComponent',
    ],
  ],
  ['comp', ['component']],
])

export interface RoutePluginContext<TData> {
  registry: RouteRegistry<TData>
  root?: string
  lazy?: boolean
  reloadOnChange: boolean
  verboseLog?: boolean
  logger?: Logger
}

/** Owns route discovery, virtual modules, transforms, watching, and HMR. */
export function createRouterPlugin<TData>(context: RoutePluginContext<TData>): Plugin {
  let lastChange: { key: string; promise: Promise<RouteRegistryChange> } | undefined
  // Caches the real source file path for each virtual module ID (-sfr.tsx).
  // Populated in load() and read in transform() so Babel can set sourceFileName
  // on the output sourcemap, making sources point to an existing file on disk.
  const sourcePathCache = new Map<string, string>()

  function getChange(
    type: 'create' | 'update' | 'delete',
    file: string,
    timestamp: number,
  ): Promise<RouteRegistryChange> {
    const key = `${type}:${file}:${timestamp}`
    if (lastChange?.key === key) {
      return lastChange.promise
    }

    const promise =
      type === 'create'
        ? context.registry.addFile(file)
        : type === 'delete'
          ? context.registry.removeFile(file)
          : context.registry.markChanged(file)
    lastChange = { key, promise }
    return promise
  }

  return {
    name: `${PACKAGE_NAME}:router`,
    sharedDuringBuild: true,
    async configResolved(config) {
      context.logger = config.logger
      context.root = config.root
      await context.registry.initialize(config.root)
    },
    configureServer(server) {
      const watchedFiles = context.registry.getWatchFiles()
      if (watchedFiles.length > 0) {
        server.watcher.add(watchedFiles)
      }
    },
    hotUpdate: {
      order: 'pre',
      async handler({ type, file, timestamp, modules }) {
        const change = await getChange(type, file, timestamp)
        if (!change.matched) {
          return
        }
        if (context.reloadOnChange || change.structureChanged) {
          this.environment.hot.send({ type: 'full-reload' })
          return []
        }

        const affectedModules = new Set(modules)
        for (const moduleId of change.changedModuleIds) {
          for (const id of [moduleId, `${moduleId}?route`, `${moduleId}?comp`]) {
            const module = this.environment.moduleGraph.getModuleById(id)
            if (module) {
              affectedModules.add(module)
            }
          }
        }
        if (context.verboseLog) {
          context.logger?.info(
            `[solid-file-router] HMR modules: ${[...affectedModules]
              .map((module) => module.id)
              .join(', ')}`,
          )
        }
        return [...affectedModules]
      },
    },
    resolveId: {
      filter: { id: new RegExp(`^${VID_EXTRACT}$|${REG_ROUTE_PROVIDER_MODULE_ID.source}`) },
      handler(id) {
        return id === VID_EXTRACT
          ? VID_EXTRACT_RESOLVED
          : resolveRouteProviderModuleId(id, context.root)
      },
    },
    load: {
      filter: {
        id: new RegExp(`^${VID_EXTRACT_RESOLVED}$|${REG_ROUTE_PROVIDER_MODULE_ID.source}`),
      },
      async handler(id, options) {
        if (id && isRouteProviderModuleId(id)) {
          const module = await context.registry.loadRouteProviderModule(id)
          if (!module) {
            return undefined
          }
          // Cache sourcePath so transform() can retrieve it for Babel's sourceFileName.
          sourcePathCache.set(id.replace(/\?.*$/, ''), module.sourcePath)
          return { code: module.code, map: module.map }
        }
        return context.registry.getDefinition(context.lazy ?? !options?.ssr)
      },
    },
    transform: {
      filter: { id: REG_ROUTE_QUERY },
      async handler(code, fullId, options) {
        const [id, query] = fullId.split('?')
        const pick = query ? routeProperties.get(query) : undefined
        if (!id || !pick) {
          return
        }
        // Retrieve the real source file path stored during load(), so that
        // Babel sets sourceFileName correctly on the output sourcemap.
        const sourcePath = sourcePathCache.get(id)
        return await extract(
          code,
          id,
          { entryFn: 'createRoute', pick },
          context.verboseLog,
          getAstCacheKey(id, code, options?.ssr === true),
          sourcePath,
        )
      },
    },
  }
}
