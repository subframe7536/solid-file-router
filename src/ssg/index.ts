import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'vite'
import type { Plugin, PluginOption } from 'vite'
import type { Options as SolidPluginOptions } from 'vite-plugin-solid'

import { alignKeyValue, createLogHeader, formatDuration, PACKAGE_NAME, logger } from '../const'
import { clearCache } from '../utils/extract'

import { collectRoutesFromConfig, collectRoutesFromPrerender, crawlLinks } from './collect'
import { injectHTML, readTemplate, writeFallback, writeRoute } from './render'
import type { SSGConfig, SSGRenderResult } from './types'

const DEFAULT_SSG_ROUTE_LABEL = '/404'
const UNKNOWN_SSG_ROUTE_LABEL = '<unknown>'

export function getSSRBuildOutputPath(outDir: string, entry: string) {
  // Always return posix-style paths for tests and downstream usage
  return join(outDir, `${parse(entry).name}.js`).replace(/\\/g, '/')
}

export function createSSREntryCode(serverEntryAbsPath: string): string {
  const posixPath = serverEntryAbsPath.replace(/\\/g, '/')
  return `export { default } from '${posixPath}'\nexport { fileRoutes } from 'virtual:routes'\n`
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

function importModule(filePath: string) {
  return import(pathToFileURL(filePath).href)
}

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
    async writeBundle() {
      let generatedEntry = false
      let entryPath: string
      const tempDir = join(outDir, '.ssg-temp')
      const ssrDir = join(tempDir, 'server')
      const combinedEntryPath = join(tempDir, 'ssr-entry.ts')

      try {
        entryPath = join(root, serverEntry)
        if (!existsSync(entryPath)) {
          writeFileSync(
            entryPath,
            `import { renderServer } from 'virtual:router-entry'

export default renderServer()
`,
          )
          generatedEntry = true
          logger.warn(
            'No ssg.serverEntry setup and default serverEntry path not exists, use default code',
            { timestamp: true },
          )
        }

        // 1. SSR build (single combined build: render function + fileRoutes)
        mkdirSync(ssrDir, { recursive: true })
        writeFileSync(combinedEntryPath, createSSREntryCode(entryPath))

        clearCache()

        const ssrPlugins = options.createSSRPlugins()

        await build({
          configFile: false,
          root,
          resolve: {
            alias: getRuntimeAlias(),
          },
          plugins: ssrPlugins,
          build: {
            ssr: combinedEntryPath,
            outDir: ssrDir,
            minify: false,
          },
          logLevel: 'warn',
        })

        // 2. Import combined SSR module
        const combinedModulePath = getSSRBuildOutputPath(ssrDir, combinedEntryPath)
        if (!existsSync(combinedModulePath)) {
          throw new Error(`SSR build output not found at ${combinedModulePath}`)
        }

        const combinedModule = await importModule(combinedModulePath)
        const renderFn = combinedModule.default as
          | ((url: string) => Promise<SSGRenderResult>)
          | undefined
        if (typeof renderFn !== 'function') {
          throw new TypeError(
            `SSG server entry must default export a render function: ${serverEntry}`,
          )
        }
        const fileRoutes = combinedModule.fileRoutes as any[]

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
        writeFallback(outDir, template)
        let rendered = 0
        let failed = 0
        const renderStart = Date.now()
        const failedRoutes: string[] = []

        logger.info(`${createLogHeader('SSG Prerendering Started')}`, { timestamp: true })

        while (queue.length > 0) {
          const batch = queue.splice(0, concurrency)
          const results = await Promise.allSettled(
            batch.map(async (url) => {
              let timer: ReturnType<typeof setTimeout>
              const timeoutPromise = new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error(`SSG render timeout (${timeout}ms)`)),
                  timeout,
                )
              })
              try {
                const result = await Promise.race([renderFn(url), timeoutPromise])
                return { url, result }
              } finally {
                clearTimeout(timer!)
              }
            }),
          )

          for (const settled of results) {
            if (settled.status === 'rejected') {
              const url = batch[results.indexOf(settled)]
              const routePath = url || UNKNOWN_SSG_ROUTE_LABEL
              const reason =
                settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
              failed++
              failedRoutes.push(routePath)
              logger.error(`  ✗ ${formatRouteLogLabel(routePath)} → Failed: ${reason}`, {
                timestamp: false,
              })
              continue
            }

            const { url, result } = (settled as PromiseFulfilledResult<any>).value
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

        // 6. Cleanup
        rmSync(tempDir, { recursive: true, force: true })
        if (generatedEntry) {
          rmSync(entryPath, { force: true })
        }
      } catch (error) {
        logger.error(`SSG failed: ${error}`)
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true })
        }
        throw error
      } finally {
        if (generatedEntry && existsSync(entryPath!)) {
          rmSync(entryPath!, { force: true })
        }
      }
    },
  }
}
