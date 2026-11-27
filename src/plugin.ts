import { isAbsolute, resolve } from 'node:path'

import { normalizePath } from 'vite'
import type { PluginOption } from 'vite'

import { PACKAGE_NAME, VID_EXTRACT } from './const'
import { DefaultFileSystemRouter } from './convention'
import { CompositeFileSystemRouter, fileRoutes, stripRouteGroups } from './fs'
import type { BaseFileSystemRouter, EagerRouteMatcher } from './fs'
import { createMdxIntegration } from './mdx/plugin'
import type { MdxOptions } from './mdx/router'
import { createSsgPlugin } from './ssg'
import type { PrerenderRoutesSource, SsgOptions } from './ssg'

export { createGlobMatcher, DefaultFileSystemRouter, routePathFromFile } from './convention'
export {
  BaseFileSystemRouter,
  CompositeFileSystemRouter,
  PageFileSystemRouter,
  cleanPath,
  buildRouteTree,
} from './fs'
export type { DefaultFileSystemRouterConfig } from './convention'
export type { Promisable } from './const'
export type { EagerRouteMatcher } from './fs'
export type {
  MdxLoadContext,
  MdxLoadExtension,
  MdxOptions,
  MdxRouteDocument,
  MdxRouteInput,
} from './mdx/router'
export type { RouteMetadata, RouteMetaTag, RouteMetadataLink } from './route'
export type { PrerenderRoutesSource, SsgOptions }

export interface PagesDirConfig {
  /** Route directory, resolved against the Vite root when relative. */
  dir: string
  /** Override file extensions scanned in this directory. */
  extensions?: Array<string>
  /** Override ignore globs for this directory. Defaults to top-level `ignore`. */
  ignore?: ReadonlyArray<string>
}

export type PagesDirOption = string | PagesDirConfig | ReadonlyArray<string | PagesDirConfig>

export interface FileRouterPluginOption<TData = unknown> {
  /**
   * The directory (or directories) containing route files, resolved against
   * the Vite root. Ignored when `router` is given.
   *
   * e.g. If your `_app.tsx` is located at `module/routes/_app.tsx`,
   * set `pagesDir` to `module/routes`. Pass an array of strings or
   * `{ dir, extensions?, ignore? }` entries to combine multiple route trees.
   * @default 'src/pages'
   */
  pagesDir?: PagesDirOption
  /**
   * Globs matched against file paths relative to `pagesDir`. Matched files
   * are not routes (e.g. `hooks/**`, `**\/*.test.tsx`). Files under a
   * `_`-prefixed segment are already skipped by the filename convention.
   * Ignored when `router` is given.
   * @default []
   */
  ignore?: ReadonlyArray<string>
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
   * Routes whose `$component` should be imported eagerly even when `lazy` is
   * enabled (for example `['/(app)', '/']` or `['/']` to avoid an initial
   * dynamic import waterfall). Accepts manifest/group-stripped paths or a
   * predicate over each manifest entry.
   */
  eager?: EagerRouteMatcher
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

function normalizePagesDirs(pagesDir: PagesDirOption | undefined): Array<PagesDirConfig> {
  if (pagesDir === undefined) {
    return [{ dir: 'src/pages' }]
  }
  const list = Array.isArray(pagesDir) ? pagesDir : [pagesDir]
  return list.map((entry) => (typeof entry === 'string' ? { dir: entry } : entry))
}

function normalizeRoutePath(manifestPath: string): string {
  const stripped = stripRouteGroups(manifestPath)
  return stripped.length > 1 ? stripped.replace(/\/+$/, '') || '/' : stripped
}

/**
 * Vite plugin preset for solid-file-router: provides built-in route scanning,
 * tree building, code splitting, HMR, type generation, filename conventions,
 * MDX compilation, and SSG prerendering.
 */
export function fileRouter<TData = unknown>(
  options: FileRouterPluginOption<TData> = {},
): Array<PluginOption> {
  const mdx = options.mdx === true ? {} : options.mdx || false
  const ssg = options.ssg === true ? {} : options.ssg || false
  const ssgEnabled = ssg !== false && ssg.enable !== false
  const extensions = ['js', 'jsx', 'ts', 'tsx', ...(mdx ? ['md', 'mdx'] : [])]

  const managedRouters: Array<{ router: DefaultFileSystemRouter; dir: string }> = []
  let router: BaseFileSystemRouter
  if (options.router) {
    router = options.router
  } else {
    const entries = normalizePagesDirs(options.pagesDir)
    const children = entries.map((entry) => {
      const child = new DefaultFileSystemRouter({
        dir: entry.dir,
        extensions: entry.extensions ?? extensions,
        ignore: entry.ignore ?? options.ignore,
      })
      managedRouters.push({ router: child, dir: entry.dir })
      return child
    })
    const [firstChild] = children
    router =
      children.length === 1 && firstChild ? firstChild : new CompositeFileSystemRouter(children)
  }

  const mdxIntegration = createMdxIntegration<TData>(mdx, (sourcePath) => {
    const path = router.relativePath(sourcePath)
    const manifestPath = router.toPath(sourcePath)
    const routePath = manifestPath !== undefined ? normalizeRoutePath(manifestPath) : undefined
    return { path, routePath }
  })

  return [
    {
      name: 'solid-file-router:root',
      config(config) {
        // BaseFileSystemRouter eagerly resolves `dir` against cwd at
        // construction; `pagesDir` is relative to the vite root instead.
        // `config` (not `configResolved`) because `fileRoutes` calls
        // `router.getRoutes()` from `configEnvironment`, which runs first.
        for (const item of managedRouters) {
          if (!isAbsolute(item.dir)) {
            item.router.config.dir = normalizePath(resolve(config.root ?? '.', item.dir))
          }
        }
      },
      configEnvironment(name, config, env) {
        const isServer = (config.consumer ?? (name === 'client' ? 'client' : 'server')) === 'server'
        if (!isServer) {
          return
        }
        return {
          resolve: {
            // Server bundles import `virtual:routes` through solid-file-router;
            // externalizing it leaves an unresolvable virtual specifier.
            noExternal: [PACKAGE_NAME],
          },
          ...(ssgEnabled && env.command === 'build' && name === 'ssr'
            ? {
                build: {
                  rolldownOptions: {
                    output: {
                      // SSG's `resolveHandler` imports `server.js?t=...`. Disabling
                      // code splitting prevents lazy chunks from back-importing
                      // `../server.js` and duplicating shared runtime singletons.
                      codeSplitting: false,
                    },
                  },
                },
              }
            : {}),
        }
      },
    },
    fileRoutes({
      router,
      moduleId: VID_EXTRACT,
      types: options.output ?? 'src/routes.d.ts',
      buildInputs: ssgEnabled ? 'client' : undefined,
      codeSplitting: options.lazy === false ? false : undefined,
      eager: options.eager,
      optimizeDepsExclude: [PACKAGE_NAME],
      resolveInlineRoute: mdx ? mdxIntegration.resolveInlineRoute : undefined,
    }),
    mdxIntegration.plugin,
    createSsgPlugin(
      ssgEnabled ? ssg : false,
      ssgEnabled ? () => router.routes.map((entry) => entry.path) : undefined,
    ),
  ]
}
