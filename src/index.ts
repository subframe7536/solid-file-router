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
   * @default 'src/routes.gen.ts'
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
}

/**
 * Vite plugin for page generation
 */
export function fileRouterPlugin(
  options: FileRouterPluginOption = {},
): Plugin[] {
  const {
    output = 'src/routes.d.ts',
    baseDir = '',
    ignore = ['**/components/**'],
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
        const handleFileChange = (file: string) =>
          file.includes('/src/pages/') ? generate() : null

        server.watcher
          .on('add', handleFileChange)
          .on('change', handleFileChange)
          .on('unlink', handleFileChange)
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
