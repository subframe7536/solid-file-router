import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { glob } from 'tinyglobby'
import { build } from 'vite'
import type { AliasOptions, Plugin } from 'vite'

import { alignKeyValue, createLogHeader, formatDuration, PACKAGE_NAME, logger } from '../const'
import { clearCache } from '../utils/extract'

import { collectRoutesFromConfig, collectRoutesFromPrerender, crawlLinks } from './collect'
import { injectHTML, readTemplate, writeRoute } from './render'
import type { SSGConfig, SSGRenderResult } from './types'

const DEFAULT_SSG_ROUTE_LABEL = '/404'
const SSG_BUNDLE_PREFIX = '__solid-file-router-ssg'
const SSG_BUNDLE_FILE = `${SSG_BUNDLE_PREFIX}.js`
const SSG_ENTRY_FILE = '.solid-file-router-ssg-entry.ts'
const UNKNOWN_SSG_ROUTE_LABEL = '<unknown>'
const SSR_PROBE_CODE = '<div>solid-file-router-ssr-probe</div>'
const SSR_PROBE_ID = '/virtual/solid-file-router-ssr-probe.tsx'
const SSR_PROBE_MARKER = '_$getNextElement'

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

function mergeAlias(alias: AliasOptions | undefined): AliasOptions {
  if (Array.isArray(alias)) {
    return [...alias, getRuntimeAlias()]
  }
  return {
    ...(alias || {}),
    ...getRuntimeAlias(),
  }
}

function normalizeImportPath(id: string) {
  const normalized = id.replace(/\\/g, '/')
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

function createServerEntryCode(entryPath: string, exists: boolean) {
  if (exists) {
    return `export { fileRoutes } from 'virtual:routes'\nexport { default } from '${normalizeImportPath(entryPath)}'\n`
  }

  return `import { renderServer } from 'virtual:router-entry'
export { fileRoutes } from 'virtual:routes'
export default renderServer()
`
}

async function detectSolidSSR(plugins: readonly Plugin[]) {
  const solidPlugin = plugins.find((plugin) => plugin.name === 'solid')
  const hook = solidPlugin?.transform
  if (!hook) {
    return false
  }

  const context = {} as any

  const result =
    typeof hook === 'function'
      ? await hook.call(context, SSR_PROBE_CODE, SSR_PROBE_ID, { moduleType: 'js', ssr: false })
      : await hook.handler.call(context, SSR_PROBE_CODE, SSR_PROBE_ID, {
          moduleType: 'js',
          ssr: false,
        })

  const code = typeof result === 'string' ? result : String(result?.code || '')
  return code.includes(SSR_PROBE_MARKER)
}

async function cleanupSSRArtifacts(outDir: string) {
  const files = await glob(`${SSG_BUNDLE_PREFIX}*`, {
    cwd: outDir,
    absolute: true,
    dot: true,
  })

  for (const file of files) {
    rmSync(file, { recursive: true, force: true })
  }
}

interface SSGPluginOptions {
  createCorePlugins: () => Plugin[]
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

  let root = ''
  let outDir = ''
  let alias: AliasOptions | undefined
  let solidPlugins: Plugin[] = []
  let ssrEnabled = false

  return {
    name: 'solid-file-router:ssg',
    apply: 'build',
    async configResolved(resolvedConfig) {
      root = resolvedConfig.root
      outDir = join(root, resolvedConfig.build.outDir)
      alias = resolvedConfig.resolve.alias
      solidPlugins = resolvedConfig.plugins.filter((plugin) => plugin.name === 'solid')
      ssrEnabled = await detectSolidSSR(resolvedConfig.plugins)

      if (!ssrEnabled) {
        logger.warn(
          'SSG config was ignored because vite-plugin-solid is not configured with { ssr: true }',
          { timestamp: true },
        )
      }
    },
    async closeBundle() {
      if (!ssrEnabled) {
        return
      }

      const entryPath = join(root, serverEntry)
      const ssgEntryPath = join(root, SSG_ENTRY_FILE)

      try {
        if (!existsSync(entryPath)) {
          logger.warn(
            'No ssg.serverEntry setup and default serverEntry path not exists, use default code',
            { timestamp: true },
          )
        }

        writeFileSync(ssgEntryPath, createServerEntryCode(serverEntry, existsSync(entryPath)))

        clearCache()

        await build({
          configFile: false,
          root,
          resolve: {
            alias: mergeAlias(alias),
          },
          plugins: [...solidPlugins, ...options.createCorePlugins()],
          build: {
            ssr: ssgEntryPath,
            outDir,
            emptyOutDir: false,
            minify: false,
            rollupOptions: {
              output: {
                entryFileNames: SSG_BUNDLE_FILE,
                chunkFileNames: `${SSG_BUNDLE_PREFIX}-[name]-[hash].js`,
                assetFileNames: `${SSG_BUNDLE_PREFIX}-[name]-[hash][extname]`,
              },
            },
          },
          logLevel: 'warn',
        })

        const ssrModulePath = join(outDir, SSG_BUNDLE_FILE)
        if (!existsSync(ssrModulePath)) {
          throw new Error(`SSR build output not found at ${ssrModulePath}`)
        }

        const ssrModule = await importModule(ssrModulePath)
        const renderFn = ssrModule.default as ((url: string) => Promise<SSGRenderResult>) | undefined
        if (typeof renderFn !== 'function') {
          throw new TypeError(`SSG server entry must default export a render function: ${serverEntry}`)
        }

        const fileRoutes = ssrModule.fileRoutes as any[] | undefined

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

        const template = readTemplate(outDir)
        let rendered = 0
        let failed = 0
        const renderStart = Date.now()

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

          for (const [index, settled] of results.entries()) {
            if (settled.status === 'rejected') {
              const routePath = batch[index] || UNKNOWN_SSG_ROUTE_LABEL
              const reason =
                settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
              failed++
              logger.error(`  ✗ ${formatRouteLogLabel(routePath)} → Failed: ${reason}`, {
                timestamp: false,
              })
              continue
            }

            const { url, result } = settled.value
            const html = injectHTML(template, result, mountId)
            writeRoute(outDir, url, html)
            rendered++

            const outputPath = url === '/' ? '/index.html' : `${url}.html`
            logger.info(`  ✓ ${formatRouteLogLabel(url)} → ${outputPath}`, {
              timestamp: false,
            })

            if (crawl) {
              const newLinks = crawlLinks(result.html || result.slots?.app || '', visited)
              for (const link of newLinks) {
                visited.add(link)
                updateRouteLogWidth(link)
                queue.push(link)
              }
            }
          }
        }

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
        const summaryLines: Array<[string, string | number]> = [
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
      } catch (error) {
        logger.error(`SSG failed: ${error}`)
        throw error
      } finally {
        rmSync(ssgEntryPath, { force: true })
        await cleanupSSRArtifacts(outDir)
      }
    },
  }
}
