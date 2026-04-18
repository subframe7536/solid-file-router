import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { ID_EXTRACT, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'
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
   * Whether to generate route modules with lazy imports.
   * When omitted, enabled in client builds and disabled in SSR builds.
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
}

export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

const queryMap = new Map<string, string[]>([
  ['route', ['info', 'preload', 'matchFilters', 'inherit', 'loadingComponent', 'errorComponent']],
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
    lazy,
    infoDts,
    verboseLog,
    inheritance = { enabled: true },
  } = options

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  let isLazy = true
  const registry = new RouteRegistry({
    baseDir,
    ignore,
    output,
    infoDts,
    verboseLog,
    inheritance: inheritanceConfig,
  })

  return [
    {
      name: ID_EXTRACT,
      configResolved(config) {
        isLazy = lazy ?? !config.build.ssr
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
          return registry.getDefinition({ lazy: isLazy })
        },
      },
      configureServer(server) {
        const invalidateVirtualModule = (id: string) => {
          const module = server.moduleGraph.getModuleById(id)
          if (module) {
            server.moduleGraph.invalidateModule(module)
          }
        }

        const invalidateFileModules = (file: string) => {
          const modules = server.moduleGraph.getModulesByFile(normalizePath(file))
          if (!modules) {
            return
          }

          for (const module of modules) {
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
            if (!registry.markChanged(file)) {
              return
            }

            invalidateFileModules(file)
            invalidateVirtualModule(VID_EXTRACT_RESOLVED)

            if (reloadOnChange) {
              server.ws.send({
                type: 'full-reload',
              })
            }
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
    } satisfies Plugin,
  ]
}
