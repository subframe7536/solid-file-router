import path from 'node:path'

import type { Logger, Plugin } from 'vite'
import { normalizePath } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
import { compileMdx, mdxRouteSource } from './mdx/router'
import type { MdxOptions } from './mdx/router'
import type { InheritanceConfig } from './routes/definition'
import { extract, getAstCacheKey } from './routes/extract'
import { isRouteSourceModuleId, resolveRouteSourceModuleId, RouteRegistry } from './routes/registry'
import type { RouteRegistryChange } from './routes/registry'
import type { InfoTypeDefinition, InlineInfoTypeDefinition } from './routes/route-type'
import type {
  Promisable,
  RouteSourceEntry,
  RouteSourceLoadContext,
  RouteSourceProvider,
} from './routes/source'
import { defineRouteSource, fsRouteSource } from './routes/source'
import {
  DEFAULT_PRERENDER_CONCURRENCY,
  ENVIRONMENT,
  findIndexHtmlAsset,
  findSsrEntryChunk,
  getPrerenderAssetFileName,
  ID_PRERENDER,
  loadServerRenderer,
  mapWithConcurrency,
  normalizeRoutePath,
  renderTemplate,
  VID_PRERENDER,
} from './ssg'
import type { BundleOutput, EnvironmentName, PrerenderRoutesSource } from './ssg'

/** A static route list or lazy route producer used by SSG. */
export type { PrerenderRoutesSource } from './ssg'
export { renderTemplate } from './ssg'
export {
  defineRouteSource,
  type MdxOptions,
  type Promisable,
  type RouteSourceEntry,
  type RouteSourceLoadContext,
  type RouteSourceProvider,
}
export type { InfoTypeDefinition, InlineInfoTypeDefinition }

export interface FileRouterPluginOption<TData = unknown> {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The directory containing all route files.
   *
   * e.g. If your `_app.tsx` is located at `module/routes/_app.tsx`,
   * You need to setup to `module/routes`
   * @default 'src/pages'
   */
  pagesDir?: string
  /**
   * Additional custom route sources appended after the built-in sources.
   * @default undefined
   */
  routeSource?: RouteSourceProvider<TData> | readonly RouteSourceProvider<TData>[]
  /**
   * Enable built-in Markdown/MDX route discovery and Satteri compilation.
   * @default false
   */
  mdx?: boolean | MdxOptions
  /**
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   * @default DEFAULT_IGNORES
   */
  ignore?: string[]
  /**
   * Escape hatch that reloads the page for route content updates. Structural
   * changes may still reload automatically. Useful when route modules depend
   * on state that Vite cannot update through the normal HMR module graph.
   * @default false
   */
  reloadOnChange?: boolean
  /**
   * Whether to generate route modules with lazy imports.
   * When omitted, enabled in client builds and disabled in SSR builds.
   * @default Client builds: true; SSR builds: false
   */
  lazy?: boolean
  /**
   * Route's dts config to control Route's info type
   * @example
   * ```ts
   * {
   *   title: 'string',
   *   description: 'string',
   *   auth: {
   *     required: 'boolean',
   *     code: 'string',
   *   },
   *   tags: 'string[]',
   * }
   * ```
   */
  infoDts?: InfoTypeDefinition
  /**
   * Whether to enable verbose log
   * @default false
   */
  verboseLog?: boolean
  /**
   * Component inheritance configuration.
   *
   * Controls how loading and error components are inherited from layouts.
   *
   * @default { enabled: true }
   *
   * @example
   * // Disable inheritance globally
   * { enabled: false }
   *
   * @example
   * // Enable with custom behavior
   * {
   *   enabled: true,
   *   inheritLoading: true,
   *   inheritError: true
   * }
   */
  inheritance?: InheritanceConfig
  /**
   * Optional SSG configuration with Vite Environment API.
   * Keep `vite-plugin-solid` setup in user land while this plugin handles prerender outputs.
   */
  ssg?: {
    /**
     * Custom build-time renderer entry. When omitted, the generated internal
     * prerender entry is used.
     */
    serverEntry?: string
    /**
     * The ID of the root element where the app will be mounted.
     * @default 'root'
     */
    id?: string
    /**
     * Prerender routes or a lazy route producer.
     * When omitted, every concrete static route in the registry is rendered.
     */
    routes?: PrerenderRoutesSource
    /**
     * Max concurrent prerender tasks.
     * @default 4
     */
    concurrency?: number
  }
}

/** Default directories excluded from route discovery. */
export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

const queryMap = new Map<string, string[]>([
  ['route', ['info', 'preload', 'matchFilters', 'inherit', 'loadingComponent', 'errorComponent']],
  ['comp', ['component']],
])
const REG_ROUTE_QUERY = /\?(route|comp)$/
const REG_ROUTE_SOURCE_MODULE_ID = /-sfr\.tsx(?:\?.*)?$/
const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i

/**
 * Vite plugin for page generation.
 */
export function fileRouter<TData = unknown>(options: FileRouterPluginOption<TData> = {}): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    pagesDir = 'src/pages',
    ignore = DEFAULT_IGNORES,
    reloadOnChange = false,
    lazy,
    infoDts,
    verboseLog,
    inheritance = { enabled: true },
    routeSource,
    mdx = false,
    ssg,
  } = options

  const ssgConfig = {
    enabled: !!ssg,
    internalEntry: ssg?.serverEntry === undefined,
    serverEntry: ssg?.serverEntry ?? ID_PRERENDER,
    routes: ssg?.routes,
    concurrency: Math.max(1, ssg?.concurrency ?? DEFAULT_PRERENDER_CONCURRENCY),
    id: ssg?.id ?? 'root',
  }
  let logger: Logger | undefined
  let serverEntryFileName: string
  let lastRouteChange: { key: string; promise: Promise<RouteRegistryChange> } | undefined

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  const extraRouteSources = routeSource
    ? Array.isArray(routeSource)
      ? routeSource
      : [routeSource]
    : []

  const registry = new RouteRegistry<TData>({
    pagesDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
    routeSources: [
      fsRouteSource<TData>({ pagesDir }),
      ...(mdx ? [mdxRouteSource<TData>(mdx === true ? { pagesDir } : { pagesDir, ...mdx })] : []),
      ...extraRouteSources,
    ],
  })

  function getRouteChange(
    type: 'create' | 'update' | 'delete',
    file: string,
    timestamp: number,
  ): Promise<RouteRegistryChange> {
    const key = `${type}:${file}:${timestamp}`
    if (lastRouteChange?.key === key) {
      return lastRouteChange.promise
    }

    const promise =
      type === 'create'
        ? registry.addFile(file)
        : type === 'delete'
          ? registry.removeFile(file)
          : registry.markChanged(file)
    lastRouteChange = { key, promise }
    return promise
  }

  return [
    {
      name: `${PACKAGE_NAME}:extract`,
      sharedDuringBuild: true,
      async configResolved(config) {
        logger = config.logger
        await registry.initialize(config.root)
      },
      config(userConfig, env) {
        if (!ssgConfig.enabled || env.command !== 'build') {
          return
        }

        const getOutDir = (envName: EnvironmentName, subDir: string) =>
          normalizePath(
            path.join(userConfig.environments?.[envName]?.build?.outDir ?? 'dist', subDir),
          )
        const clientOutDir = getOutDir(ENVIRONMENT.CLIENT, 'client')
        const serverOutDir = getOutDir(ENVIRONMENT.SERVER, 'server')
        return {
          build: {
            copyPublicDir: false,
          },
          builder: {
            async buildApp(builder) {
              const serverEnvironment = builder.environments[ENVIRONMENT.SERVER]
              if (!serverEnvironment) {
                throw new Error('Missing SSG server environment in builder')
              }
              if (!serverEnvironment.isBuilt) {
                await builder.build(serverEnvironment)
              }
              const clientEnvironment = builder.environments[ENVIRONMENT.CLIENT]
              if (!clientEnvironment) {
                throw new Error('Missing SSG client environment in builder')
              }
              if (!clientEnvironment.isBuilt) {
                await builder.build(clientEnvironment)
              }
              logger?.info(
                `Build completed! You can serve ${clientOutDir} with a static file server.`,
              )
            },
          },
          environments: {
            [ENVIRONMENT.CLIENT]: {
              consumer: 'client',
              build: {
                outDir: clientOutDir,
                copyPublicDir: true,
              },
            },
            [ENVIRONMENT.SERVER]: {
              consumer: 'server',
              build: {
                outDir: serverOutDir,
                ssr: ssgConfig.internalEntry ? true : ssgConfig.serverEntry,
                ...(ssgConfig.internalEntry
                  ? {
                      rolldownOptions: {
                        input: ID_PRERENDER,
                      },
                    }
                  : {}),
                copyPublicDir: false,
              },
              optimizeDeps: {
                exclude: ['solid-js', 'solid-js/web', '@solidjs/router', PACKAGE_NAME],
              },
            },
          },
        }
      },
      resolveId: {
        filter: {
          id: new RegExp(`^${VID_EXTRACT}$|^${ID_PRERENDER}$|${REG_ROUTE_SOURCE_MODULE_ID.source}`),
        },
        handler(id) {
          if (id === ID_PRERENDER) {
            return VID_PRERENDER
          }
          if (id === VID_EXTRACT) {
            return VID_EXTRACT_RESOLVED
          }

          return resolveRouteSourceModuleId(id)
        },
      },
      load: {
        filter: {
          id: new RegExp(
            `^${VID_EXTRACT_RESOLVED}$|^${VID_PRERENDER}$|${REG_ROUTE_SOURCE_MODULE_ID.source}`,
          ),
        },
        async handler(id, options) {
          if (id === VID_PRERENDER) {
            return `import { createComponent } from 'solid-js'
import { StaticRouter } from '@solidjs/router'
import { renderToStringAsync } from 'solid-js/web'
import { Root, fileRoutes } from '${VID_EXTRACT}'

export default ({ url }) => renderToStringAsync(() => createComponent(StaticRouter, {
  url,
  root: Root,
  get children() { return fileRoutes }
}))`
          }
          if (id && isRouteSourceModuleId(id)) {
            return await registry.loadRouteSourceModule(id)
          }

          return registry.getDefinition(lazy ?? !options?.ssr)
        },
      },
      configureServer(server) {
        const watchedFiles = registry.getWatchFiles()
        if (watchedFiles.length > 0) {
          server.watcher.add(watchedFiles)
        }
      },
      hotUpdate: {
        order: 'pre',
        async handler({ type, file, timestamp, modules }) {
          const change = await getRouteChange(type, file, timestamp)
          if (!change.matched) {
            return
          }

          if (reloadOnChange || change.structureChanged) {
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

          if (verboseLog) {
            logger?.info(
              `[solid-file-router] HMR modules: ${[...affectedModules]
                .map((module) => module.id)
                .join(', ')}`,
            )
          }

          return [...affectedModules]
        },
      },
      generateBundle: {
        order: 'post',
        async handler(_outputOptions, bundle) {
          if (!ssgConfig.enabled) {
            return
          }

          if (this.environment.name === ENVIRONMENT.SERVER) {
            const serverEntryModuleId = ssgConfig.internalEntry
              ? VID_PRERENDER
              : normalizePath(path.resolve(this.environment.config.root, ssgConfig.serverEntry))
            const ssrEntryChunk = findSsrEntryChunk(bundle as BundleOutput, serverEntryModuleId)
            if (!ssrEntryChunk) {
              this.error(`Missing SSR entry chunk for ${ssgConfig.serverEntry}`)
            }

            serverEntryFileName = ssrEntryChunk.fileName
            return
          }

          if (this.environment.name !== ENVIRONMENT.CLIENT) {
            return
          }

          if (!serverEntryFileName) {
            this.error('Missing SSR renderer output before prerendering client routes')
          }

          const indexHtmlAsset = findIndexHtmlAsset(bundle as BundleOutput)
          const htmlTemplate =
            typeof indexHtmlAsset.source === 'string'
              ? indexHtmlAsset.source
              : Buffer.from(indexHtmlAsset.source).toString('utf-8')
          const resolvedRoutes = ssgConfig.routes
            ? typeof ssgConfig.routes === 'function'
              ? await ssgConfig.routes()
              : ssgConfig.routes
            : registry.getStaticRoutes()
          const prerenderRoutes = Array.from(
            new Set(resolvedRoutes.map((route) => normalizeRoutePath(route))),
          ).filter((route) => route !== '/404')
          const serverRenderer = await loadServerRenderer(
            this.environment.config,
            serverEntryFileName,
          )

          const fallbackHtml = renderTemplate(
            htmlTemplate,
            ssgConfig.id,
            await serverRenderer({ url: '/404' }),
          )

          // Keep static-host fallback for client-side routing.
          this.emitFile({
            type: 'asset',
            fileName: '404.html',
            source: fallbackHtml,
          })

          if (!prerenderRoutes.length) {
            logger?.info('[solid-file-router] emitted 404 fallback; no prerender routes configured')
            return
          }

          const renderedRoutes = await mapWithConcurrency(
            prerenderRoutes,
            ssgConfig.concurrency,
            async (route) => {
              const str = await serverRenderer({
                url: route,
              })

              return {
                route,
                html: renderTemplate(htmlTemplate, ssgConfig.id, str),
              }
            },
          )

          for (const renderedRoute of renderedRoutes) {
            if (renderedRoute.route === '/') {
              indexHtmlAsset.source = renderedRoute.html
              continue
            }

            this.emitFile({
              type: 'asset',
              fileName: getPrerenderAssetFileName(renderedRoute.route),
              source: renderedRoute.html,
            })
          }

          logger?.info(
            `[solid-file-router] prerendered ${prerenderRoutes.length} routes with concurrency ${ssgConfig.concurrency}`,
          )
        },
      },
      transform: {
        filter: {
          id: REG_ROUTE_QUERY,
        },
        async handler(code, fullId, options) {
          const [id, query] = fullId.split('?')
          if (query && queryMap.has(query)) {
            const pick = queryMap.get(query)!
            const ssr = options?.ssr === true
            return await extract(
              code,
              id!,
              { entryFn: 'createRoute', pick },
              verboseLog,
              getAstCacheKey(id!, code, ssr),
            )
          }
        },
      },
    } satisfies Plugin,
    {
      name: `${PACKAGE_NAME}:mdx`,
      apply: () => !!mdx,
      transform: {
        order: 'pre',
        filter: {
          id: REG_MARKDOWN_MODULE_ID,
        },
        async handler(code, fullId) {
          const sourcePath = fullId.split('?')[0]!
          const mdxOptions = mdx === true ? { pagesDir } : { pagesDir, ...mdx }
          return await compileMdx(code, sourcePath, mdxOptions)
        },
      },
    } satisfies Plugin,
  ]
}
