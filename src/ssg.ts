import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { runPrerender } from 'prerender-crawler'
import type { PrerenderOptions } from 'prerender-crawler'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { logger } from './const'
import { staticPathsOf } from './route'

export { staticPathsOf }

export type PrerenderRoutesSource =
  | readonly string[]
  | ((routes: readonly string[]) => readonly string[] | Promise<readonly string[]>)

/**
 * SSG configuration: the seed source and server entry are this package's own
 * options; every other field is passed through to the official
 * `prerender-crawler` engine (`crawlLinks`, `filter`, `retries`,
 * `integrations`, `emitPages`, ...). `autoSubfolderIndex` is fixed to keep the
 * flat `/x` → `x.html` naming convention the preview fallback serves.
 */
export interface SsgOptions extends Omit<PrerenderOptions, 'pages' | 'autoSubfolderIndex'> {
  /**
   * Routes to prerender. Defaults to all static manifest routes (no `:param`
   * or `*splat` segments); discovered links still extend the crawl unless
   * `crawlLinks` is disabled.
   */
  routes?: PrerenderRoutesSource
  /**
   * Maximum concurrent prerenders.
   * @default 4
   */
  concurrency?: number
  /**
   * Custom server entry for non-start-mode setups. Must export a
   * `(request: Request) => Promise<Response | string>` handler.
   */
  serverEntry?: string
  /**
   * Static output directory.
   * @default 'dist/client'
   */
  outDir?: string
}

type RequestHandler = (request: Request) => Promise<Response | string>

function assertRoutePath(route: string): void {
  if (!route.startsWith('/')) {
    throw new Error(`[solid-file-router] Invalid prerender route "${route}" — must start with /`)
  }
}

/** `/` → `index.html`, `/x` → `x.html`, `/x/` → `x/index.html`. */
export function getPrerenderAssetFileName(route: string): string {
  assertRoutePath(route)
  if (route === '/') {
    return 'index.html'
  }
  if (route.endsWith('/')) {
    return `${route.slice(1)}index.html`
  }
  return `${route.slice(1)}.html`
}

export function normalizeRoutePath(route: string): string {
  assertRoutePath(route)
  return route.length > 1 ? route.replace(/\/+$/, '') || '/' : route
}

async function resolveHandler(options: SsgOptions, outDir: string): Promise<RequestHandler> {
  const entry = options.serverEntry ?? join(dirname(outDir), 'server/server.js')
  const specifier = `${pathToFileURL(entry).href}?t=${Date.now()}`
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    handleRequest?: RequestHandler
    default?: { fetch?: RequestHandler }
  }
  const handler = mod.handleRequest ?? mod.default?.fetch
  if (!handler) {
    throw new Error(
      `[solid-file-router] Cannot find a request handler at ${entry}. ` +
        'Enable `solid({ start: true, ssr: true })` or set `ssg.serverEntry`.',
    )
  }
  return handler
}

interface PreviewRequest {
  url?: string
  headers: Record<string, string | string[] | undefined>
}

interface PreviewResponse {
  setHeader: (name: string, value: string) => void
  statusCode: number
  end: (body?: string) => void
}

/** Preview fallback: serves prerendered pages and `404.html` for misses. */
export function createPreviewFallbackMiddleware(
  outDir: string,
): (req: PreviewRequest, res: PreviewResponse, next: () => void) => Promise<void> {
  return async (req, res, next) => {
    const acceptsHtml = String(req.headers.accept ?? '').includes('text/html')
    if (!acceptsHtml) {
      return next()
    }
    const route = req.url?.split('?')[0] || '/'
    const file = join(outDir, getPrerenderAssetFileName(route))
    try {
      const html = await readFile(file, 'utf8')
      res.setHeader('content-type', 'text/html')
      res.end(html)
    } catch {
      /* fall through to 404 */
    }
    try {
      const html = await readFile(join(outDir, '404.html'), 'utf8')
      res.setHeader('content-type', 'text/html')
      res.statusCode = 404
      res.end(html)
    } catch {
      return next()
    }
  }
}

/**
 * SSG prerenderer over the official `prerender-crawler` engine: seeds the
 * manifest's static routes, dispatches through the start handler
 * (`handleRequest`) in-process, and lets the crawl discover linked pages.
 */
export function createSsgPlugin(
  options: SsgOptions | false | undefined,
  getRoutes?: () => readonly string[],
): Plugin {
  let root = ''
  let outDir = ''
  let hasSsrEnv = false
  return {
    name: 'solid-file-router:ssg',
    // `closeBundle` only fires during build; `configurePreviewServer` only
    // during preview — no command gating needed beyond `ssg` being set.
    apply: () => !!options,
    configResolved(config) {
      root = config.root
      outDir = resolve(root, (options && options.outDir) || 'dist/client')
      hasSsrEnv = 'ssr' in (config.environments ?? {})
    },
    async closeBundle() {
      if (!options) {
        return
      }
      // run after the server bundle exists: on the ssr environment when start
      // mode produced one, otherwise on the client environment
      if (hasSsrEnv ? this.environment.name !== 'ssr' : this.environment.name !== 'client') {
        return
      }
      const manifestPaths = getRoutes?.() ?? []
      let routes = staticPathsOf(manifestPaths)
      if (options.routes !== undefined) {
        const provided =
          typeof options.routes === 'function' ? await options.routes(routes) : options.routes
        routes = [...provided]
      }
      if (!routes.some((route) => route.endsWith('/404'))) {
        routes.push('/404')
      }
      const handler = await resolveHandler(options, outDir)
      const {
        routes: _routes,
        concurrency,
        serverEntry: _serverEntry,
        outDir: _outDir,
        ...engineOptions
      } = options
      const result = await runPrerender({
        ...engineOptions,
        transport: {
          fetch: async (request) => {
            const response = await handler(request)
            return typeof response === 'string'
              ? new Response(response, { headers: { 'content-type': 'text/html' } })
              : response
          },
        },
        outDir,
        pages: routes.map(normalizeRoutePath),
        concurrency: concurrency ?? 4,
        autoSubfolderIndex: false,
      })
      const emitted = result.pages.filter((page) => page.emitted).length
      logger.info(`prerendered ${emitted} routes to ${normalizePath(outDir)}`)
      if (result.skipped.length > 0) {
        logger.warn(
          `skipped ${result.skipped.length} routes: ${result.skipped.map((page) => page.path).join(', ')}`,
        )
      }
    },
    configurePreviewServer(server) {
      if (!options) {
        return
      }
      // Register pre-internal so the fallback wins over vite's own SPA
      // fallback — an SSG preview must serve prerendered files and real 404s.
      server.middlewares.use(createPreviewFallbackMiddleware(outDir) as any)
    },
  }
}
