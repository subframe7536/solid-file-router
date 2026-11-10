import { isAbsolute, resolve } from 'node:path'

import type { BaseFileSystemRouter } from 'filesystem-routing'
import { fileRoutes } from 'filesystem-routing/vite'
import { normalizePath } from 'vite'
import type { PluginOption } from 'vite'

import { VID_EXTRACT } from './const'
import { DefaultFileSystemRouter } from './convention'
import { createMdxPlugin } from './mdx/plugin'
import type { MdxOptions } from './mdx/router'
import { createSsgPlugin } from './ssg'
import type { PrerenderRoutesSource, SsgOptions } from './ssg'

export { createGlobMatcher, DefaultFileSystemRouter, routePathFromFile } from './convention'
export type { DefaultFileSystemRouterConfig } from './convention'
export type { Promisable } from './const'
export type { MdxOptions } from './mdx/router'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from './route'
export type { PrerenderRoutesSource, SsgOptions }

export interface FileRouterPluginOption<TData = unknown> {
  /**
   * The directory containing all route files, resolved against the Vite
   * root. Ignored when `router` is given.
   *
   * e.g. If your `_app.tsx` is located at `module/routes/_app.tsx`,
   * set `pagesDir` to `module/routes`.
   * @default 'src/pages'
   */
  pagesDir?: string
  /**
   * Globs matched against file paths relative to `pagesDir`. Matched files
   * are not routes (e.g. `hooks/**`, `**\/*.test.tsx`). Files under a
   * `_`-prefixed segment are already skipped by the filename convention.
   * Ignored when `router` is given.
   * @default []
   */
  ignore?: readonly string[]
  /**
   * The output file path for generated route types.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * Whether route modules are code-split into lazy chunks.
   * @default true
   */
  lazy?: boolean
  /**
   * Enable Markdown/MDX route compilation through Satteri.
   * @default false
   */
  mdx?: boolean | MdxOptions<TData>
  /**
   * SSG prerender configuration. `true` enables all defaults. Requires
   * `solid({ start: true, ssr: true })` or a custom `ssg.serverEntry`.
   */
  ssg?: boolean | SsgOptions
  /**
   * Escape hatch: a fully custom file-system router (official
   * `BaseFileSystemRouter` seam, passed through). Replaces the built-in
   * {@link DefaultFileSystemRouter} and disables `pagesDir`/`ignore`.
   */
  router?: BaseFileSystemRouter
}

/**
 * Thin preset over the official `filesystem-routing` Vite plugin: route
 * scanning, tree building, code splitting, HMR and type generation are all
 * upstream; this package adds the filename convention, MDX compilation and
 * SSG prerendering.
 */
export function fileRouter<TData = unknown>(
  options: FileRouterPluginOption<TData> = {},
): PluginOption[] {
  const mdx = options.mdx === true ? {} : options.mdx || false
  const ssg = options.ssg === true ? {} : options.ssg || false
  const extensions = ['js', 'jsx', 'ts', 'tsx', ...(mdx ? ['md', 'mdx'] : [])]
  const pagesDir = options.pagesDir ?? 'src/pages'
  const router =
    options.router ??
    new DefaultFileSystemRouter({ dir: pagesDir, extensions, ignore: options.ignore })
  return [
    {
      name: 'solid-file-router:root',
      config(config) {
        // BaseFileSystemRouter eagerly resolves `dir` against cwd at
        // construction; `pagesDir` is relative to the vite root instead.
        // `config` (not `configResolved`) because the official plugin calls
        // `router.getRoutes()` from `configEnvironment`, which runs first.
        if (!options.router && !isAbsolute(pagesDir)) {
          router.config.dir = normalizePath(resolve(config.root ?? '.', pagesDir))
        }
      },
    },
    fileRoutes({
      router,
      moduleId: VID_EXTRACT,
      types: options.output ?? 'src/routes.d.ts',
      buildInputs: ssg ? 'client' : undefined,
      codeSplitting: options.lazy === false ? false : undefined,
      optimizeDepsExclude: ['solid-file-router'],
    }),
    createMdxPlugin<TData>(mdx),
    createSsgPlugin(ssg, ssg ? () => router.routes.map((entry) => entry.path) : undefined),
  ]
}
