import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'
import type { InheritanceConfig } from './utils/definition'
import { generateDefinition } from './utils/definition'
import { generateRouteTypes } from './utils/route-type'
import type { InfoTypeDefinition } from './utils/route-type'
import { extract, invalidateCache } from './utils/extract'
import { helper } from './helper'
import { ID_EXTRACT, logger, VID_EXTRACT, VID_EXTRACT_RESOLVED } from './const'

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
}

export const DEFAULT_IGNORES = ['**/components/**', '**/node_modules/**', '**/dist/**']

const queryMap = new Map<string, string[]>([
  ['meta', ['info', 'preload', 'matchFilters', 'inherit']],
  ['comp', ['component']],
  ['load', ['loadingComponent']],
  ['error', ['errorComponent']],
])

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
  } = options

  const inheritanceConfig = {
    enabled: inheritance.enabled ?? true,
    inheritLoading: inheritance.inheritLoading ?? true,
    inheritError: inheritance.inheritError ?? true,
  }

  const routesFilter = `${normalizePath(baseDir).replace(/\/$/, '')}/src/pages/**/[\\w[-]*.{jsx,tsx,mdx}`
  let root: string
  async function generate(): Promise<string> {
    const start = Date.now()
    const files = await glob(routesFilter, {
      cwd: root,
      ignore,
      absolute: true,
    })

    const module = await generateDefinition(files, verboseLog, inheritanceConfig)
    const count = generateRouteTypes(files, normalizePath(`${root}/${output}`), infoDts)
    logger.info(`Scanned ${count} routes in ${Date.now() - start} ms`, {
      timestamp: true,
    })
    return module
  }

  return [
    helper,
    {
      name: ID_EXTRACT,
      configResolved(config) {
        root = config.root
      },
      resolveId: {
        filter: {
          id: new RegExp(VID_EXTRACT),
        },
        handler() {
          return VID_EXTRACT_RESOLVED
        },
      },
      configureServer(server) {
        const handleFileEvent = (gen: boolean) => async (file: string) => {
          if (file.includes('/src/pages/')) {
            if (gen) {
              await generate()
            } else {
              invalidateCache(file)
            }

            // Invalidate the virtual module for add/unlink events
            const module = server.moduleGraph.getModuleById(VID_EXTRACT_RESOLVED)
            if (module) {
              server.moduleGraph.invalidateModule(module)
              server.ws.send({
                type: 'full-reload',
              })
            }
          }
        }

        server.watcher.on('add', handleFileEvent(true)).on('unlink', handleFileEvent(true))

        if (reloadOnChange) {
          server.watcher.on('change', handleFileEvent(false))
        }
      },
      load: {
        filter: {
          id: new RegExp(VID_EXTRACT_RESOLVED),
        },
        handler() {
          return generate()
        },
      },
      transform: {
        filter: {
          id: [/\?meta$/, /\?comp$/, /\?load$/, /\?error$/],
        },
        async handler(code, fullId) {
          const [id, query] = fullId.split('?')
          if (query && queryMap.has(query)) {
            const pick = queryMap.get(query)!
            return await extract(code, id, { entryFn: 'createRoute', pick }, verboseLog)
          }
        },
      },
    },
  ]
}
