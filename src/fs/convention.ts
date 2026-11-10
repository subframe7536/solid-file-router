import { readFileSync } from 'node:fs'

import { parseSync } from 'vite'

import { BaseFileSystemRouter, cleanPath } from './router'
import type { ModuleRef, PageFileSystemRouterConfig, RouteManifestEntry } from './types'

export interface StaticExportEntry {
  exportName: {
    kind: string
    name: string | null
  }
  localName: {
    name: string | null
  }
  importName: {
    name: string | null
  }
  isType: boolean
}

export interface RouteModuleAnalysis {
  exports: StaticExportEntry[]
  defaultDirective?: string
}

function defaultDirectiveOf(body: any[]): string | undefined {
  let fn = body.find((node) => node.type === 'ExportDefaultDeclaration')?.declaration
  if (fn?.type === 'Identifier') {
    const name = fn.name
    fn = undefined
    for (const node of body) {
      if (node.type === 'FunctionDeclaration' && node.id?.name === name) {
        fn = node
      } else if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          if (d.id?.name === name) {
            fn = d.init
          }
        }
      }
    }
  }
  if (!fn || !/Function(Declaration|Expression)$/.test(fn.type)) {
    return undefined
  }
  const first = fn.body?.body?.[0]
  return first?.type === 'ExpressionStatement' ? first.directive : undefined
}

/** Analyze a route module's static exports and directives using Vite's parseSync. */
export function analyzeRouteModule(src: string): RouteModuleAnalysis {
  const source = readFileSync(src, 'utf-8')
  const result = parseSync(src, source, { lang: 'tsx' })
  const error = result.errors[0]
  if (error) {
    throw new SyntaxError(`Failed to parse ${src}:\n${error.message || String(error)}`)
  }
  const exports = (result.module?.staticExports ?? []).flatMap(({ entries }: any) =>
    entries.filter((entry: any) => !entry.isType && entry.exportName.kind !== 'None'),
  )
  return {
    exports,
    defaultDirective: defaultDirectiveOf(result.program.body),
  }
}

export function getExportName(entry: StaticExportEntry): string {
  return entry.exportName.name ?? 'default'
}

/**
 * Returns the export name only when it is backed by a same-named local
 * binding, i.e. it can be re-picked from the module without renaming.
 */
export function getLocalExportName(entry: StaticExportEntry): string | undefined {
  const name = getExportName(entry)
  if (name === 'default') {
    return undefined
  }
  return name === (entry.localName.name ?? entry.importName.name ?? name) ? name : undefined
}

/**
 * Maps a route file to a route path:
 * - `index` files map to their directory's path
 * - `[param]` maps to `:param`
 * - `[[param]]` maps to an optional `:param?`
 * - `[...rest]` maps to a catch-all `*rest`
 * - `(group)` segments are retained for emission adapters to nest and strip
 */
export function routePathFromFile(routeFile: string): string {
  const routePath = routeFile
    .slice(1)
    .replace(/(^|\/)((?:\([^/()]*\))*)index$/, '$1$2')
    .replace(/\[([^/]+)\]/g, (_, m: string) => {
      if (m.length > 3 && m.startsWith('...')) {
        return `*${m.slice(3)}`
      }
      if (m.length > 2 && m.startsWith('[') && m.endsWith(']')) {
        return `:${m.slice(1, -1)}?`
      }
      return `:${m}`
    })
  return routePath.length > 0 ? `/${routePath}` : '/'
}

export const HTTP_METHODS = ['HEAD', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const

function httpMethodsOf(config: PageFileSystemRouterConfig): readonly string[] {
  if (!config.httpMethods) {
    return []
  }
  return config.httpMethods === true ? HTTP_METHODS : config.httpMethods
}

function createHandlerRefs(
  src: string,
  exports: string[],
  methods: readonly string[],
): Record<string, ModuleRef> {
  const handlers: Record<string, ModuleRef> = {}
  for (const method of methods) {
    if (!exports.includes(method)) {
      continue
    }
    handlers[`$${method}`] = { src, pick: [method] }
  }
  if (handlers.$GET && !handlers.$HEAD && methods.includes('HEAD')) {
    handlers.$HEAD = { src, pick: ['GET'] }
  }
  return handlers
}

/**
 * Standard page file-system router: route modules are pages when they have a default
 * export, and may export `route` config and HTTP handler methods.
 */
export class PageFileSystemRouter extends BaseFileSystemRouter {
  declare config: PageFileSystemRouterConfig

  constructor(config: PageFileSystemRouterConfig) {
    super(config)
  }

  override toPath(src: string): string | undefined {
    if (this.config.toPath) {
      return super.toPath(src)
    }
    return routePathFromFile(cleanPath(src, this.config))
  }

  override toRoute(src: string): RouteManifestEntry | undefined {
    if (this.config.toRoute) {
      return super.toRoute(src)
    }
    const path = this.toPath(src)
    if (path === undefined) {
      return undefined
    }
    const components = this.config.components ?? true
    if (src.endsWith('.md') || src.endsWith('.mdx')) {
      return {
        page: true,
        $component: components
          ? {
              src,
              pick: ['$css'],
            }
          : undefined,
        $$route: undefined,
        path,
      }
    }
    const methods = httpMethodsOf(this.config)
    const { exports, defaultDirective } = analyzeRouteModule(src)
    const exportNames = exports.map(getExportName)
    const localExportNames = exports
      .map(getLocalExportName)
      .filter((name): name is string => name !== undefined)
    const hasDefault = exportNames.includes('default')
    const hasRouteConfig = exportNames.includes('route')
    const handlers = createHandlerRefs(src, exportNames, methods)
    const hasHandlers = Object.keys(handlers).length > 0
    const server =
      this.config.serverComponents === true && hasDefault && defaultDirective === 'use server'

    if (hasDefault || hasHandlers) {
      return {
        page: hasDefault,
        ...(server ? { server } : {}),
        $component:
          components && hasDefault
            ? {
                src,
                pick: server
                  ? ['default']
                  : [
                      ...localExportNames.filter(
                        (name) => name !== 'route' && !methods.includes(name),
                      ),
                      'default',
                      '$css',
                    ],
                ...(server ? { eager: true } : {}),
              }
            : undefined,
        $$route: hasRouteConfig
          ? {
              src,
              pick: ['route'],
            }
          : undefined,
        ...handlers,
        path,
      }
    }
  }
}
