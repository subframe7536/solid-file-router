import { relative, resolve } from 'node:path'

import { normalizePath } from 'vite'

import type { RouteProviderGlob } from './contract'

export interface PagesPathResolver {
  filter: string
  glob: RouteProviderGlob
  routePath: (file: string) => string
  sourcePath: (file: string) => string
}

function stripLeadingRelativeSegments(value: string): string {
  return value.replace(/^(?:\.\/)+/, '')
}

function isWithinRoot(relativePath: string): boolean {
  return relativePath !== '..' && !relativePath.startsWith('../')
}

export function createPagesPathResolver(
  pagesDir: string,
  filter: string,
  extensions: string,
): PagesPathResolver {
  const normalizedPagesDir = normalizePath(pagesDir).replace(/\/+$/g, '')
  const normalizedFilter = filter.trim() ? normalizePath(filter) : ''
  const defaultFilter = normalizePath(`${normalizedPagesDir}/**/*.{${extensions}}`)
  let root = ''
  let pagesRoot = ''

  function getRootRelativePath(file: string): string {
    const resolvedFile = root ? resolve(root, file) : file
    if (!root) {
      return normalizePath(file)
    }
    return normalizePath(relative(root, resolvedFile))
  }

  function getPagesRelativePath(file: string): string | undefined {
    if (!pagesRoot) {
      const normalizedFile = normalizePath(file)
      const prefix = `${stripLeadingRelativeSegments(normalizedPagesDir)}/`
      return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : undefined
    }
    const relativePath = normalizePath(relative(pagesRoot, resolve(root, file)))
    return isWithinRoot(relativePath) ? relativePath : undefined
  }

  return {
    filter: normalizedFilter || defaultFilter,
    async glob(globFn, pattern, rootDir) {
      root = normalizePath(rootDir)
      pagesRoot = normalizePath(resolve(rootDir, pagesDir))
      return globFn(normalizePath(pattern), { cwd: rootDir, absolute: true })
    },
    routePath(file) {
      return getPagesRelativePath(file) ?? getRootRelativePath(file)
    },
    sourcePath(file) {
      return getRootRelativePath(file)
    },
  }
}
