import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { generateHydrationScript, getAssets } from 'solid-js/web'
import type { Logger, Plugin, ResolvedConfig } from 'vite'
import { normalizePath } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
import type { InheritanceConfig } from './utils/definition'
import { extract } from './utils/extract'
import { RouteRegistry } from './utils/registry'
import type { InfoTypeDefinition } from './utils/route-type'

type Awaitable<T> = T | Promise<T>
export type PrerenderRoutesSource = readonly string[] | (() => Awaitable<readonly string[]>)

interface FileRouterPluginOption {
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
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
  /**
   * Whether to reload the page when route files change.
   * @default true
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
     * SSR entry file path.
     * @default 'src/entry-server.tsx'
     */
    serverEntry?: string
    /**
     * Prerender routes or a lazy route producer.
     * @default ['/']
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
const ENVIRONMENT = {
  CLIENT: 'client',
  SERVER: 'ssr',
} as const
const INDEX_HTML_FILE_NAME = 'index.html'
const DEFAULT_PRERENDER_CONCURRENCY = 4
const CACHE_BUST_PARAM = 't'
const SLASH_CODE_POINT = '/'.codePointAt(0)!

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

function findSsrEntryChunk(bundle: BundleOutput, root: string, serverEntry: string) {
  const resolvedServerEntry = normalizePath(path.resolve(root, serverEntry))
  const entryChunks = Object.values(bundle).filter(
    (item): item is BundleChunk => item.type === 'chunk' && !!item.isEntry,
  )

  return (
    entryChunks.find((item) => normalizePath(item.facadeModuleId ?? '') === resolvedServerEntry) ??
    entryChunks[0]
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
  return import(`${serverEntryUrl}?${CACHE_BUST_PARAM}=${Date.now()}`).then((mod) => mod.default ?? mod)
}

function renderTemplate(template: string, app: string) {
  return template
    .replace(/<div id="root">.*?<\/div>/, `<div id="root">${app}</div>`)
    .replace('</head>', `${generateHydrationScript()}${getAssets()}</head>`)
}

/**
 * Vite plugin for page generation
 */
export function fileRouter(options: FileRouterPluginOption = {}): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    pagesDir = 'src/pages',
    ignore = DEFAULT_IGNORES,
    reloadOnChange = true,
    lazy,
    infoDts,
    verboseLog,
    inheritance = { enabled: true },
    ssg,
  } = options

  const ssgConfig = {
    enabled: !!ssg,
    serverEntry: ssg?.serverEntry ?? 'src/entry-server.tsx',
    routes: ssg?.routes ?? ['/'],
    concurrency: Math.max(1, ssg?.concurrency ?? DEFAULT_PRERENDER_CONCURRENCY),
  }
  let logger: Logger | undefined
  let serverEntryFileName: string | undefined

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  const registry = new RouteRegistry({
    pagesDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
  })

  return [
    {
      name: `${PACKAGE_NAME}:extract`,
      async configResolved(config) {
        logger = config.logger
        await registry.initialize(config.root)
      },
      config(userConfig, env) {
        if (!ssgConfig.enabled || env.command !== 'build') {
          return
        }

        const getOutDir = (envName: EnvironmentName, subDir: string) =>
          path.join(userConfig.environments?.[envName]?.build?.outDir ?? 'dist', subDir)
        const clientOutDir = getOutDir(ENVIRONMENT.CLIENT, 'client')
        const serverOutDir = getOutDir(ENVIRONMENT.SERVER, 'server')
        return {
          build: {
            copyPublicDir: false,
          },
          builder: {
            sharedPlugins: true,
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
              logger?.info(`Build completed! You can serve ${clientOutDir} with a static file server.`)
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
                ssr: ssgConfig.serverEntry,
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
          id: new RegExp(VID_EXTRACT),
        },
        handler() {
          return VID_EXTRACT_RESOLVED
        },
      },
      load: {
        filter: {
          id: new RegExp(VID_EXTRACT_RESOLVED),
        },
        handler(_, options) {
          return registry.getDefinition(lazy ?? !options?.ssr)
        },
      },
      configureServer(server) {
        const invalidateVirtualModule = (id: string) => {
          const module = server.moduleGraph.getModuleById(id)
          if (module) {
            server.moduleGraph.invalidateModule(module)
          }
        }

        const invalidateFileModules = (file: string) => {
          const modules = server.moduleGraph.getModulesByFile(normalizePath(file))
          if (!modules) {
            return
          }

          for (const module of modules) {
            server.moduleGraph.invalidateModule(module)
          }
        }

        const handleStructureEvent =
          (handler: (file: string) => Promise<boolean>) => async (file: string) => {
            if (!(await handler(file))) {
              return
            }

            invalidateVirtualModule(VID_EXTRACT_RESOLVED)
            server.ws.send({
              type: 'full-reload',
            })
          }

        server.watcher
          .on(
            'add',
            handleStructureEvent((file) => registry.addFile(file)),
          )
          .on(
            'unlink',
            handleStructureEvent((file) => registry.removeFile(file)),
          )
          .on('change', (file) => {
            if (!registry.markChanged(file)) {
              return
            }

            invalidateFileModules(file)
            invalidateVirtualModule(VID_EXTRACT_RESOLVED)

            if (reloadOnChange) {
              server.ws.send({
                type: 'full-reload',
              })
            }
          })
      },
      generateBundle: {
        order: 'post',
        async handler(_outputOptions, bundle) {
          if (!ssgConfig.enabled) {
            return
          }

          if (this.environment.name === ENVIRONMENT.SERVER) {
            const ssrEntryChunk = findSsrEntryChunk(
              bundle as BundleOutput,
              this.environment.config.root,
              ssgConfig.serverEntry,
            )
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
          const resolvedRoutes =
            typeof ssgConfig.routes === 'function' ? await ssgConfig.routes() : ssgConfig.routes
          const prerenderRoutes = Array.from(
            new Set(resolvedRoutes.map((route) => normalizeRoutePath(route))),
          )
          const serverRenderer = await loadServerRenderer(this.environment.config, serverEntryFileName)

          // Keep static-host fallback for client-side routing.
          this.emitFile({
            type: 'asset',
            fileName: '404.html',
            source: htmlTemplate,
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
                html: renderTemplate(htmlTemplate, str),
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
        async handler(code, fullId) {
          const [id, query] = fullId.split('?')
          if (query && queryMap.has(query)) {
            const pick = queryMap.get(query)!
            return await extract(code, id!, { entryFn: 'createRoute', pick }, verboseLog)
          }
        },
      },
    } satisfies Plugin,
  ]
}
