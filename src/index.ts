import type { Plugin } from 'vite'

import { ID_EXTRACT, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
import { helper } from './helper'
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
   * When provided, selected routes will be prerendered to static HTML during `vite build`.
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
    ssg,
  } = options

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  let isSSR = false
  const registry = new RouteRegistry({
    baseDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
  })

  const plugins: Plugin[] = [
    helper,
    {
      name: ID_EXTRACT,
      configResolved(config) {
        isSSR = !!config.build.ssr
        registry.setRoot(config.root)
      },
      resolveId: {
        filter: {
          id: new RegExp(`${VID_EXTRACT}`),
        },
        handler() {
          return VID_EXTRACT_RESOLVED
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
      load: {
        filter: {
          id: new RegExp(`${VID_EXTRACT_RESOLVED}`),
        },
        handler() {
          return registry.getDefinition({
            ssr: isSSR,
          })
        },
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
    },
  ]

  if (ssg && !(globalThis as any).__SOLID_FILE_ROUTER_SSG__) {
    plugins.push(
      ssgPlugin(
        ssg,
        {
          output,
          baseDir,
          ignore,
          reloadOnChange,
          infoDts,
          verboseLog,
          inheritance,
        },
        fileRouter,
      ),
    )
  }

  return plugins
}
