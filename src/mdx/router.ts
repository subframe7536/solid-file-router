import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import type { MdxCompileOptions } from 'satteri'

import { defineRouteSource } from '../utils/source'
import type { RouteSourceProvider } from '../utils/source'

export interface MdxOptions extends MdxCompileOptions {
  /**
   * Glob used to discover Markdown and MDX route files.
   * @default Derived from `pagesDir` for Markdown and MDX files.
   */
  filter?: string
  /**
   * Directory used by the default filter, inherit from `FileRouterPluginOption.pagesDir` by default
   * @default 'src/pages'
   */
  pagesDir?: string
}

const REG_MDX = /\.(md|mdx)$/i
const REG_MDX_DEFAULT_EXPORT = /\n?export default MDXContent;\s*$/
const SATTERI_PACKAGE = 'satteri'
let satteriPromise: Promise<typeof import('satteri')> | undefined

async function getSatteri() {
  try {
    return await (satteriPromise ??= import(SATTERI_PACKAGE))
  } catch (error) {
    throw new Error(
      '[solid-file-router] MdxRouter requires the optional `satteri` package. Install it with `bun add -d satteri`.',
      { cause: error },
    )
  }
}

/**
 * Creates the Satteri-backed Markdown/MDX route source.
 */
export const MdxRouteSource = <TData = unknown>(
  options: MdxOptions = {},
): RouteSourceProvider<TData> => {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const filter = options.filter ?? `${pagesDir}/**/*.{md,mdx}`
  const prefix = `${pagesDir.replace(/^\.\//, '').replace(/\/$/, '')}/`

  return defineRouteSource<TData>({
    filter,
    transformPath(file) {
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file
      return { path: relative.replace(REG_MDX, '.tsx') }
    },
    async load({ sourcePath }) {
      const source = await readFile(sourcePath, 'utf8')
      const { mdxToJs } = await getSatteri()
      const { filter: _filter, pagesDir: _pagesDir, ...compileOptions } = options
      if (compileOptions.outputFormat && compileOptions.outputFormat !== 'program') {
        throw new Error(
          '[solid-file-router] MdxRouter requires Satteri outputFormat="program" for route modules',
        )
      }
      const result = await mdxToJs(source, {
        jsx: true,
        providerImportSource: 'solid-file-router/mdx',
        elementAttributeNameCase: 'html',
        stylePropertyNameCase: 'css',
        fileURL: pathToFileURL(sourcePath),
        ...compileOptions,
      })

      return [
        "import { createRoute } from 'solid-file-router'",
        '',
        result.code.replace(REG_MDX_DEFAULT_EXPORT, ''),
        '',
        'export default createRoute({',
        '  component: MDXContent,',
        '})',
        '',
      ].join('\n')
    },
  })
}
