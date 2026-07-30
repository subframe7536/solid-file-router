import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT } from '../const'
import type { RoutePluginContext } from '../route/plugin'
import type { RouteRegistry } from '../route/registry'

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
} from './utils'
import type { BundleOutput, EnvironmentName, PrerenderRoutesSource } from './utils'

export interface SsgOptions {
  serverEntry?: string
  id?: string
  routes?: PrerenderRoutesSource
  concurrency?: number
}

interface NormalizedSsgOptions {
  internalEntry: boolean
  serverEntry: string
  id: string
  routes?: PrerenderRoutesSource
  concurrency: number
}

function normalizeOptions(options: SsgOptions): NormalizedSsgOptions {
  return {
    internalEntry: options.serverEntry === undefined,
    serverEntry: options.serverEntry ?? ID_PRERENDER,
    routes: options.routes,
    concurrency: Math.max(1, options.concurrency ?? DEFAULT_PRERENDER_CONCURRENCY),
    id: options.id ?? 'root',
  }
}

/** Configures Vite's client and server build environments for static generation. */
function createSsgConfigPlugin<TData>(
  options: SsgOptions,
  context: RoutePluginContext<TData>,
): Plugin {
  const config = normalizeOptions(options)
  return {
    name: `${PACKAGE_NAME}:ssg-config`,
    config(userConfig, env) {
      if (env.command !== 'build') {
        return
      }
      const getOutDir = (envName: EnvironmentName, subDir: string) =>
        normalizePath(
          path.join(userConfig.environments?.[envName]?.build?.outDir ?? 'dist', subDir),
        )
      const clientOutDir = getOutDir(ENVIRONMENT.CLIENT, 'client')
      const serverOutDir = getOutDir(ENVIRONMENT.SERVER, 'server')
      return {
        build: { copyPublicDir: false },
        builder: {
          async buildApp(builder) {
            for (const name of [ENVIRONMENT.SERVER, ENVIRONMENT.CLIENT]) {
              const environment = builder.environments[name]
              if (!environment) {
                throw new Error(`Missing SSG ${name} environment in builder`)
              }
              if (!environment.isBuilt) {
                await builder.build(environment)
              }
            }
            context.logger?.info(
              `Build completed! You can serve ${clientOutDir} with a static file server.`,
            )
          },
        },
        environments: {
          [ENVIRONMENT.CLIENT]: {
            consumer: 'client',
            build: { outDir: clientOutDir, copyPublicDir: true },
          },
          [ENVIRONMENT.SERVER]: {
            consumer: 'server',
            build: {
              outDir: serverOutDir,
              ssr: config.internalEntry ? true : config.serverEntry,
              ...(config.internalEntry ? { rolldownOptions: { input: ID_PRERENDER } } : {}),
              copyPublicDir: false,
            },
            optimizeDeps: {
              exclude: ['solid-js', 'solid-js/web', '@solidjs/router', PACKAGE_NAME],
            },
          },
        },
      }
    },
  }
}

/** Provides the default server rendering entry used by SSG builds. */
function createSsgEntryPlugin(): Plugin {
  return {
    name: `${PACKAGE_NAME}:ssg-entry`,
    resolveId: {
      filter: { id: new RegExp(`^${ID_PRERENDER}$`) },
      handler: () => VID_PRERENDER,
    },
    load: {
      filter: { id: new RegExp(`^${VID_PRERENDER}$`) },
      handler: () => `import { createComponent } from 'solid-js'
import { StaticRouter } from '@solidjs/router'
import { renderToStringAsync } from 'solid-js/web'
import { Root, fileRoutes } from '${VID_EXTRACT}'

export default ({ url }) => renderToStringAsync(() => createComponent(StaticRouter, {
  url,
  root: Root,
  get children() { return fileRoutes }
}))`,
    },
  }
}

/** Renders discovered static routes into the completed client bundle. */
function createSsgRenderPlugin<TData>(
  options: SsgOptions,
  registry: RouteRegistry<TData>,
  context: RoutePluginContext<TData>,
): Plugin {
  const config = normalizeOptions(options)
  let serverEntryFileName: string
  return {
    name: `${PACKAGE_NAME}:ssg-render`,
    generateBundle: {
      order: 'post',
      async handler(_outputOptions, bundle) {
        if (this.environment.name === ENVIRONMENT.SERVER) {
          const moduleId = config.internalEntry
            ? VID_PRERENDER
            : normalizePath(path.resolve(this.environment.config.root, config.serverEntry))
          const chunk = findSsrEntryChunk(bundle as BundleOutput, moduleId)
          if (!chunk) {
            this.error(`Missing SSR entry chunk for ${config.serverEntry}`)
          }
          serverEntryFileName = chunk.fileName
          return
        }
        if (this.environment.name !== ENVIRONMENT.CLIENT) {
          return
        }
        if (!serverEntryFileName) {
          this.error('Missing SSR renderer output before prerendering client routes')
        }

        const indexHtmlAsset = findIndexHtmlAsset(bundle as BundleOutput)
        const template =
          typeof indexHtmlAsset.source === 'string'
            ? indexHtmlAsset.source
            : Buffer.from(indexHtmlAsset.source).toString('utf-8')
        const configuredRoutes =
          typeof config.routes === 'function' ? await config.routes() : config.routes
        const routes = Array.from(
          new Set((configuredRoutes ?? registry.getStaticRoutes()).map(normalizeRoutePath)),
        ).filter((route) => route !== '/404')
        const renderer = await loadServerRenderer(this.environment.config, serverEntryFileName)

        this.emitFile({
          type: 'asset',
          fileName: '404.html',
          source: renderTemplate(template, config.id, await renderer({ url: '/404' })),
        })
        if (routes.length === 0) {
          context.logger?.info(
            '[solid-file-router] emitted 404 fallback; no prerender routes configured',
          )
          return
        }

        const renderedRoutes = await mapWithConcurrency(
          routes,
          config.concurrency,
          async (route) => ({
            route,
            html: renderTemplate(template, config.id, await renderer({ url: route })),
          }),
        )
        for (const route of renderedRoutes) {
          if (route.route === '/') {
            indexHtmlAsset.source = route.html
          } else {
            this.emitFile({
              type: 'asset',
              fileName: getPrerenderAssetFileName(route.route),
              source: route.html,
            })
          }
        }
        context.logger?.info(
          `[solid-file-router] prerendered ${routes.length} routes with concurrency ${config.concurrency}`,
        )
      },
    },
  }
}

export { renderTemplate } from './utils'
export type { PrerenderRoutesSource } from './utils'

/** Creates the complete SSG integration as a single plugin. */
export function createSsgPlugin<TData>(
  options: SsgOptions,
  registry: RouteRegistry<TData>,
  context: RoutePluginContext<TData>,
): Plugin {
  const configPlugin = createSsgConfigPlugin(options, context)
  const entryPlugin = createSsgEntryPlugin()
  const renderPlugin = createSsgRenderPlugin(options, registry, context)
  return {
    name: `${PACKAGE_NAME}:ssg`,
    config: configPlugin.config,
    resolveId: entryPlugin.resolveId,
    load: entryPlugin.load,
    generateBundle: renderPlugin.generateBundle,
  }
}
