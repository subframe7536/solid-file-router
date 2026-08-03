import { readFile } from 'node:fs/promises'

import { defineRouteProvider } from './provider'
import type { RouteProvider } from './provider'
import { createPagesPathResolver } from './provider/pages'

export interface FsRouteProviderOptions {
  /** Glob scanned relative to the Vite root. */
  filter?: string
  /** @default 'src/pages' */
  pagesDir?: string
}

/** Creates the built-in JSX/TSX filesystem route provider. */
export function fsRouteProvider<TData = unknown>(
  options: FsRouteProviderOptions = {},
): RouteProvider<TData> {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const paths = createPagesPathResolver(pagesDir, options.filter ?? '', 'jsx,tsx')

  return defineRouteProvider<TData>({
    filter: paths.filter,
    glob: paths.glob,
    transformPath(file) {
      return { path: paths.routePath(file).replace(/\.(jsx|tsx)$/i, '.tsx') }
    },
    load({ sourcePath }) {
      return readFile(sourcePath, 'utf8')
    },
  })
}
