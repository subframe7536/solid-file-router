import { readFile } from 'node:fs/promises'

import { defineRouteProvider } from './provider'
import type { RouteProvider } from './provider'

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
  const filter = options.filter ?? `${pagesDir}/**/*.{jsx,tsx}`
  const prefix = `${pagesDir.replace(/^\.\//, '').replace(/\/$/, '')}/`

  return defineRouteProvider<TData>({
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
