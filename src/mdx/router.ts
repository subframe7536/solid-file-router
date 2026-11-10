import { pathToFileURL } from 'node:url'

import type { Data, MdxCompileOptions, MdxToJsResult } from 'satteri'

import type { Promisable } from '../const'

import { parseMdxFrontmatter, serializeJavaScriptValue } from './frontmatter'
import type { MdxFrontmatterBlock, MdxRouteConfig } from './frontmatter'

export interface MdxRouteDocument {
  /** Original Markdown or MDX source. */
  source: string
  /** Compiled module body without generated exports. */
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

export interface MdxLoadContext<TData = unknown> {
  /** Route-file path relative to the pages dir (extension stripped). */
  path: string
  /** Absolute source path. */
  sourcePath: string
  /** Provider-specific data (route providers only). */
  data?: TData
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
  /** Extends the generated route module without taking over MDX compilation. */
  extendLoad?: (
    document: Readonly<MdxRouteDocument>,
    context: Readonly<MdxLoadContext<TData>>,
  ) => Promisable<MdxLoadExtension | undefined>
}

/** Route configuration read from a native Markdown/MDX document's frontmatter. */
export type { MdxRouteConfig } from './frontmatter'

const REG_MDX_DEFAULT_EXPORT = /\n?export default MDXContent;\s*/
const SATTERI_PACKAGE = 'satteri'
let satteriPromise: Promise<typeof import('satteri')> | undefined

interface CompiledMdxDocument extends Omit<MdxToJsResult, 'frontmatter'> {
  frontmatter: Record<string, unknown>
  routeConfig: MdxRouteConfig
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

async function getSatteri(): Promise<typeof import('satteri')> {
  try {
    return await (satteriPromise ??= import(SATTERI_PACKAGE))
  } catch (error) {
    throw new Error(
      '[solid-file-router] MDX support requires the optional `satteri` package. Install it with `pnpm add -D satteri`.',
      { cause: error },
    )
  }
}

function getCompileOptions<TData>(
  options: MdxOptions<TData>,
  sourcePath: string,
): MdxCompileOptions {
  const { extendLoad: _extendLoad, ...compileOptions } = options
  if (compileOptions.outputFormat && compileOptions.outputFormat !== 'program') {
    throw new Error('[solid-file-router] MDX routes require Satteri outputFormat="program"')
  }

  return {
    // Solid 2 SSR calls component expressions directly, so `<_components.h1>`
    // cannot compile there — emit runtime calls through our own jsx-runtime
    // (`Dynamic`-backed) instead of JSX syntax.
    jsx: false,
    jsxImportSource: 'solid-file-router/mdx',
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
    frontmatter: parsed.data,
    routeConfig: parsed.routeConfig,
  }
}

export interface MdxModuleResult {
  code: string
  frontmatter: Record<string, unknown>
  routeConfig: MdxRouteConfig
  data: Data
}

/**
 * Compiles a Markdown/MDX document into the route-module shape:
 * `export const route` + `export const frontmatter` + default component.
 */
export async function compileMdx<TData = unknown>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
  context?: MdxLoadContext<TData>,
): Promise<MdxModuleResult> {
  const result = await compileMdxDocument(source, sourcePath, options)
  const document: MdxRouteDocument = {
    source,
    code: result.code.replace(REG_MDX_DEFAULT_EXPORT, ''),
    component: 'MDXContent',
    frontmatter: result.frontmatter,
    routeConfig: result.routeConfig,
    data: result.data,
  }
  const extension = await options.extendLoad?.(
    document,
    context ?? { path: sourcePath, sourcePath },
  )
  const routeConfig = { ...result.routeConfig, ...extension?.routeConfig }

  let moduleCode = document.code
  let component = document.component
  if (extension?.mdxContent?.trim()) {
    const runtimeName = getUniqueName(moduleCode, '__sfr_mdx_components')
    const contentName = getUniqueName(`${moduleCode}\n${extension.mdxContent}`, '__sfr_mdx_content')
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

  const code = [
    moduleCode,
    '',
    `export const route = ${serializeJavaScriptValue(routeConfig)}`,
    hasFrontmatterExport(moduleCode)
      ? ''
      : `export const frontmatter = ${serializeJavaScriptValue(result.frontmatter)}`,
    `export default ${component}`,
    '',
  ].join('\n')

  return { code, frontmatter: result.frontmatter, routeConfig, data: result.data }
}

/**
 * Compiles only the route-facing exports of a Markdown/MDX document —
 * used for the `$$route` virtual module so the manifest never eagerly
 * bundles the compiled component.
 */
export async function compileMdxRouteModule<TData = unknown>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
  context?: MdxLoadContext<TData>,
): Promise<MdxModuleResult> {
  const { code: _code, ...result } = await compileMdx(source, sourcePath, options, context)
  const code = [
    `export const route = ${serializeJavaScriptValue(result.routeConfig)}`,
    `export const frontmatter = ${serializeJavaScriptValue(result.frontmatter)}`,
    '',
  ].join('\n')
  return { ...result, code }
}
