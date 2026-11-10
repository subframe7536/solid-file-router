import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'

import { normalizePath } from 'vite'
import type { Plugin } from 'vite'

import { hashString, PACKAGE_NAME } from '../const'

import { compileMdx, compileMdxRouteModule } from './router'
import type { MdxOptions } from './router'

const REG_MARKDOWN_MODULE_ID = /\.(?:md|mdx)(?:\?.*)?$/i
const MDX_ROUTE_PREFIX = 'virtual:sfr-mdx-route:'

/** Prefix of virtual `$$route` modules emitted for `.md`/`.mdx` routes. */
export const MDX_ROUTE_MODULE_PREFIX = MDX_ROUTE_PREFIX

/** Compiles Markdown route modules and serves their `$$route` virtual modules. */
export function createMdxPlugin<TData = unknown>(options: false | MdxOptions<TData>): Plugin {
  let root = ''
  const routeSources = new Map<string, string>()
  const resolvedIdFor = (src: string): string =>
    `${posix.join(normalizePath(root), 'node_modules/.sfr-mdx-route')}/${hashString(src)}.tsx`

  return {
    name: `${PACKAGE_NAME}:mdx`,
    apply: () => !!options,
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      const [pathname, query] = id.split('?')
      if (!pathname?.startsWith(MDX_ROUTE_PREFIX)) {
        return
      }
      const src = pathname.slice(MDX_ROUTE_PREFIX.length)
      const resolved = resolvedIdFor(src)
      routeSources.set(resolved, src)
      return query ? `${resolved}?${query}` : resolved
    },
    async load(id) {
      if (!options) {
        return
      }
      const [pathname] = id.split('?')
      const src = routeSources.get(pathname!)
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
