import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { generateHydrationScript } from 'solid-js/web'
import type { Logger, Plugin, ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
import type { InheritanceConfig } from './utils/definition'
import { extract, getAstCacheKey } from './utils/extract'
import { isRouteSourceModuleId, resolveRouteSourceModuleId, RouteRegistry } from './utils/registry'
import type { RouteRegistryChange } from './utils/registry'
import type { InfoTypeDefinition, InlineInfoTypeDefinition } from './utils/route-type'
import type {
  Promisable,
  RouteSourceEntry,
  RouteSourceLoadContext,
  RouteSourceProvider,
} from './utils/source'
import { defineRouteSource } from './utils/source'

type Awaitable<T> = T | Promise<T>
export type PrerenderRoutesSource = readonly string[] | (() => Awaitable<readonly string[]>)
export {
  defineRouteSource,
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
   * Custom route source. When provided, pagesDir scanning is disabled.
   */
  routeSource?: RouteSourceProvider<TData>
  /**
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
  /**
   * Escape hatch that reloads the page for route content updates. Structural
   * changes may still reload automatically.
   * @default false
   * @deprecated Prefer Vite's normal HMR behavior.
   */
  reloadOnChange?: boolean
  /**
   * Whether to generate route modules with lazy imports.
   * When omitted, enabled in client builds and disabled in SSR builds.
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

export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

type BundleAsset = {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}
type BundleChunk = {
  type: 'chunk'
  fileName: string
  facadeModuleId?: string | null
  isEntry?: boolean
}
type BundleOutput = Record<string, BundleAsset | BundleChunk>

const queryMap = new Map<string, string[]>([
  ['route', ['info', 'preload', 'matchFilters', 'inherit', 'loadingComponent', 'errorComponent']],
  ['comp', ['component']],
])
const REG_ROUTE_QUERY = /\?(route|comp)$/
const REG_ROUTE_SOURCE_MODULE_ID = /\.solid-file-router\.tsx(?:\?.*)?$/
const ENVIRONMENT = {
  CLIENT: 'client',
  SERVER: 'ssr',
} as const
const INDEX_HTML_FILE_NAME = 'index.html'
const DEFAULT_PRERENDER_CONCURRENCY = 4
const CACHE_BUST_PARAM = 't'
const SLASH_CODE_POINT = '/'.codePointAt(0)!
const ID_PRERENDER = 'virtual:solid-file-router/prerender-entry'
const VID_PRERENDER = `\0${ID_PRERENDER}`
const OUTLET_MARKER = '<!--solid-file-router-outlet-->'
const HEAD_MARKER = '<!--solid-file-router-head-->'

type EnvironmentName = typeof ENVIRONMENT.CLIENT | typeof ENVIRONMENT.SERVER
function trimTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value.codePointAt(end - 1) === SLASH_CODE_POINT) {
    end -= 1
  }
  return value.slice(0, end)
}

function normalizeRoutePath(route: string) {
  const trimmedRoute = route.trim()
  if (!trimmedRoute || trimmedRoute === '/') {
    return '/'
  }

  const withLeadingSlash = trimmedRoute.startsWith('/') ? trimmedRoute : `/${trimmedRoute}`
  if (withLeadingSlash.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error(
      `[solid-file-router] Invalid prerender route outside output directory: ${route}`,
    )
  }
  const withoutTrailingSlash = trimTrailingSlashes(withLeadingSlash)
  return withoutTrailingSlash || '/'
}

function getPrerenderAssetFileName(route: string) {
  const normalizedRoute = normalizeRoutePath(route)

  if (normalizedRoute === '/') {
    return INDEX_HTML_FILE_NAME
  }

  const segments = normalizedRoute.slice(1).split('/')
  const lastSegment = segments.pop()!
  return path.posix.join(...segments, `${lastSegment}.html`)
}

function findIndexHtmlAsset(bundle: BundleOutput) {
  const htmlAsset = Object.values(bundle).find(
    (item): item is BundleAsset => item.type === 'asset' && item.fileName === INDEX_HTML_FILE_NAME,
  )

  if (!htmlAsset) {
    throw new Error(`Missing client ${INDEX_HTML_FILE_NAME} asset in bundle`)
  }

  return htmlAsset
}

function findSsrEntryChunk(bundle: BundleOutput, entryModuleId: string) {
  const entryChunks = Object.values(bundle).filter(
    (item): item is BundleChunk => item.type === 'chunk' && !!item.isEntry,
  )

  return entryChunks.find(
    (item) => normalizePath(item.facadeModuleId ?? '') === normalizePath(entryModuleId),
  )
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const item = items[currentIndex]
      if (item === undefined) {
        continue
      }
      results[currentIndex] = await mapper(item, currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function loadServerRenderer(config: ResolvedConfig, entryFileName: string) {
  const serverOutDir = config.environments?.[ENVIRONMENT.SERVER]?.build?.outDir
  if (!serverOutDir) {
    throw new Error('Missing SSG server environment output directory')
  }

  const resolvedOutDir = path.resolve(config.root, serverOutDir)
  const serverEntryUrl = pathToFileURL(path.join(resolvedOutDir, entryFileName)).href
  return import(`${serverEntryUrl}?${CACHE_BUST_PARAM}=${Date.now()}`).then(
    (mod) => mod.default ?? mod,
  )
}

export function renderTemplate(template: string, id: string, app: string) {
  const markerCount = template.split(OUTLET_MARKER).length - 1
  if (markerCount > 1) {
    throw new Error(`[solid-file-router] SSG found duplicate ${OUTLET_MARKER} markers`)
  }

  let rendered = template
  if (markerCount === 1) {
    rendered = rendered.replace(OUTLET_MARKER, `<div id="${id}">${app}</div>`)
  } else {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rootPattern = new RegExp(
      `<([a-z][\\w:-]*)\\b([^>]*\\bid\\s*=\\s*(['"])${escapedId}\\3[^>]*)>[\\s\\S]*?</\\1>`,
      'i',
    )
    if (rootPattern.test(rendered)) {
      rendered = rendered.replace(
        rootPattern,
        (_match, tag, attributes) => `<${tag}${attributes}>${app}</${tag}>`,
      )
    } else {
      throw new Error(
        [
          `[solid-file-router] SSG could not find an outlet in ${INDEX_HTML_FILE_NAME}.`,
          `Add ${OUTLET_MARKER} or an element with id="${id}".`,
        ].join('\n'),
      )
    }
  }

  // Vite has already injected client assets into the HTML template. Only the
  // Solid hydration bootstrap belongs here; calling getAssets outside an SSR
  // render owner is invalid and can duplicate Vite's tags.
  const headAssets = generateHydrationScript()
  if (rendered.includes(HEAD_MARKER)) {
    return rendered.replace(HEAD_MARKER, headAssets)
  }
  if (!/<\/head\s*>/i.test(rendered)) {
    throw new Error(
      `[solid-file-router] SSG could not find </head> or ${HEAD_MARKER} in ${INDEX_HTML_FILE_NAME}`,
    )
  }
  return rendered.replace(/<\/head\s*>/i, `${headAssets}</head>`)
}

/**
 * Vite plugin for page generation
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

  const registry = new RouteRegistry<TData>({
    pagesDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
    routeSource,
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
  ]
}
