import { readFile } from 'node:fs/promises'
import { posix, relative } from 'node:path'

import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { hashString, PACKAGE_NAME, VID_MDX_ROUTE } from '../const'

import { compileMdxRouteDocument, renderMdxComponentModule, renderMdxRouteModule } from './router'
import type { CompiledMdxRouteData, MdxLoadContext, MdxOptions } from './router'

const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i

/** Prefix of virtual `$$route` modules emitted for `.md`/`.mdx` routes. */
export const MDX_ROUTE_MODULE_PREFIX = VID_MDX_ROUTE

export type MdxContextResolver = (sourcePath: string) => {
  path?: string
  routePath?: string
}

/** Compiles Markdown route modules and serves their `$$route` virtual modules. */
export function createMdxPlugin<TData = unknown>(
  options: false | MdxOptions<TData>,
  resolveContext?: MdxContextResolver,
): Plugin {
  let root = ''
  const routeSources = new Map<string, string>()
  const cache = new Map<string, { source: string; promise: Promise<CompiledMdxRouteData> }>()

  function compileCached(source: string, rawSourcePath: string): Promise<CompiledMdxRouteData> {
    const sourcePath = normalizePath(rawSourcePath)
    const cached = cache.get(sourcePath)
    if (cached && cached.source === source) {
      return cached.promise
    }
    const resolved = resolveContext?.(sourcePath)
    const fallbackPath = root
      ? normalizePath(relative(root, sourcePath)).replace(/\.[^./]+$/, '')
      : sourcePath
    const context: MdxLoadContext<TData> = {
      path: resolved?.path ?? fallbackPath,
      ...(resolved?.routePath !== undefined ? { routePath: resolved.routePath } : {}),
      sourcePath,
    }
    const promise = compileMdxRouteDocument(
      source,
      sourcePath,
      options as MdxOptions<TData>,
      context,
    ).catch((error) => {
      if (cache.get(sourcePath)?.promise === promise) {
        cache.delete(sourcePath)
      }
      throw error
    })
    cache.set(sourcePath, { source, promise })
    return promise
  }

  return {
    name: `${PACKAGE_NAME}:mdx`,
    apply: () => !!options,
    configResolved(config) {
      root = config.root
    },
    handleHotUpdate({ file }) {
      cache.delete(normalizePath(file))
    },
    resolveId(id) {
      const [pathname, query] = id.split('?')
      if (!pathname?.startsWith(VID_MDX_ROUTE)) {
        return
      }
      const src = pathname.slice(VID_MDX_ROUTE.length)
      const resolved = `${posix.join(normalizePath(root), 'node_modules/.sfr-mdx-route')}/${hashString(src)}.tsx`
      routeSources.set(resolved, src)
      return query ? `${resolved}?${query}` : resolved
    },
    async load(id) {
      if (!options) {
        return
      }
      const src = routeSources.get(id.split('?')[0]!)
      if (src === undefined) {
        return
      }
      const source = await readFile(src, 'utf8')
      const compiled = await compileCached(source, src)
      return renderMdxRouteModule(compiled).code
    },
    transform: {
      order: 'pre',
      filter: { id: REG_MARKDOWN_MODULE_ID },
      async handler(code, fullId) {
        if (!options) {
          return
        }
        const sourcePath = fullId.split('?')[0]!
        const compiled = await compileCached(code, sourcePath)
        return renderMdxComponentModule(compiled).code
      },
    },
  }
}
