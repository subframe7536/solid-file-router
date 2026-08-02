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

export { renderTemplate } from './utils'
export type { PrerenderRoutesSource } from './utils'

/** Creates the complete SSG integration as a single conditionally enabled plugin. */
export function createSsgPlugin<TData>(
  options: false | SsgOptions,
  registry: RouteRegistry<TData>,
  context: RoutePluginContext<TData>,
): Plugin {
  const config = {
    internalEntry: options === false || options.serverEntry === undefined,
    serverEntry: options === false ? ID_PRERENDER : (options.serverEntry ?? ID_PRERENDER),
    routes: options === false ? undefined : options.routes,
    concurrency: Math.max(
      1,
      options === false
        ? DEFAULT_PRERENDER_CONCURRENCY
        : (options.concurrency ?? DEFAULT_PRERENDER_CONCURRENCY),
    ),
    id: options === false ? 'root' : (options.id ?? 'root'),
  }
  let serverEntryFileName: string
  return {
    name: `${PACKAGE_NAME}:ssg`,
    sharedDuringBuild: true,
    apply() {
      return !!options
    },
    config(userConfig, env) {
      if (!options || env.command !== 'build') {
        return
      }
      function getOutDir(envName: EnvironmentName, subDir: string): string {
        return normalizePath(
          path.join(userConfig.environments?.[envName]?.build?.outDir ?? 'dist', subDir),
        )
      }
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
    resolveId: {
      filter: { id: new RegExp(`^${ID_PRERENDER}$`) },
      handler() {
        return VID_PRERENDER
      },
    },
    load: {
      filter: { id: new RegExp(`^${VID_PRERENDER}$`) },
      handler() {
        return `import { createComponent } from 'solid-js'
import { StaticRouter, useCurrentMatches } from '@solidjs/router'
import { renderToStringAsync } from 'solid-js/web'
import { Root, fileRoutes } from '${VID_EXTRACT}'

export default async ({ url }) => {
  let metadata
  const root = (props) => {
    const matches = useCurrentMatches()
    const key = matches().at(-1)?.route.key
    metadata = key && typeof key === 'object' ? key.metadata : undefined
    return createComponent(Root, props)
  }
  return {
    html: await renderToStringAsync(() => createComponent(StaticRouter, {
      url,
      root,
      get children() { return fileRoutes }
    })),
    metadata,
  }
}`
      },
    },
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
        const requestedRoutes = configuredRoutes ?? (await registry.getStaticRoutes())
        const routes = Array.from(
          new Set(
            (configuredRoutes
              ? await registry.filterDraftRoutes(requestedRoutes)
              : requestedRoutes
            ).map(normalizeRoutePath),
          ),
        ).filter((route) => route !== '/404')
        const renderer = await loadServerRenderer(this.environment.config, serverEntryFileName)

        const fallback = await renderer({ url: '/404' })
        const fallbackOutput = typeof fallback === 'string' ? { html: fallback } : fallback
        this.emitFile({
          type: 'asset',
          fileName: '404.html',
          source: renderTemplate(template, config.id, fallbackOutput.html, fallbackOutput.metadata),
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
          async (route) => {
            const rendered = await renderer({ url: route })
            const renderedOutput = typeof rendered === 'string' ? { html: rendered } : rendered
            return {
              route,
              html: renderTemplate(
                template,
                config.id,
                renderedOutput.html,
                renderedOutput.metadata,
              ),
            }
          },
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
