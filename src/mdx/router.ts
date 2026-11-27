import { pathToFileURL } from 'node:url'

import type { Data, MdxCompileOptions, MdxToJsResult } from 'satteri'

import type { Promisable } from '../const'

import {
  extractMdxFrontmatterBlock,
  parseMdxFrontmatter,
  serializeJavaScriptValue,
} from './frontmatter'
import type { MdxFrontmatterBlock, MdxRouteConfig } from './frontmatter'

export interface MdxRouteInput {
  /** Original Markdown or MDX source. */
  source: string
  /** Parsed YAML frontmatter values. */
  frontmatter: Record<string, unknown>
  /** Native route configuration parsed from frontmatter. */
  routeConfig: MdxRouteConfig
}

export interface MdxRouteDocument extends MdxRouteInput {
  /** Compiled module body without generated exports. */
  code: string
  /** Default compiled content component name. */
  component: string
  /** Satteri document data collected by MDX plugins. */
  data: Data
}

export interface MdxLoadContext<TData = unknown> {
  /** Route-file path relative to the pages dir (extension stripped). */
  path: string
  /** Normalized route URL path (group segments stripped, e.g. `/guide/intro` or `/`). */
  routePath?: string
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
  /**
   * Lightweight route-metadata hook used when resolving `$$route` (and
   * inlining MDX route configs into `virtual:routes`). When provided — or when
   * `extendLoad` is omitted — `$$route` skips full MDX compilation
   * (`satteri.mdxToJs`) and runs frontmatter parsing + `extendRoute` only.
   */
  extendRoute?: (
    document: Readonly<MdxRouteInput>,
    context: Readonly<MdxLoadContext<TData>>,
  ) => Promisable<Partial<MdxRouteConfig> | undefined>
}

/** Route configuration read from a native Markdown/MDX document's frontmatter. */
export type { MdxRouteConfig } from './frontmatter'

const REG_MDX_DEFAULT_EXPORT = /\n?export default MDXContent;\s*/
const REG_FRONTMATTER_EXPORT = /\bexport\s+(?:const|let|var|function|class)\s+frontmatter\b/
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

async function getSatteri(): Promise<typeof import('satteri')> {
  try {
    return await (satteriPromise ??= import('satteri'))
  } catch (error) {
    throw new Error(
      '[solid-file-router] MDX support requires the optional `satteri` package. Install it with `pnpm add -D satteri`.',
      { cause: error },
    )
  }
}

async function compileMdxDocument<TData>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
): Promise<CompiledMdxDocument> {
  const { extendLoad: _extendLoad, extendRoute: _extendRoute, ...compileOptions } = options
  if (compileOptions.outputFormat && compileOptions.outputFormat !== 'program') {
    throw new Error('[solid-file-router] MDX routes require Satteri outputFormat="program"')
  }
  const { mdxToJs } = await getSatteri()
  const result = await mdxToJs(source, {
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
  } as const)
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

export interface CompiledMdxRouteData {
  document: MdxRouteDocument
  extension: MdxLoadExtension | undefined
  frontmatter: Record<string, unknown>
  routeConfig: MdxRouteConfig
  data: Data
}

/**
 * Compiles a Markdown/MDX document and runs `extendLoad` once, returning the
 * shared intermediate representation used for both component and `$$route` modules.
 */
export async function compileMdxRouteDocument<TData>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
  context?: MdxLoadContext<TData>,
): Promise<CompiledMdxRouteData> {
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
  return {
    document,
    extension,
    frontmatter: result.frontmatter,
    routeConfig: { ...result.routeConfig, ...extension?.routeConfig },
    data: result.data,
  }
}

/** Renders the full route component module from a precompiled MDX route document. */
export function renderMdxComponentModule(compiled: CompiledMdxRouteData): MdxModuleResult {
  const { document, extension, frontmatter, routeConfig, data } = compiled

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
    REG_FRONTMATTER_EXPORT.test(moduleCode)
      ? ''
      : `export const frontmatter = ${serializeJavaScriptValue(frontmatter)}`,
    `export default ${component}`,
    '',
  ].join('\n')

  return { code, frontmatter, routeConfig, data }
}

export interface ExtractedMdxRouteData {
  frontmatter: Record<string, unknown>
  routeConfig: MdxRouteConfig
}

/**
 * Extracts frontmatter and runs `extendRoute` without running full Satteri
 * `mdxToJs` compilation, keeping `$$route` resolution fast during startup.
 */
export async function extractMdxRouteData<TData>(
  source: string,
  sourcePath: string,
  options: MdxOptions<TData> = {},
  context?: MdxLoadContext<TData>,
): Promise<ExtractedMdxRouteData> {
  const parsed = await parseMdxFrontmatter(extractMdxFrontmatterBlock(source))
  const routeOverride = await options.extendRoute?.(
    {
      source,
      frontmatter: parsed.data,
      routeConfig: parsed.routeConfig,
    },
    context ?? { path: sourcePath, sourcePath },
  )
  return {
    frontmatter: parsed.data,
    routeConfig: { ...parsed.routeConfig, ...routeOverride },
  }
}

/** Renders only the route-facing exports from extracted or compiled MDX route data. */
export function renderMdxRouteModule(
  compiled: Pick<CompiledMdxRouteData, 'frontmatter' | 'routeConfig'> & { data?: Data },
): MdxModuleResult {
  const { frontmatter, routeConfig, data = {} } = compiled
  const code = [
    `export const route = ${serializeJavaScriptValue(routeConfig)}`,
    `export const frontmatter = ${serializeJavaScriptValue(frontmatter)}`,
    '',
  ].join('\n')
  return { code, frontmatter, routeConfig, data }
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
  return renderMdxComponentModule(
    await compileMdxRouteDocument(source, sourcePath, options, context),
  )
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
  if (options.extendRoute || !options.extendLoad) {
    return renderMdxRouteModule(await extractMdxRouteData(source, sourcePath, options, context))
  }
  return renderMdxRouteModule(await compileMdxRouteDocument(source, sourcePath, options, context))
}
