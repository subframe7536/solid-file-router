import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import type { MdxCompileOptions } from 'satteri'

import { defineRouteProvider } from '../route/provider'
import type { RouteProvider } from '../route/provider'

import { parseMdxFrontmatter, serializeJavaScriptValue } from './frontmatter'
import type { MdxFrontmatterBlock } from './frontmatter'

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

/** Route configuration read from a native Markdown/MDX document's frontmatter. */
export type { MdxRouteConfig } from './frontmatter'

const REG_MDX = /\.(md|mdx)$/i
const REG_MDX_DEFAULT_EXPORT = /\n?export default MDXContent;\s*/
const REG_MDX_LAYOUT = /(?:^|\/)(?:_app|_layout)\.(?:md|mdx)$/i
const SATTERI_PACKAGE = 'satteri'
let satteriPromise: Promise<typeof import('satteri')> | undefined

function getRouteConfigName(code: string) {
  const baseName = '__sfr_mdx_route'
  let name = baseName
  let suffix = 0

  while (new RegExp(`\\b${name}\\b`).test(code)) {
    name = `${baseName}_${++suffix}`
  }

  return name
}

function hasFrontmatterExport(code: string) {
  return /\bexport\s+(?:const|let|var|function|class)\s+frontmatter\b/.test(code)
}

function addFrontmatterExport(code: string, frontmatter: Record<string, unknown>) {
  if (hasFrontmatterExport(code)) {
    return code
  }
  return `${code}\nexport const frontmatter = ${serializeJavaScriptValue(frontmatter)}\n`
}

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

function getCompileOptions(options: MdxOptions, sourcePath: string) {
  const { filter: _filter, pagesDir: _pagesDir, ...compileOptions } = options
  if (compileOptions.outputFormat && compileOptions.outputFormat !== 'program') {
    throw new Error(
      '[solid-file-router] MdxRouter requires Satteri outputFormat="program" for route modules',
    )
  }

  return {
    jsx: true,
    providerImportSource: 'solid-file-router/mdx',
    elementAttributeNameCase: 'html',
    stylePropertyNameCase: 'css',
    fileURL: pathToFileURL(sourcePath),
    ...compileOptions,
  } as const
}

async function compileMdxDocument(source: string, sourcePath: string, options: MdxOptions = {}) {
  const { mdxToJs } = await getSatteri()
  const result = await mdxToJs(source, getCompileOptions(options, sourcePath))
  const parsed = await parseMdxFrontmatter(
    (result.frontmatter as MdxFrontmatterBlock | null | undefined) ?? null,
  )
  return {
    ...result,
    code: addFrontmatterExport(result.code, parsed.data),
    frontmatter: parsed.data,
    routeConfig: parsed.routeConfig,
  }
}

/** Compiles an MDX document for direct consumption by Vite. */
export async function compileMdx(source: string, sourcePath: string, options: MdxOptions = {}) {
  const result = await compileMdxDocument(source, sourcePath, options)
  const { routeConfig: _routeConfig, ...compiled } = result
  return compiled
}

/**
 * Creates the Satteri-backed Markdown/MDX route provider.
 */
export const mdxRouteProvider = <TData = unknown>(
  options: MdxOptions = {},
): RouteProvider<TData> => {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const filter = options.filter ?? `${pagesDir}/**/*.{md,mdx}`
  const prefix = `${pagesDir.replace(/^\.\//, '').replace(/\/$/, '')}/`

  return defineRouteProvider<TData>({
    filter,
    transformPath(file) {
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file
      if (REG_MDX_LAYOUT.test(relative)) {
        throw new Error(
          `[solid-file-router] Markdown/MDX files cannot be used as layouts: ${file}. Use a JSX/TSX _app or _layout route instead.`,
        )
      }
      return { path: relative.replace(REG_MDX, '.tsx') }
    },
    async load({ sourcePath }) {
      const source = await readFile(sourcePath, 'utf8')
      const result = await compileMdxDocument(source, sourcePath, options)

      const routeConfigName = getRouteConfigName(result.code)
      return [
        "import { createRoute } from 'solid-file-router'",
        '',
        result.code.replace(REG_MDX_DEFAULT_EXPORT, ''),
        '',
        `const ${routeConfigName} = ${serializeJavaScriptValue(result.routeConfig)}`,
        '',
        'export default createRoute({',
        `  info: ${routeConfigName}.info,`,
        `  matchFilters: ${routeConfigName}.matchFilters,`,
        `  inherit: ${routeConfigName}.inherit,`,
        `  draft: ${routeConfigName}.draft,`,
        '  component: MDXContent,',
        '})',
        '',
      ].join('\n')
    },
  })
}
