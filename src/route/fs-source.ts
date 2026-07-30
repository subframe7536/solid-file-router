import { readFile } from 'node:fs/promises'

import { defineRouteSource } from './source'
import type { RouteSourceProvider } from './source'

export interface FsRouteSourceOptions {
  /** Glob scanned relative to the Vite root. */
  filter?: string
  /** @default 'src/pages' */
  pagesDir?: string
}

/** Creates the built-in JSX/TSX filesystem route source. */
export function fsRouteSource<TData = unknown>(
  options: FsRouteSourceOptions = {},
): RouteSourceProvider<TData> {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const filter = options.filter ?? `${pagesDir}/**/*.{jsx,tsx}`
  const prefix = `${pagesDir.replace(/^\.\//, '').replace(/\/$/, '')}/`

  return defineRouteSource<TData>({
    filter,
    transformPath(file) {
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file
      return { path: relative.replace(/\.(jsx|tsx)$/i, '.tsx') }
    },
    load({ sourcePath }) {
      return readFile(sourcePath, 'utf8')
    },
  })
}
