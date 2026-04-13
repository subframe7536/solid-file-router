import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, parse } from 'node:path'

import { build } from 'vite'
import type { Plugin, PluginOption } from 'vite'
import solidPlugin from 'vite-plugin-solid'

import { PACKAGE_NAME, logger } from '../const'
import { clearCache } from '../utils/extract'

import { collectRoutesFromConfig, collectRoutesFromPrerender, crawlLinks } from './collect'
import { injectHTML, readTemplate, writeRoute } from './render'
import type { SSGConfig, SSGRenderResult } from './types'

export function getSSRBuildOutputPath(outDir: string, entry: string) {
  return join(outDir, `${parse(entry).name}.js`)
}

export function createRouteManifestEntryCode() {
  return `export { fileRoutes } from 'virtual:routes'\n`
}

export function assertAllFulfilled<T = any>(
  results: Array<PromiseSettledResult<T>>,
  batch: string[],
) {
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
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

// oxlint-disable-next-line no-shadow-restricted-names
declare const globalThis: { __SOLID_FILE_ROUTER_SSG__?: boolean }

const require = createRequire(import.meta.url)

function getRuntimeAlias() {
  return {
    [PACKAGE_NAME]: require.resolve(PACKAGE_NAME),
  }
}

export function ssgPlugin(
  config: SSGConfig,
  fileRouterOptions: Record<string, any>,
  createFileRouter: (options: Record<string, any>) => Plugin[],
): Plugin {
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
      if (globalThis.__SOLID_FILE_ROUTER_SSG__) {
        return
      }
      globalThis.__SOLID_FILE_ROUTER_SSG__ = true

      let generatedEntry = false
      let entryPath: string
      let generatedRouteManifestEntry = false
      const tempDir = join(outDir, '.ssg-temp')
      const ssrServerDir = join(tempDir, 'server')
      const ssrRoutesDir = join(tempDir, 'routes')
      const routeManifestEntryPath = join(tempDir, 'route-manifest.ts')

      try {
        entryPath = join(root, serverEntry)
        if (!existsSync(entryPath)) {
          writeFileSync(
            entryPath,
            `import { renderServer } from 'virtual:router-entry'

export default async function render(url) {
  return renderServer({ url })
}
`,
          )
          generatedEntry = true
          logger.warn(
            'No ssg.serverEntry setup and default serverEntry path not exists, use default code',
            { timestamp: true },
          )
        }

        // 1. SSR build
        mkdirSync(ssrServerDir, { recursive: true })
        mkdirSync(ssrRoutesDir, { recursive: true })
        writeFileSync(routeManifestEntryPath, createRouteManifestEntryCode())
        generatedRouteManifestEntry = true

        clearCache()

        const ssrPlugins: PluginOption[] = [
          solidPlugin({ ssr: true }),
          ...createFileRouter({ ...fileRouterOptions, ssg: undefined }),
        ]

        await build({
          configFile: false,
          root,
          resolve: {
            alias: getRuntimeAlias(),
          },
          plugins: ssrPlugins,
          build: {
            ssr: entryPath,
            outDir: ssrServerDir,
            minify: false,
          },
          logLevel: 'warn',
        })

        await build({
          configFile: false,
          root,
          resolve: {
            alias: getRuntimeAlias(),
          },
          plugins: ssrPlugins,
          build: {
            ssr: routeManifestEntryPath,
            outDir: ssrRoutesDir,
            minify: false,
          },
          logLevel: 'warn',
        })

        // 2. Import SSR module
        const ssrModulePath = getSSRBuildOutputPath(ssrServerDir, serverEntry)
        if (!existsSync(ssrModulePath)) {
          throw new Error(`SSR build output not found at ${ssrModulePath}`)
        }
        const routeManifestPath = getSSRBuildOutputPath(ssrRoutesDir, routeManifestEntryPath)
        if (!existsSync(routeManifestPath)) {
          throw new Error(`Route manifest build output not found at ${routeManifestPath}`)
        }

        const ssrModule = await import(ssrModulePath)
        const routeManifestModule = await import(routeManifestPath)
        const renderFn = ssrModule.default as
          | ((url: string) => Promise<SSGRenderResult>)
          | undefined
        if (typeof renderFn !== 'function') {
          throw new Error(`SSG server entry must default export a render function: ${serverEntry}`)
        }
        const fileRoutes = routeManifestModule.fileRoutes as any[]

        // 3. Collect routes
        const visited = new Set<string>()
        const queue: string[] = []

        const configCollected = collectRoutesFromConfig({ routes: configRoutes }, fileRoutes)
        for (const route of configCollected) {
          if (!visited.has(route.path)) {
            visited.add(route.path)
            queue.push(route.path)
          }
        }

        if (fileRoutes) {
          const prerenderCollected = collectRoutesFromPrerender(fileRoutes)
          for (const route of prerenderCollected) {
            if (!visited.has(route.path)) {
              visited.add(route.path)
              queue.push(route.path)
            }
          }
        }

        if (queue.length === 0) {
          logger.warn('SSG: No routes to prerender', { timestamp: true })
          return
        }

        // 4. Render routes
        const template = readTemplate(outDir)
        let rendered = 0

        logger.info(`SSG: Prerendering routes...`, { timestamp: true })

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

          // If any render failed, abort the build by throwing.
          assertAllFulfilled(results, batch)

          for (const settled of results as PromiseFulfilledResult<any>[]) {
            const { url, result } = settled.value
            const html = injectHTML(template, result, mountId)
            writeRoute(outDir, url, html)
            rendered++

            if (crawl) {
              const newLinks = crawlLinks(result.html, visited)
              for (const link of newLinks) {
                visited.add(link)
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
          logger.info(`  /404 -> /404.html`)
          rendered++
        } catch {
          // No 404 route defined, skip
        }

        logger.info(`SSG: Completed! Generated ${rendered} page(s)`, { timestamp: true })

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
        if (generatedRouteManifestEntry && existsSync(routeManifestEntryPath)) {
          rmSync(routeManifestEntryPath, { force: true })
        }
        globalThis.__SOLID_FILE_ROUTER_SSG__ = false
      }
    },
  }
}
