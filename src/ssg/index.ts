import { existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createServer } from 'vite'
import type { Plugin, PluginOption } from 'vite'
import type { Options as SolidPluginOptions } from 'vite-plugin-solid'

import {
  alignKeyValue,
  createLogHeader,
  formatDuration,
  PACKAGE_NAME,
  logger,
  VID_EXTRACT,
} from '../const'
import { clearCache } from '../utils/extract'

import { collectRoutesFromConfig, collectRoutesFromPrerender, crawlLinks } from './collect'
import { injectHTML, readTemplate, writeRoute } from './render'
import type { SSGConfig, SSGRenderResult } from './types'

const DEFAULT_SSG_ROUTE_LABEL = '/404'
const UNKNOWN_SSG_ROUTE_LABEL = '<unknown>'

export function getSSRBuildOutputPath(outDir: string, entry: string) {
  // Always return posix-style paths for tests and downstream usage
  return join(outDir, `${parse(entry).name}.js`).replace(/\\/g, '/')
}

export function createRouteManifestEntryCode() {
  return `export { fileRoutes } from 'virtual:routes'\n`
}

export function createSolidSSROptions(options?: SolidPluginOptions): SolidPluginOptions {
  return options ? { ...options, ssr: true } : { ssr: true }
}

export function assertAllFulfilled<T = any>(
  results: Array<PromiseSettledResult<T>>,
  batch: string[],
) {
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    if (r.status !== 'fulfilled') {
      const url = batch[i]
      const reason = (r as PromiseRejectedResult).reason
      const msg = reason instanceof Error ? reason.message : String(reason)
      const err = new Error(`SSG prerender failed for ${url}: ${msg}`)
      ;(err as any).cause = reason
      throw err
    }
  }
}

const require = createRequire(import.meta.url)

function getRuntimeAlias() {
  return {
    [PACKAGE_NAME]: require.resolve(PACKAGE_NAME),
  }
}

interface SSGPluginOptions {
  createSSRPlugins: () => PluginOption[]
}

export function ssgPlugin(config: SSGConfig, options: SSGPluginOptions): Plugin {
  const {
    routes: configRoutes = [],
    serverEntry = 'src/entry-server.tsx',
    crawl = true,
    mountId = '#app',
    timeout = 10000,
    concurrency = 4,
  } = config

  let root: string
  let outDir: string

  return {
    name: 'solid-file-router:ssg',
    apply: 'build',
    configResolved(resolvedConfig) {
      root = resolvedConfig.root
      outDir = join(root, resolvedConfig.build.outDir)
    },
    async closeBundle() {
      const entryPath = join(root, serverEntry)
      if (!existsSync(entryPath)) {
        throw new Error(`SSG server entry not found: ${serverEntry}`)
      }

      try {
        clearCache()

        const ssrPlugins = options.createSSRPlugins()

        const ssrServer = await createServer({
          configFile: false,
          root,
          resolve: {
            alias: getRuntimeAlias(),
          },
          plugins: ssrPlugins,
          server: {
            middlewareMode: true,
          },
          appType: 'custom',
          logLevel: 'warn',
        })

        try {
          const ssrModule = await ssrServer.ssrLoadModule(pathToFileURL(entryPath).href)
          const routeManifestModule = await ssrServer.ssrLoadModule(VID_EXTRACT)
          const renderFn = ssrModule.default as
            | ((url: string) => Promise<SSGRenderResult>)
            | undefined
          if (typeof renderFn !== 'function') {
            throw new TypeError(
              `SSG server entry must default export a render function: ${serverEntry}`,
            )
          }
          const fileRoutes = routeManifestModule.fileRoutes as any[]

          // 3. Collect routes
          const visited = new Set<string>()
          const queue: string[] = []
          let routeLogWidth = DEFAULT_SSG_ROUTE_LABEL.length
          const updateRouteLogWidth = (route: string) => {
            routeLogWidth = Math.max(routeLogWidth, route.length)
          }
          const formatRouteLogLabel = (route: string) => route.padEnd(routeLogWidth)

          const configCollected = collectRoutesFromConfig({ routes: configRoutes }, fileRoutes)
          for (const route of configCollected) {
            if (!visited.has(route.path)) {
              visited.add(route.path)
              updateRouteLogWidth(route.path)
              queue.push(route.path)
            }
          }

          if (fileRoutes) {
            const prerenderCollected = collectRoutesFromPrerender(fileRoutes)
            for (const route of prerenderCollected) {
              if (!visited.has(route.path)) {
                visited.add(route.path)
                updateRouteLogWidth(route.path)
                queue.push(route.path)
              }
            }
          }

          if (queue.length === 0) {
            logger.warn('No routes to prerender', { timestamp: true })
            return
          }

          // 4. Render routes
          const template = readTemplate(outDir)
          let rendered = 0
          let failed = 0
          const renderStart = Date.now()

          type RenderBatchResult =
            | { status: 'fulfilled'; url: string; result: SSGRenderResult }
            | { status: 'rejected'; url: string; reason: unknown }

          const renderRoute = async (url: string): Promise<RenderBatchResult> => {
            let timer: ReturnType<typeof setTimeout> | undefined
            const timeoutPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`SSG render timeout (${timeout}ms)`)),
                timeout,
              )
            })

            try {
              const result = await Promise.race([renderFn(url), timeoutPromise])
              return { status: 'fulfilled', url, result }
            } catch (reason) {
              return { status: 'rejected', url, reason }
            } finally {
              if (timer) {
                clearTimeout(timer)
              }
            }
          }

          logger.info(`${createLogHeader('SSG Prerendering Started')}`, { timestamp: true })

          while (queue.length > 0) {
            const batch = queue.splice(0, concurrency)
            const results = await Promise.all(batch.map(renderRoute))

            for (const settled of results) {
              if (settled.status === 'rejected') {
                const routePath = settled.url || UNKNOWN_SSG_ROUTE_LABEL
                const reason =
                  settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
                failed++
                logger.error(`  ✗ ${formatRouteLogLabel(routePath)} → Failed: ${reason}`, {
                  timestamp: false,
                })
                continue
              }

              const { url, result } = settled
              const html = injectHTML(template, result, mountId)
              writeRoute(outDir, url, html)
              rendered++

              // Log individual route rendering (TanStack Start style)
              const outputPath = url === '/' ? '/index.html' : `${url}.html`
              logger.info(`  ✓ ${formatRouteLogLabel(url)} → ${outputPath}`, {
                timestamp: false,
              })

              if (crawl) {
                const newLinks = crawlLinks(result.html, visited)
                for (const link of newLinks) {
                  visited.add(link)
                  updateRouteLogWidth(link)
                  queue.push(link)
                }
              }
            }
          }

          // 5. Generate 404.html (always, for static file servers)
          try {
            const notFoundResult = await renderFn('/__ssg_not_found__')
            const notFoundHtml = injectHTML(template, notFoundResult, mountId)
            writeFileSync(join(outDir, '404.html'), notFoundHtml)
            logger.info(`  ✓ ${formatRouteLogLabel(DEFAULT_SSG_ROUTE_LABEL)} → /404.html`, {
              timestamp: false,
            })
            rendered++
          } catch {
            // No 404 route defined, skip
          }

          const totalDuration = Date.now() - renderStart

          // Build completion summary
          let summaryLines: [string, any][] = [
            ['Pages generated', rendered],
            ['Total time', formatDuration(totalDuration)],
          ]

          if (rendered > 0) {
            summaryLines.push(['Avg per page', formatDuration(totalDuration / rendered)])
          }

          if (failed > 0) {
            summaryLines.unshift(['Failed', failed])
          }

          logger.info(
            `${createLogHeader('SSG Prerendering Completed')}
${alignKeyValue(summaryLines)}`,
            { timestamp: true },
          )
        } finally {
          await ssrServer.close()
        }
      } catch (error) {
        logger.error(`SSG failed: ${error}`)
        throw error
      }
    },
  }
}
