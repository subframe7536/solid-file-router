import type { Plugin, ResolvedConfig } from 'vite'

import { ID_EXTRACT, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
import { createHelperPlugin } from './helper'
import { ssgPlugin } from './ssg'
import type { SSGConfig } from './ssg/types'
import type { InheritanceConfig } from './utils/definition'
import { extract } from './utils/extract'
import { RouteRegistry } from './utils/registry'
import type { InfoTypeDefinition } from './utils/route-type'

interface FileRouterPluginOption {
  /**
   * The output file path where the page types will be saved.
   * @default 'src/routes.d.ts'
   */
  output?: string
  /**
   * The base directory of `src/pages`.
   *
   * e.g. If your `_app.tsx` is located at `packages/app/module/src/pages/_app.tsx`,
   * You need to setup to `packages/app/module/`
   * @default ''
   */
  baseDir?: string
  /**
   * A list of glob patterns to be ignored during processing.
   *
   * Default is {@link DEFAULT_IGNORES}: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
  /**
   * Whether to reload the page when route files change.
   * @default true
   */
  reloadOnChange?: boolean
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
   * SSG (Static Site Generation) configuration.
   *
   * When provided, selected routes will be prerendered to static HTML during `vite build --app`.
   *
   * The router mode is inferred automatically:
   * - No SSR environment configured → SPA (render)
   * - SSR environment configured, no `ssg` → SSR (hydrate)
   * - SSR environment configured + `ssg` → SSG (hydrate + prerender)
   *
   * @example
   * ```ts
   * ssg: {
   *   routes: ['/', '/about'],
   *   crawl: true,
   * }
   * ```
   */
  ssg?: SSGConfig
}

export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

const queryMap = new Map<string, string[]>([
  [
    'route',
    [
      'info',
      'preload',
      'matchFilters',
      'inherit',
      'prerender',
      'loadingComponent',
      'errorComponent',
    ],
  ],
  ['comp', ['component']],
])
const REG_ROUTE_QUERY = /\?(route|comp)$/

/**
 * Returns true when the resolved Vite config has an SSR environment with a
 * build entry configured (Vite 8 environment builds), or the legacy
 * `build.ssr` option is set.
 */
function hasSSRConfigured(config: ResolvedConfig): boolean {
  if (config.build.ssr) {
    return true
  }
  const ssrEnv = (config.environments as Record<string, any>)?.ssr
  return !!(ssrEnv?.build?.rolldownOptions?.input ?? ssrEnv?.build?.rollupOptions?.input)
}

interface FileRouterCorePluginOptions {
  output: string
  baseDir: string
  ignore: string[]
  reloadOnChange: boolean
  infoDts?: InfoTypeDefinition
  verboseLog?: boolean
  inheritanceConfig: Required<InheritanceConfig>
  hydrateRef: { value: boolean }
}

function createRouteRegistryPlugin(options: FileRouterCorePluginOptions) {
  const { baseDir, ignore, output, infoDts, verboseLog, inheritanceConfig, hydrateRef, reloadOnChange } =
    options
  let isSSR = hydrateRef.value
  const registry = new RouteRegistry({
    baseDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
  })

  return {
    name: ID_EXTRACT,
    configResolved(config) {
      // Auto-infer SSR/SSG mode from the Vite config:
      //   - build.ssr set → traditional Vite SSR build
      //   - environments.ssr.build.rolldownOptions.input set → Vite 8 environment build
      hydrateRef.value = hydrateRef.value || hasSSRConfigured(config)
      isSSR = hydrateRef.value
      registry.setRoot(config.root)
    },
    resolveId: {
      filter: {
        id: new RegExp(VID_EXTRACT),
      },
      handler() {
        return VID_EXTRACT_RESOLVED
      },
    },
    load: {
      filter: {
        id: new RegExp(VID_EXTRACT_RESOLVED),
      },
      handler() {
        // In Vite 8, this.environment.name is 'ssr' for the SSR build environment
        // (registered by the ssgPlugin config hook). The legacy `isSSR` path covers
        // explicit SSR mode builds triggered by `build.ssr` in userland.
        const ssr = isSSR || this.environment.name === 'ssr'
        return registry.getDefinition({ ssr })
      },
    },
    configureServer(server) {
      const invalidateVirtualModule = (id: string) => {
        const module = server.moduleGraph.getModuleById(id)
        if (module) {
          server.moduleGraph.invalidateModule(module)
        }
      }

      const handleStructureEvent =
        (handler: (file: string) => Promise<boolean>) => async (file: string) => {
          if (!(await handler(file))) {
            return
          }

          invalidateVirtualModule(VID_EXTRACT_RESOLVED)
          server.ws.send({
            type: 'full-reload',
          })
        }

      server.watcher
        .on(
          'add',
          handleStructureEvent((file) => registry.addFile(file)),
        )
        .on(
          'unlink',
          handleStructureEvent((file) => registry.removeFile(file)),
        )
        .on('change', (file) => {
          if (!reloadOnChange && !registry.isRouteFile(file)) {
            return
          }
          registry.markChanged(file)
        })
    },
    transform: {
      filter: {
        id: REG_ROUTE_QUERY,
      },
      async handler(code, fullId) {
        const [id, query] = fullId.split('?')
        if (query && queryMap.has(query)) {
          const pick = queryMap.get(query)!
          return await extract(code, id!, { entryFn: 'createRoute', pick }, verboseLog)
        }
      },
    },
  } satisfies Plugin
}

function createFileRouterCorePlugins(options: FileRouterCorePluginOptions): Plugin[] {
  return [
    ...createHelperPlugin(options.hydrateRef),
    createRouteRegistryPlugin(options),
  ]
}

/**
 * Vite plugin for page generation
 */
export function fileRouter(options: FileRouterPluginOption = {}): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    baseDir = '',
    ignore = DEFAULT_IGNORES,
    reloadOnChange = true,
    infoDts,
    verboseLog,
    inheritance = { enabled: true },
    ssg: ssgConfig,
  } = options

  // Hydration is needed for SSR and SSG. Start with whether ssg config is provided;
  // configResolved will also enable it when the Vite config has an SSR environment.
  const hydrateRef = { value: Boolean(ssgConfig) }

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  const coreOptions: FileRouterCorePluginOptions = {
    output,
    baseDir,
    ignore,
    reloadOnChange,
    infoDts,
    verboseLog,
    inheritanceConfig,
    hydrateRef,
  }

  const plugins = createFileRouterCorePlugins(coreOptions)

  if (ssgConfig) {
    plugins.push(ssgPlugin(ssgConfig))
  }

  return plugins
}
