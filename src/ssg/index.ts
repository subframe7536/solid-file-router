import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { logger } from '../const'

export type PrerenderRoutesSource =
  | readonly string[]
  | ((routes: readonly string[]) => readonly string[] | Promise<readonly string[]>)

export interface SsgOptions {
  /**
   * Routes to prerender. Defaults to all static manifest routes (no `:param`
   * or `*splat` segments).
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

const REG_DYNAMIC_SEGMENT = /[:*()]/
const REG_GROUP_SEGMENT = /^\([^/]+\)$/

/** `/` → `index.html`, `/x` → `x.html`, `/x/` → `x/index.html`. */
export function getPrerenderAssetFileName(route: string): string {
  if (!route.startsWith('/')) {
    throw new Error(`[solid-file-router] Invalid prerender route "${route}" — must start with /`)
  }
  if (route === '/') {
    return 'index.html'
  }
  if (route.endsWith('/')) {
    return `${route.slice(1)}index.html`
  }
  return `${route.slice(1)}.html`
}

export function normalizeRoutePath(route: string): string {
  if (!route.startsWith('/')) {
    throw new Error(`[solid-file-router] Invalid prerender route "${route}" — must start with /`)
  }
  return route.length > 1 ? route.replace(/\/+$/, '') || '/' : route
}

/** Strips `(group)` segments and keeps only static paths. */
export function staticPathsOf(manifestPaths: readonly string[]): string[] {
  const paths = new Set<string>()
  for (const manifestPath of manifestPaths) {
    const path = manifestPath
      .split('/')
      .filter((segment) => !REG_GROUP_SEGMENT.test(segment))
      .join('/')
    if (REG_DYNAMIC_SEGMENT.test(path)) {
      continue
    }
    paths.add(path === '' ? '/' : path.endsWith('/') ? path : path)
  }
  return [...paths].sort()
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item)
      }
    }),
  )
}

async function resolveHandler(options: SsgOptions, outDir: string): Promise<RequestHandler> {
  const entry =
    options.serverEntry ?? join(dirname(outDir), 'server/server.js')
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

/** Preview fallback: serves prerendered pages and `404.html` for misses. */
export function createPreviewFallbackMiddleware(outDir: string): (req: { url?: string; headers: Record<string, string | string[] | undefined> }, res: { setHeader: (name: string, value: string) => void; statusCode: number; end: (body?: string) => void }, next: () => void) => Promise<void> {
  return async (
    req: { url?: string; headers: Record<string, string | string[] | undefined> },
    res: {
      setHeader: (name: string, value: string) => void
      statusCode: number
      end: (body?: string) => void
    },
    next: () => void,
  ) => {
    const url = req.url ?? '/'
    const acceptsHtml = String(req.headers.accept ?? '').includes('text/html')
    if (!acceptsHtml) {
      return next()
    }
    const route = url.split('?')[0] ?? '/'
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
 * Thin SSG prerenderer: walks the manifest's static routes through the start
 * handler (`handleRequest`) and writes one HTML file per route.
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
    apply: (_, env) => env.command === 'build' && !!options,
    configResolved(config) {
      root = config.root
      outDir = resolve(root, options && options.outDir ? options.outDir : 'dist/client')
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
      if (!routes.includes('/404') && !routes.some((route) => route.endsWith('/404'))) {
        routes.push('/404')
      }
      const handler = await resolveHandler(options, outDir)
      let emitted = 0
      await mapWithConcurrency(routes, options.concurrency ?? 4, async (route) => {
        const normalized = normalizeRoutePath(route)
        const response = await handler(new Request(`http://local${normalized}`))
        const html = typeof response === 'string' ? response : await response.text()
        const file = join(outDir, getPrerenderAssetFileName(normalized))
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, html)
        emitted++
      })
      logger.info(`prerendered ${emitted} routes to ${normalizePath(outDir)}`)
    },
    configurePreviewServer(server) {
      if (!options) {
        return
      }
      return () => {
        server.middlewares.use(createPreviewFallbackMiddleware(outDir) as any)
      }
    },
  }
}
