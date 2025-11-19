import { glob } from 'tinyglobby'
import { normalizePath } from 'vite'
import type { Plugin } from 'vite'
import { generateDefinition } from './utils/definition'
import { generateRouteTypes } from './utils/route-type'
import { extract } from './utils/extract'
import { helper } from './helper'
import {
  ID_EXTRACT,
  logger,
  VID_EXTRACT,
  VID_EXTRACT_RESOLVED,
  VID_HELPER,
} from './const'

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
   * Default: all files in `components/`, `node_modules/` and `dist/`
   */
  ignore?: string[]
  /**
   * Whether to reload the page when route files change.
   * @default true
   */
  reloadOnChange?: boolean
}

/**
 * Vite plugin for page generation
 */
export function fileRouter(options: FileRouterPluginOption = {}): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    baseDir = '',
    ignore = ['**/components/**'],
    reloadOnChange = true,
  } = options

  const routesFilter = `${normalizePath(baseDir).replace(/\/$/, '')}/src/pages/**/[\\w[-]*.{jsx,tsx,mdx}`
  let root: string
  async function generate(): Promise<string> {
    const start = Date.now()
    const files = await glob(routesFilter, {
      cwd: root,
      ignore: [...ignore, '**/node_modules/**', '**/dist/**'],
      absolute: true,
    })

    const module = await generateDefinition(files)
    const count = generateRouteTypes(files, normalizePath(`${root}/${output}`))
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
        const handleFileChange = (gen: boolean) => async (file: string) => {
          if (file.includes('/src/pages/')) {
            // 1. Invalidate the virtual module so Vite knows to reload it
            const mod = server.moduleGraph.getModuleById(VID_EXTRACT_RESOLVED)
            if (mod) {
              server.moduleGraph.invalidateModule(mod)
            }
            // 2. Trigger a full reload or let Vite HMR handle the new route
            // Usually, if the virtual module is invalidated, Vite sends an update.
            server.ws.send({ type: 'full-reload', path: '*' })
          }
          if (gen) {
            await generate()
          }
        }

        server.watcher
          .on('add', handleFileChange(true))
          .on('unlink', handleFileChange(true))

        if (reloadOnChange) {
          server.watcher.on('change', handleFileChange(false))
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
          id: [/\?meta$/, /\?comp$/],
        },
        async handler(code, id) {
          if (id.endsWith('?meta')) {
            return await extract(code, id, {
              entryFn: 'createRoute',
              pick: ['info', 'preload', 'matchFilters'],
            })
          } else if (id.endsWith('?comp')) {
            const result = await extract(code, id, {
              entryFn: 'createRoute',
              pick: ['component', 'errorComponent', 'loadComponent'],
              targetFn: '__comp',
            })
            return `import __comp from '${VID_HELPER}'\n${result}`
          }
        },
      },
    },
  ]
}
