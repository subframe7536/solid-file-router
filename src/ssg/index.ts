import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Plugin } from 'vite'

import { alignKeyValue, createLogHeader, formatDuration, PACKAGE_NAME, logger } from '../const'

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

async function runPrerender(
  config: SSGConfig,
  root: string,
  outDir: string,
  ssrOutputPath: string,
) {
  const {
    routes: configRoutes = [],
    serverEntry = 'src/entry-server.tsx',
    crawl = true,
    mountId = '#app',
    timeout = 10000,
    concurrency = 4,
  } = config

  // Import combined SSR module (built by Vite's SSR environment before closeBundle fires)
  if (!existsSync(ssrOutputPath)) {
    throw new Error(`SSR build output not found at ${ssrOutputPath}`)
  }

  const combinedModule = await importModule(ssrOutputPath)
  const renderFn = combinedModule.default as
    | ((url: string) => Promise<SSGRenderResult>)
    | undefined
  if (typeof renderFn !== 'function') {
    throw new TypeError(
      `SSG server entry must default export a render function: ${serverEntry}`,
    )
  }
  const fileRoutes = combinedModule.fileRoutes as any[]

  // Collect routes
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

  // Render routes
  const template = readTemplate(outDir)
  writeFallback(outDir, template)
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

    for (const settled of results) {
      if (settled.status === 'rejected') {
        const url = batch[results.indexOf(settled)]
        const routePath = url || UNKNOWN_SSG_ROUTE_LABEL
        const reason =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        failed++
        logger.error(`  ✗ ${formatRouteLogLabel(routePath)} → Failed: ${reason}`, {
          timestamp: false,
        })
        continue
      }

      const { url, result } = (settled as PromiseFulfilledResult<any>).value
      const html = injectHTML(template, result, mountId)
      writeRoute(outDir, url, html)
      rendered++

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

  // Generate 404.html (always, for static file servers)
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

  const summaryLines: [string, any][] = [
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
}

export function ssgPlugin(ssgConfig: SSGConfig): Plugin {
  const { serverEntry = 'src/entry-server.tsx' } = ssgConfig

  // Paths derived from root (not from build.outDir) so they are stable across
  // the two configResolved calls that happen when sharedDuringBuild is true.
  let root: string
  let tempDir: string
  let ssrDir: string
  let combinedEntryPath: string
  let ssrOutputPath: string
  // Track whether we auto-generated the server entry so we can clean it up.
  let generatedEntry = false

  return {
    name: 'solid-file-router:ssg',
    apply: 'build',
    // Share a single plugin instance across all Vite build environments so that
    // the closure variables set in configResolved (e.g. generatedEntry) are
    // visible to the closeBundle handler that runs in the SSR environment.
    sharedDuringBuild: true,
    config(userConfig, { command }) {
      if (command !== 'build') {
        return null
      }
      // Register the SSR environment in the config hook (before configResolved)
      // so Vite knows to build it when the user runs `vite build --app`.
      // Paths are computed from the raw user config; configResolved recomputes
      // them from the fully resolved config (absolute root, etc.).
      const rawRoot = resolve(userConfig.root || process.cwd())
      const _tempDir = join(rawRoot, '.ssg-temp')
      const _ssrDir = join(_tempDir, 'server')
      const _combinedEntryPath = join(_tempDir, 'ssr-entry.ts')

      return {
        resolve: {
          alias: getRuntimeAlias(),
        },
        environments: {
          ssr: {
            build: {
              outDir: _ssrDir,
              rollupOptions: {
                input: _combinedEntryPath,
              },
            },
          },
        },
      }
    },
    configResolved(resolvedConfig) {
      // configResolved is called twice when sharedDuringBuild is true: once for
      // the client environment config and once for the SSR environment config
      // (which patches build.outDir to the SSR-specific value).  We intentionally
      // do NOT store outDir here to avoid picking up the SSR-patched value.
      // Instead, clientOutDir is derived at prerender time from
      // this.environment.getTopLevelConfig() inside closeBundle.
      root = resolvedConfig.root
      tempDir = join(root, '.ssg-temp')
      ssrDir = join(tempDir, 'server')
      combinedEntryPath = join(tempDir, 'ssr-entry.ts')
      ssrOutputPath = getSSRBuildOutputPath(ssrDir, combinedEntryPath)

      if (resolvedConfig.command !== 'build') {
        return
      }

      const entryPath = join(root, serverEntry)
      // Only create the default entry on the first configResolved call (when it
      // doesn't exist yet).  Subsequent calls with the SSR-patched config will
      // find the file already on disk and skip this branch, leaving generatedEntry
      // unchanged.
      if (!existsSync(entryPath)) {
        writeFileSync(
          entryPath,
          `import { renderServer } from 'virtual:router-entry'\n\nexport default renderServer()\n`,
        )
        generatedEntry = true
        logger.warn(
          'No ssg.serverEntry setup and default serverEntry path does not exist, use default code',
          { timestamp: true },
        )
      }

      // Write the combined SSR entry (re-exports render fn + fileRoutes).
      // Called idempotently on both configResolved invocations — same content.
      mkdirSync(ssrDir, { recursive: true })
      writeFileSync(combinedEntryPath, createSSREntryCode(entryPath))
    },
    async closeBundle() {
      // Only run prerendering after the SSR environment build finishes.
      // The client environment is built first (Vite's default buildApp order),
      // so its index.html is already on disk when this fires.
      if (this.environment.name !== 'ssr') {
        return
      }

      // Derive the client output directory from the top-level (unpatched) config.
      const topLevelConfig = this.environment.getTopLevelConfig()
      const clientOutDir = resolve(root, topLevelConfig.build.outDir)
      const entryPath = join(root, serverEntry)

      try {
        await runPrerender(ssgConfig, root, clientOutDir, ssrOutputPath)
      } catch (error) {
        logger.error(`SSG failed: ${error}`)
        throw error
      } finally {
        // Always clean up the temp directory and any auto-generated entry.
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true })
        }
        if (generatedEntry && existsSync(entryPath)) {
          rmSync(entryPath, { force: true })
        }
      }
    },
  }
}
