import type { Plugin } from 'vite'

import { createMdxPlugin } from './mdx/plugin'
import { mdxRouteSource } from './mdx/router'
import type { MdxOptions } from './mdx/router'
import type { InheritanceConfig } from './route/definition'
import { fsRouteSource } from './route/fs-source'
import { createRouterPlugin } from './route/plugin'
import type { RoutePluginContext } from './route/plugin'
import { RouteRegistry } from './route/registry'
import type { InfoTypeDefinition } from './route/route-type'
import type {
  Promisable,
  RouteSourceEntry,
  RouteSourceLoadContext,
  RouteSourceProvider,
} from './route/source'
import { defineRouteSource } from './route/source'
import { createSsgPlugin } from './ssg'
import type { SsgOptions } from './ssg'

export type { MdxOptions } from './mdx/router'
export type { InfoTypeDefinition, InlineInfoTypeDefinition } from './route/route-type'
export {
  defineRouteSource,
  type Promisable,
  type RouteSourceEntry,
  type RouteSourceLoadContext,
  type RouteSourceProvider,
}
export type { PrerenderRoutesSource } from './ssg'
export { renderTemplate } from './ssg'

export interface FileRouterPluginOption<TData = unknown> {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The directory containing all route files.
   *
   * e.g. If your `_app.tsx` is located at `module/route/_app.tsx`,
   * You need to setup to `module/routes`
   * @default 'src/pages'
   */
  pagesDir?: string
  /**
   * Additional custom route sources appended after the built-in sources.
   * @default undefined
   */
  routeSource?: RouteSourceProvider<TData> | readonly RouteSourceProvider<TData>[]
  /**
   * Enable built-in Markdown/MDX route discovery and Satteri compilation.
   * @default false
   */
  mdx?: boolean | MdxOptions
  /**
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   * @default DEFAULT_IGNORES
   */
  ignore?: string[]
  /**
   * Escape hatch that reloads the page for route content updates. Structural
   * changes may still reload automatically. Useful when route modules depend
   * on state that Vite cannot update through the normal HMR module graph.
   * @default false
   */
  reloadOnChange?: boolean
  /**
   * Whether to generate route modules with lazy imports.
   * When omitted, enabled in client builds and disabled in SSR builds.
   * @default Client builds: true; SSR builds: false
   */
  lazy?: boolean
  /**
   * Route's dts config to control Route's info type
   * @example
   * ```ts
   * {
   *   title: 'string',
   *   description: 'string',
   *   auth: {
   *     required: 'boolean',
   *     code: 'string',
   *   },
   *   tags: 'string[]',
   * }
   * ```
   */
  infoDts?: InfoTypeDefinition
  /**
   * Whether to enable verbose log
   * @default false
   */
  verboseLog?: boolean
  /**
   * Component inheritance configuration.
   *
   * Controls how loading and error components are inherited from layouts.
   *
   * @default { enabled: true }
   *
   * @example
   * // Disable inheritance globally
   * { enabled: false }
   *
   * @example
   * // Enable with custom behavior
   * {
   *   enabled: true,
   *   inheritLoading: true,
   *   inheritError: true
   * }
   */
  inheritance?: InheritanceConfig
  /**
   * Optional SSG configuration with Vite Environment API.
   * Keep `vite-plugin-solid` setup in user land while this plugin handles prerender outputs.
   */
  ssg?: SsgOptions
}

/** Default directories excluded from route discovery. */
export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

/** Creates focused Vite plugins for route discovery, transforms, MDX, and optional SSG. */
export function fileRouter<TData = unknown>(options: FileRouterPluginOption<TData> = {}): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    pagesDir = 'src/pages',
    ignore = DEFAULT_IGNORES,
    reloadOnChange = false,
    lazy,
    infoDts,
    verboseLog,
    inheritance = { enabled: true },
    routeSource,
    mdx = false,
    ssg,
  } = options
  const mdxOptions = mdx ? (mdx === true ? { pagesDir } : { pagesDir, ...mdx }) : false
  const extraSources = routeSource ? (Array.isArray(routeSource) ? routeSource : [routeSource]) : []
  const registry = new RouteRegistry<TData>({
    pagesDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: {
      enabled: inheritance.enabled ?? true,
      inheritLoading: inheritance.inheritLoading ?? true,
      inheritError: inheritance.inheritError ?? true,
    },
    routeSources: [
      fsRouteSource<TData>({ pagesDir }),
      ...(mdxOptions ? [mdxRouteSource<TData>(mdxOptions)] : []),
      ...extraSources,
    ],
  })
  const context: RoutePluginContext<TData> = {
    registry,
    lazy,
    reloadOnChange,
    verboseLog,
  }
  return [
    createRouterPlugin(context),
    createMdxPlugin(mdxOptions),
    createSsgPlugin(ssg ?? false, registry, context),
  ]
}
