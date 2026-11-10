import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'

import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { hashString, PACKAGE_NAME, VID_MDX_ROUTE } from '../const'

import { compileMdx, compileMdxRouteModule } from './router'
import type { MdxOptions } from './router'

const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i

/** Prefix of virtual `$$route` modules emitted for `.md`/`.mdx` routes. */
export const MDX_ROUTE_MODULE_PREFIX = VID_MDX_ROUTE

/** Compiles Markdown route modules and serves their `$$route` virtual modules. */
export function createMdxPlugin<TData = unknown>(options: false | MdxOptions<TData>): Plugin {
  let root = ''
  const routeSources = new Map<string, string>()

  return {
    name: `${PACKAGE_NAME}:mdx`,
    apply: () => !!options,
    configResolved(config) {
      root = config.root
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
      const result = await compileMdxRouteModule(source, src, options, {
        path: src,
        sourcePath: src,
      })
      return result.code
    },
    transform: {
      order: 'pre',
      filter: { id: REG_MARKDOWN_MODULE_ID },
      async handler(code, fullId) {
        if (!options) {
          return
        }
        const sourcePath = fullId.split('?')[0]!
        const result = await compileMdx(code, sourcePath, options, {
          path: sourcePath,
          sourcePath,
        })
        return result.code
      },
    },
  }
}
