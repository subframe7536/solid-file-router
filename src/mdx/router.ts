import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import type { Data, MdxCompileOptions, MdxToJsResult } from 'satteri'

import { defineRouteProvider } from '../route/provider'
import type {
  Promisable,
  RouteProvider,
  RouteProviderEntry,
  RouteProviderLoadContext,
} from '../route/provider'
import { createPagesPathResolver } from '../route/provider/pages'

import { parseMdxFrontmatter, serializeJavaScriptValue } from './frontmatter'
import type { MdxFrontmatterBlock, MdxRouteConfig } from './frontmatter'

export interface MdxRouteDocument {
  /** Original Markdown or MDX source. */
  source: string
  /** Compiled module body without the default export route wrapper. */
  code: string
  /** Default compiled content component name. */
  component: string
  /** Parsed YAML frontmatter values. */
  frontmatter: Record<string, unknown>
  /** Native route configuration parsed from frontmatter. */
  routeConfig: MdxRouteConfig
  /** Satteri document data collected by MDX plugins. */
  data: Data
}

export interface MdxLoadExtension {
  /**
   * JSX expression rendered by the generated route component.
   * The expression can reference `props`, `components`, and `MDXContent`.
   * @default 'MDXContent'
   */
  mdxContent?: string
  /** Shallow overrides for the frontmatter-derived route configuration. */
  routeConfig?: Partial<MdxRouteConfig>
}

export interface MdxOptions<TData = unknown> extends MdxCompileOptions {
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
  /**
   * Transforms the default logical route entry after extension normalization.
   * The source path is relative to the Vite root.
   */
  transformPath?: (
    sourcePath: string,
    defaultEntry: Readonly<RouteProviderEntry<TData>>,
  ) => RouteProviderEntry<TData>
  /** Extends the generated route module without taking over MDX compilation. */
  extendLoad?: (
    document: Readonly<MdxRouteDocument>,
    context: Readonly<RouteProviderLoadContext<TData>>,
  ) => Promisable<MdxLoadExtension | undefined>
}

/** Route configuration read from a native Markdown/MDX document's frontmatter. */
export type { MdxRouteConfig } from './frontmatter'

const REG_MDX = /\.(md|mdx)$/i
const REG_MDX_DEFAULT_EXPORT = /\n?export default MDXContent;\s*/
const REG_MDX_LAYOUT = /(?:^|\/)(?:_app|_layout)\.(?:md|mdx)$/i
const SATTERI_PACKAGE = 'satteri'
let satteriPromise: Promise<typeof import('satteri')> | undefined

type CompiledMdxDocument = Omit<MdxToJsResult, 'frontmatter'> & {
  frontmatter: Record<string, unknown>
  routeConfig: MdxRouteConfig
}

function getRouteConfigName(code: string): string {
  const baseName = '__sfr_mdx_route'
  let name = baseName
  let suffix = 0

  while (new RegExp(`\\b${name}\\b`).test(code)) {
    name = `${baseName}_${++suffix}`
  }

  return name
}

function getUniqueName(code: string, baseName: string): string {
  let name = baseName
  let suffix = 0

  while (new RegExp(`\\b${name}\\b`).test(code)) {
    name = `${baseName}_${++suffix}`
  }
  return name
}

function hasFrontmatterExport(code: string): boolean {
  return /\bexport\s+(?:const|let|var|function|class)\s+frontmatter\b/.test(code)
}

function addFrontmatterExport(code: string, frontmatter: Record<string, unknown>): string {
  if (hasFrontmatterExport(code)) {
    return code
  }
  return `${code}\nexport const frontmatter = ${serializeJavaScriptValue(frontmatter)}\n`
}

async function getSatteri(): Promise<typeof import('satteri')> {
  try {
    return await (satteriPromise ??= import(SATTERI_PACKAGE))
  } catch (error) {
    throw new Error(
      '[solid-file-router] MdxRouter requires the optional `satteri` package. Install it with `bun add -d satteri`.',
      { cause: error },
    )
  }
}

function getCompileOptions<TData>(
  options: MdxOptions<TData>,
  sourcePath: string,
): MdxCompileOptions {
  const {
    filter: _filter,
    pagesDir: _pagesDir,
    transformPath: _transformPath,
    extendLoad: _extendLoad,
    ...compileOptions
  } = options
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
    data: {},
    ...compileOptions,
  } as const
}

async function compileMdxDocument<TData>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
): Promise<CompiledMdxDocument> {
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
export async function compileMdx<TData = unknown>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
): Promise<Omit<CompiledMdxDocument, 'routeConfig'>> {
  const result = await compileMdxDocument(source, sourcePath, options)
  const { routeConfig: _routeConfig, ...compiled } = result
  return compiled
}

/**
 * Creates the Satteri-backed Markdown/MDX route provider.
 */
export const mdxRouteProvider = <TData = unknown>(
  options: MdxOptions<TData> = {},
): RouteProvider<TData> => {
  const pagesDir = options.pagesDir ?? 'src/pages'
  const paths = createPagesPathResolver(pagesDir, options.filter ?? '', 'md,mdx')

  return defineRouteProvider<TData>({
    filter: paths.filter,
    glob: paths.glob,
    transformPath(file) {
      const routePath = paths.routePath(file)
      if (REG_MDX_LAYOUT.test(routePath)) {
        throw new Error(
          `[solid-file-router] Markdown/MDX files cannot be used as layouts: ${file}. Use a JSX/TSX _app or _layout route instead.`,
        )
      }
      const defaultEntry = { path: routePath.replace(REG_MDX, '.tsx') }
      return options.transformPath?.(paths.sourcePath(file), defaultEntry) ?? defaultEntry
    },
    async load(context) {
      const { sourcePath } = context
      const source = await readFile(sourcePath, 'utf8')
      const result = await compileMdxDocument(source, sourcePath, options)
      const document: MdxRouteDocument = {
        source,
        code: result.code.replace(REG_MDX_DEFAULT_EXPORT, ''),
        component: 'MDXContent',
        frontmatter: result.frontmatter,
        routeConfig: result.routeConfig,
        data: result.data,
      }
      const extension = await options.extendLoad?.(document, context)
      const routeConfig = {
        ...result.routeConfig,
        ...extension?.routeConfig,
      }

      let moduleCode = document.code
      let component = document.component
      if (extension?.mdxContent?.trim()) {
        const runtimeName = getUniqueName(moduleCode, '__sfr_mdx_components')
        const contentName = getUniqueName(
          `${moduleCode}\n${extension.mdxContent}`,
          '__sfr_mdx_content',
        )
        moduleCode = [
          `import { useMDXComponents as ${runtimeName} } from 'solid-file-router/mdx'`,
          '',
          moduleCode,
          '',
          `const ${contentName} = (props) => {`,
          `  const components = ${runtimeName}()`,
          `  return ${extension.mdxContent}`,
          '}',
        ].join('\n')
        component = contentName
      }

      const routeConfigName = getRouteConfigName(moduleCode)
      return [
        "import { createRoute } from 'solid-file-router'",
        '',
        moduleCode,
        '',
        `const ${routeConfigName} = ${serializeJavaScriptValue(routeConfig)}`,
        '',
        'export default createRoute({',
        `  info: ${routeConfigName}.info,`,
        `  metadata: ${routeConfigName}.metadata,`,
        `  matchFilters: ${routeConfigName}.matchFilters,`,
        `  inherit: ${routeConfigName}.inherit,`,
        `  draft: ${routeConfigName}.draft,`,
        `  component: ${component},`,
        '})',
        '',
      ].join('\n')
    },
  })
}
