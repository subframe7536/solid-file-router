import { isAbsolute, resolve } from 'node:path'

import type { BaseFileSystemRouter } from 'filesystem-routing'
import { fileRoutes } from 'filesystem-routing/vite'
import { normalizePath } from 'vite'
import type { PluginOption } from 'vite'

import { createMdxPlugin } from './mdx/plugin'
import type { MdxOptions } from './mdx/router'
import {
  defaultConvention,
  DefaultFileSystemRouter,
  DEFAULT_IGNORES,
  flatConvention,
  routePathFromFile,
  solidStartConvention,
} from './route/convention'
import type { DefaultFileSystemRouterConfig, FileRouterConvention } from './route/convention'
import { createRouteProviderPlugin, defineRouteProvider } from './route/provider'
import type {
  Promisable,
  RouteProvider,
  RouteProviderEntry,
  RouteProviderLoadContext,
} from './route/provider'
import { createSsgPlugin } from './ssg'
import type { PrerenderRoutesSource, SsgOptions } from './ssg'

export type { MdxOptions } from './mdx/router'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from './metadata'
export {
  defaultConvention,
  DefaultFileSystemRouter,
  DEFAULT_IGNORES,
  flatConvention,
  routePathFromFile,
  solidStartConvention,
}
export type { DefaultFileSystemRouterConfig, FileRouterConvention }
export { defineRouteProvider }
export type { Promisable, RouteProvider, RouteProviderEntry, RouteProviderLoadContext }
export type { PrerenderRoutesSource, SsgOptions }

export interface FileRouterPluginOption<TData = unknown> {
  /**
   * The directory containing all route files.
   *
   * e.g. If your `_app.tsx` is located at `module/routes/_app.tsx`,
   * set `pagesDir` to `module/routes`.
   * @default 'src/pages'
   */
  pagesDir?: string
  /**
   * The output file path for generated route types.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The id the route manifest is served from.
   * @default 'virtual:routes'
   */
  moduleId?: string
  /**
   * Filename convention adapter producing the file-system router.
   * Defaults to {@link defaultConvention}; mutually exclusive with
   * `router`/`routers`.
   */
  convention?: FileRouterConvention
  /**
   * A fully custom file-system router (official seam, passed through).
   * Mutually exclusive with `convention`/`routers`.
   */
  router?: BaseFileSystemRouter
  /**
   * Per-environment file-system routers (official seam, passed through).
   * Mutually exclusive with `convention`/`router`.
   */
  routers?: Record<string, BaseFileSystemRouter>
  /**
   * Filename → neutral-path override (official `toPath` seam, only applies
   * when the convention builds the router).
   */
  toPath?: DefaultFileSystemRouterConfig['toPath']
  /**
   * Source file → manifest entry override (official `toRoute` seam, only
   * applies when the convention builds the router).
   */
  toRoute?: DefaultFileSystemRouterConfig['toRoute']
  /**
   * Extra ignore globs appended to {@link DEFAULT_IGNORES}.
   * Only applies when the convention builds the router.
   */
  ignore?: readonly string[]
  /**
   * Whether route modules are code-split into lazy chunks.
   * @default true
   */
  lazy?: boolean
  /**
   * EXPERIMENTAL: additional route providers (e.g. CMS sources) served
   * through virtual `?pick=` modules.
   */
  routeProviders?: readonly RouteProvider<TData>[]
  /**
   * Enable Markdown/MDX route compilation through Satteri.
   * @default false
   */
  mdx?: boolean | MdxOptions<TData>
  /**
   * Whether to enable verbose log.
   * @default false
   */
  verboseLog?: boolean
  /**
   * SSG prerender configuration. `true` enables all defaults. Requires
   * `solid({ start: true, ssr: true })` or a custom `ssg.serverEntry`.
   */
  ssg?: boolean | SsgOptions
}

function resolveRouter(
  options: Pick<
    FileRouterPluginOption<never>,
    'convention' | 'router' | 'routers' | 'pagesDir' | 'ignore' | 'toPath' | 'toRoute'
  >,
  extensions: string[],
): BaseFileSystemRouter | undefined {
  const supplied = [options.convention, options.router, options.routers].filter(Boolean)
  if (supplied.length > 1) {
    throw new Error(
      '[solid-file-router] `convention`, `router` and `routers` are mutually exclusive — pass exactly one.',
    )
  }
  if (options.router) {
    return options.router
  }
  if (options.routers) {
    return undefined
  }
  const convention = options.convention ?? defaultConvention
  return convention({
    dir: options.pagesDir ?? 'src/pages',
    extensions,
    ignore: options.ignore,
    toPath: options.toPath,
    toRoute: options.toRoute,
  })
}

/**
 * Thin preset over the official `filesystem-routing` Vite plugin: route
 * scanning, tree building, code splitting, HMR and type generation are all
 * upstream; this package adds filename conventions, MDX compilation, route
 * providers and SSG prerendering.
 */
export function fileRouter<TData = unknown>(
  options: FileRouterPluginOption<TData> = {},
): PluginOption[] {
  const mdx = options.mdx ?? false
  const extensions = ['js', 'jsx', 'ts', 'tsx', ...(mdx ? ['md', 'mdx'] : [])]
  const router = resolveRouter(options, extensions)
  const getRouters = (): BaseFileSystemRouter[] => [
    ...new Set(
      [router, ...Object.values(options.routers ?? {})].filter(
        (value): value is BaseFileSystemRouter => !!value,
      ),
    ),
  ]
  const rawDir = options.pagesDir ?? 'src/pages'
  return [
    {
      name: 'solid-file-router:root',
      config(config) {
        // BaseFileSystemRouter eagerly resolves `dir` against cwd at
        // construction; `pagesDir` is relative to the vite root instead.
        // `config` (not `configResolved`) because the official plugin calls
        // `router.getRoutes()` from `configEnvironment`, which runs first.
        if (router && !isAbsolute(rawDir)) {
          router.config.dir = normalizePath(resolve(config.root ?? '.', rawDir))
        }
      },
    },
    fileRoutes({
      router,
      routers: options.routers,
      moduleId: options.moduleId ?? 'virtual:routes',
      types: options.output ?? 'src/routes.d.ts',
      buildInputs: options.ssg ? 'client' : undefined,
      codeSplitting: options.lazy === false ? false : undefined,
      optimizeDepsExclude: ['solid-file-router'],
    }),
    createMdxPlugin<TData>(mdx === true ? {} : mdx || false),
    createSsgPlugin(
      options.ssg === true ? {} : options.ssg || false,
      options.ssg
        ? () =>
            getRouters().flatMap((r) => r.routes.map((entry) => entry.path))
        : undefined,
    ),
    ...(options.routeProviders?.length
      ? [createRouteProviderPlugin(options.routeProviders, getRouters)]
      : []),
  ]
}
