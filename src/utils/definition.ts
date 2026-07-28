import { normalizePath } from 'vite'

import { logger, PACKAGE_NAME } from '../const'

export const patterns = {
  optional: [/^-(:?[\w-]+|\*)/, '$1?'],
  param: [/\[([^\]]+)]/g, ':$1'],
  slash: [/^index$|\./g, '/'],
  splat: [/\[\.{3}\w+\]/g, '*'],
} as const

const REG_LAYOUT = /_layout\.(jsx|tsx)$/
const REG_GROUP = /\([\w-]+\)/
const REG_INSERT = /^\w|\//
const REG_ROUTE_EXT = /\.(jsx|tsx)$/
const REG_UNSUPPORTED_ROUTE_EXT = /\.mdx$/

function isNotFoundRoute(file: string) {
  return (
    file === '404' || file.endsWith('/404') || file.endsWith('404.tsx') || file.endsWith('404.jsx')
  )
}

function hasPrivateSegment(file: string) {
  return file.split('/').some((segment) => segment.startsWith('_'))
}

export function getRoutePath(key: string, routeRoot = 'src/pages'): string | undefined {
  if (REG_UNSUPPORTED_ROUTE_EXT.test(key)) {
    return undefined
  }

  if (key === '/') {
    return '/'
  }

  if (isLogicalUrlRoutePath(key, routeRoot)) {
    return key
  }

  if (key.includes('/_') && !key.endsWith('/404.tsx') && !key.endsWith('/404.jsx')) {
    return undefined
  }

  if (isNotFoundRoute(key)) {
    return '/404'
  }

  const path = getRouteKey(key, routeRoot)
    .replace(...patterns.splat)
    .replace(...patterns.param)
    .replace(/\([\w-]+\)\/|\/?_layout/g, '')
    .replace(/\/?index|\./g, '/')
    .replace(/(\w)\/$/g, '$1')
    .split('/')
    .map((segment) => segment.replace(...patterns.optional))
    .join('/')

  if (!path) {
    return undefined
  }

  return path.length > 1 ? `/${path}` : path
}

function wrapInline(code: string) {
  return `$###${code}###$`
}

function unwrapInline(str: object) {
  return JSON.stringify(str, null, 2)
    .replaceAll('"$###', '')
    .replaceAll('###$"', '')
    .replaceAll('"__": ', '')
}

interface BaseRoute {
  id?: string
  path?: string
  children?: BaseRoute[]
  component?: string
  __?: string
}

/**
 * Information about a layout file and its default component imports.
 * Used to track which layouts provide loading and error components.
 */
interface LayoutInfo {
  /** File path to the layout (_app.tsx or _layout.tsx) */
  path: string
  /** Import name for the layout's loadingComponent (e.g., '__app_load.loadingComponent') */
  loadImportName?: string
  /** Import name for the layout's errorComponent (e.g., '__app_error.errorComponent') */
  errorImportName?: string
}

/**
 * Maps each route file path to its ordered list of ancestor layouts.
 * Layouts are ordered from nearest to farthest (app is always last).
 */
interface RouteLayoutMap {
  [routePath: string]: LayoutInfo[]
}

interface RouteInfoModuleEntry {
  importName: string
  path: string
}

interface RouteInheritanceLogRow {
  route: string
  loadingComponent: string
  errorComponent: string
}

export interface RouteEntry {
  moduleId: string
  routeId: string
  routePath: string
  sourcePath?: string
  id: string
  segments: string[]
}

export interface NormalizedRouteEntry {
  routeId: string
  routePath: string
  moduleId: string
  sourcePath?: string
}

export type RouteInput = string | NormalizedRouteEntry

const DEFAULT_INHERITANCE_CONFIG = {
  enabled: true,
  inheritLoading: true,
  inheritError: true,
} satisfies InheritanceConfig

function getEntryModuleId(entry: RouteInput | RouteEntry): string {
  return typeof entry === 'string' ? entry : entry.moduleId
}

function getEntryRouteId(entry: RouteInput | RouteEntry): string {
  return typeof entry === 'string' ? entry : entry.routeId
}

function getEntryRoutePath(entry: RouteInput | RouteEntry): string {
  return typeof entry === 'string' ? entry : entry.routePath
}

function isGeneratedRouteFile(entry: RouteInput | RouteEntry): boolean {
  const routePath = getEntryRoutePath(entry)
  return (
    (!hasPrivateSegment(routePath) || REG_LAYOUT.test(routePath)) && !isNotFoundRoute(routePath)
  )
}

function hashString(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index++) {
    hash ^= value.codePointAt(index) ?? 0
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

export function getRouteImportName(file: string): string {
  return `__route_${hashString(file)}`
}

export function getComponentImportName(file: string): string {
  return `__comp_${hashString(file)}`
}

function getRouteKey(file: string, routeRoot: string): string {
  if (file === '/') {
    return '/'
  }

  const normalizedFile = normalizePath(file)
  const normalizedRouteRoot = normalizePath(routeRoot).replace(/\/+$/g, '')
  const prefixedRouteRoot = normalizedRouteRoot ? `${normalizedRouteRoot}/` : ''

  if (prefixedRouteRoot && normalizedFile.startsWith(prefixedRouteRoot)) {
    return normalizedFile.slice(prefixedRouteRoot.length).replace(REG_ROUTE_EXT, '')
  }

  if (prefixedRouteRoot) {
    const suffixIndex = normalizedFile.lastIndexOf(`/${prefixedRouteRoot}`)
    if (suffixIndex >= 0) {
      return normalizedFile
        .slice(suffixIndex + prefixedRouteRoot.length + 1)
        .replace(REG_ROUTE_EXT, '')
    }
  }

  return normalizedFile.replace(REG_ROUTE_EXT, '')
}

function createRouteEntry(entry: RouteInput, routeRoot: string): RouteEntry {
  const moduleId = getEntryModuleId(entry)
  const routeId = getEntryRouteId(entry)
  const routePath = getEntryRoutePath(entry)
  const routeKey = getRouteTreeKey(typeof entry === 'string' ? routePath : routeId, routeRoot)

  return {
    moduleId,
    routeId,
    routePath,
    sourcePath: typeof entry === 'string' ? undefined : entry.sourcePath,
    id: typeof entry === 'string' ? routeKey : routeId,
    segments: routeKey
      .replace(...patterns.splat)
      .replace(...patterns.param)
      .split('/')
      .filter(Boolean),
  }
}

function getRouteTreeKey(routeId: string, routeRoot: string): string {
  if (routeId === '/') {
    return 'index'
  }

  if (isLogicalUrlRoutePath(routeId, routeRoot)) {
    return routeId.replace(/^\/+/, '')
  }

  return getRouteKey(routeId, routeRoot)
}

function isLogicalUrlRoutePath(routePath: string, routeRoot: string): boolean {
  if (!routePath.startsWith('/')) {
    return false
  }

  return (
    !REG_ROUTE_EXT.test(routePath) &&
    !normalizePath(routePath).startsWith(normalizePath(routeRoot).replace(/\/+$/g, ''))
  )
}

/**
 * Builds a mapping of routes to their ancestor layouts for component inheritance.
 *
 * For each route file, identifies all ancestor layouts (_layout.tsx files and _app.tsx)
 * and orders them by proximity: nearest layout first, _app.tsx last.
 *
 * This mapping is used during code generation to construct the inheritance fallback chain
 * for loading and error components.
 *
 * @param routeFiles - Array of route file paths to process
 * @param layouts - Array of layout information objects containing paths and import names
 * @returns Map of route paths to their ordered ancestor layouts (nearest first)
 *
 * @example
 * // Given routes: ['src/pages/dashboard/users.tsx']
 * // And layouts: [_app.tsx, dashboard/_layout.tsx]
 * // Returns: {
 * //   'src/pages/dashboard/users.tsx': [
 * //     { path: 'dashboard/_layout.tsx', loadImportName: '...', errorImportName: '...' },
 * //     { path: '_app.tsx', loadImportName: '...', errorImportName: '...' }
 * //   ]
 * // }
 */
function buildRouteLayoutMap(routeFiles: RouteEntry[], layouts: LayoutInfo[]): RouteLayoutMap {
  const map: RouteLayoutMap = {}

  for (const route of routeFiles) {
    const ancestorLayouts: LayoutInfo[] = []

    // Find layouts in ancestor directories
    for (const layout of layouts) {
      const layoutDir = layout.path.substring(0, layout.path.lastIndexOf('/'))

      // Check if layout is an ancestor of this route
      if (
        layout.path !== route.routePath &&
        (layout.path.includes('_app.') || route.routePath.startsWith(`${layoutDir}/`))
      ) {
        // Layout is in an ancestor directory
        ancestorLayouts.push(layout)
      }
    }

    // Sort by path depth (nearest first, app last)
    ancestorLayouts.sort((a, b) => {
      if (a.path.includes('_app.')) {
        return 1
      }
      if (b.path.includes('_app.')) {
        return -1
      }
      return b.path.length - a.path.length
    })

    map[route.moduleId] = ancestorLayouts
  }

  return map
}

/**
 * Generates component inheritance expressions with runtime checks.
 *
 * Creates JavaScript expressions that implement the three-tier fallback chain:
 * route-specific > nearest layout > ... > app > undefined
 *
 * The generated expressions include runtime checks for the route's `inherit` configuration,
 * allowing individual routes to opt-out of inheritance at runtime.
 *
 * @param routeImportName - Stable import name for the route module
 * @param layouts - Ordered array of ancestor layouts (nearest first)
 * @param inheritanceConfig - Build-time inheritance configuration from plugin options
 */
function resolveInheritedComponents(
  routeImportName: string,
  layouts: LayoutInfo[],
  inheritanceConfig: InheritanceConfig,
): { loadExpr: string; errorExpr: string } {
  const { enabled = true, inheritError = true, inheritLoading = true } = inheritanceConfig
  const routeLoadImport = `${routeImportName}.loadingComponent`
  const routeErrorImport = `${routeImportName}.errorComponent`
  const routeInheritCheck = `${routeImportName}.inherit`
  // Build fallback chain from nearest to farthest layout
  let loadExpr = routeLoadImport
  let errorExpr = routeErrorImport

  if (enabled) {
    // Add inheritance chain with runtime checks
    const loadChain: string[] = []
    const errorChain: string[] = []

    if (inheritLoading) {
      for (const layout of layouts) {
        if (layout.loadImportName) {
          loadChain.push(layout.loadImportName)
        }
      }
    }

    if (inheritError) {
      for (const layout of layouts) {
        if (layout.errorImportName) {
          errorChain.push(layout.errorImportName)
        }
      }
    }

    // Wrap inheritance with runtime check
    if (loadChain.length > 0) {
      const inheritedLoad = loadChain.join(' || ')
      loadExpr = `${routeLoadImport} || ((${routeInheritCheck} === false || ${routeInheritCheck}?.loading === false) ? undefined : (${inheritedLoad}))`
    }

    if (errorChain.length > 0) {
      const inheritedError = errorChain.join(' || ')
      errorExpr = `${routeErrorImport} || ((${routeInheritCheck} === false || ${routeInheritCheck}?.error === false) ? undefined : (${inheritedError}))`
    }
  }

  return { loadExpr, errorExpr }
}

function computeGlobalContext(entries: RouteEntry[], lazy: boolean) {
  const globalImports: string[] = [`import { __loader__ } from '${PACKAGE_NAME}'`]
  const layouts: LayoutInfo[] = []

  const appEntry = entries.find(
    (entry) => entry.routePath.endsWith('_app.tsx') || entry.routePath.endsWith('_app.jsx'),
  )
  if (appEntry) {
    globalImports.push(`import __app_comp from '${appEntry.moduleId}?comp'`)
    globalImports.push(`import __app_route from '${appEntry.moduleId}?route'`)
    layouts.push({
      path: appEntry.routePath,
      loadImportName: '__app_route.loadingComponent',
      errorImportName: '__app_route.errorComponent',
    })
  } else {
    logger.warn('No `_app.jsx` or `_app.tsx` found, fallback to parent component', {
      timestamp: true,
    })
    if (lazy) {
      globalImports.push(
        `import { memo } from "solid-js/web";`,
        `const __app_comp = { component: (props) => memo(() => props.children) }`,
        `const __app_route = {}`,
      )
    } else {
      globalImports.push(`const __app_comp = { component: (props) => props.children }`)
    }
  }

  const layoutEntries = entries.filter((entry) => REG_LAYOUT.test(entry.routePath))
  layoutEntries.forEach((layoutEntry) => {
    const layoutImportName = getRouteImportName(layoutEntry.moduleId)
    globalImports.push(`import ${layoutImportName} from '${layoutEntry.moduleId}?route'`)
    layouts.push({
      path: layoutEntry.routePath,
      loadImportName: `${layoutImportName}.loadingComponent`,
      errorImportName: `${layoutImportName}.errorComponent`,
    })
  })

  const filteredEntries = entries.filter(isGeneratedRouteFile)
  const routeLayoutMap = buildRouteLayoutMap(filteredEntries, layouts)

  const notFoundEntry = entries.find((entry) => isNotFoundRoute(entry.routePath))
  if (notFoundEntry) {
    globalImports.push(`import __404_comp from '${notFoundEntry.moduleId}?comp'`)
    globalImports.push(`import __404_route from '${notFoundEntry.moduleId}?route'`)
  } else {
    logger.warn('No `404.jsx` or `404.tsx` found, fallback to `() => null`', {
      timestamp: true,
    })
    globalImports.push(`const __404_comp = { component: () => null }`)
    globalImports.push(`const __404_route = undefined`)
  }

  return { globalImports, filteredEntries, routeLayoutMap }
}

function generateSingleRouteDefinition(
  entry: RouteEntry,
  ancestorLayouts: LayoutInfo[],
  inheritanceConfig: InheritanceConfig,
  lazy: boolean,
  verbose: boolean,
  routeRoot: string,
): { imports: string[]; route: BaseRoute; inheritanceLogRow?: RouteInheritanceLogRow } {
  const routeImportName = getRouteImportName(entry.moduleId)
  const imports: string[] = [`import ${routeImportName} from '${entry.moduleId}?route'`]
  let route: BaseRoute
  let inheritanceLogRow: RouteInheritanceLogRow | undefined
  const { loadExpr, errorExpr } = resolveInheritedComponents(
    routeImportName,
    ancestorLayouts,
    inheritanceConfig,
  )

  if (!lazy) {
    const componentImportName = getComponentImportName(entry.moduleId)
    imports.push(`import ${componentImportName} from '${entry.moduleId}?comp'`)
    route = {
      id: entry.id,
      component: wrapInline(
        `__loader__(${componentImportName}.component, ${loadExpr}, ${errorExpr})`,
      ),
      __: wrapInline(`...${routeImportName}`),
    }
  } else {
    if (verbose && ancestorLayouts.length > 0) {
      const loadChain: string[] = ['route']
      const errorChain: string[] = ['route']

      for (const layout of ancestorLayouts) {
        const layoutName = layout.path.includes('_app.')
          ? '_app'
          : getRouteKey(layout.path, routeRoot).replace('/_layout', '')

        if (layout.loadImportName) {
          loadChain.push(layoutName)
        }
        if (layout.errorImportName) {
          errorChain.push(layoutName)
        }
      }

      inheritanceLogRow = {
        route: entry.id,
        loadingComponent: loadChain.join(' → '),
        errorComponent: errorChain.join(' → '),
      }
    }

    route = {
      id: entry.id,
      component: wrapInline(
        `__loader__(lazy(() => import('${entry.moduleId}?comp').then(mod => ({ default: mod.default.component }))), ${loadExpr}, ${errorExpr})`,
      ),
      __: wrapInline(`...${routeImportName}`),
    }
  }

  return { imports, route, inheritanceLogRow }
}

/**
 * Build-time configuration for component inheritance behavior.
 *
 * This configuration is passed from the Vite plugin options and controls
 * how the code generator creates inheritance fallback chains.
 */
export interface InheritanceConfig {
  /**
   * Whether component inheritance is enabled globally.
   * When false, no inheritance code is generated.
   * @default true
   */
  enabled?: boolean
  /**
   * Whether to generate inheritance code for loading components.
   * Only applies when `enabled` is true.
   * @default true
   */
  inheritLoading?: boolean
  /**
   * Whether to generate inheritance code for error components.
   * Only applies when `enabled` is true.
   * @default true
   */
  inheritError?: boolean
}

export function generateDefinition(
  files: RouteInput[],
  cache: Map<string, RouteEntry> = new Map(),
  routeRoot = 'src/pages',
): Map<string, RouteEntry> {
  for (const file of files.filter(isGeneratedRouteFile)) {
    const moduleId = getEntryModuleId(file)
    if (cache.has(moduleId)) {
      continue
    }

    cache.set(moduleId, createRouteEntry(file, routeRoot))
  }

  return cache
}

export function assembleDefinition(
  files: RouteInput[],
  cache: Map<string, RouteEntry>,
  lazy = true,
  inheritanceConfig: InheritanceConfig = DEFAULT_INHERITANCE_CONFIG,
  verbose = false,
  routeRoot = 'src/pages',
): string {
  const entries = files.map(
    (file) => cache.get(getEntryModuleId(file)) ?? createRouteEntry(file, routeRoot),
  )
  const { globalImports, filteredEntries, routeLayoutMap } = computeGlobalContext(entries, lazy)

  const routeImports: string[] = []
  const regularRoutes: BaseRoute[] = []
  const inheritanceLogRows: RouteInheritanceLogRow[] = []

  for (const entry of filteredEntries) {
    const ancestorLayouts = routeLayoutMap[entry.moduleId] ?? []
    const { imports, route, inheritanceLogRow } = generateSingleRouteDefinition(
      entry,
      ancestorLayouts,
      inheritanceConfig,
      lazy,
      verbose,
      routeRoot,
    )
    // Layout route imports are already emitted by computeGlobalContext.
    const importsToAdd = REG_LAYOUT.test(entry.routePath) ? imports.slice(1) : imports
    routeImports.push(...importsToAdd)

    if (verbose && inheritanceLogRow) {
      inheritanceLogRows.push(inheritanceLogRow)
    }

    entry.segments.reduce((parent, segment, index) => {
      const path = segment.replace(...patterns.slash).replace(...patterns.optional)
      const root = index === 0
      const leaf = index === entry.segments.length - 1 && entry.segments.length > 1
      const node = !root && !leaf
      const layout = segment === '_layout'
      const group = REG_GROUP.test(path)
      const insert = REG_INSERT.test(path) ? 'unshift' : 'push'

      if (root) {
        const last = entry.segments.length === 1
        if (last) {
          regularRoutes.push({ path, ...route })
          return parent
        }
      }

      if (root || node) {
        const current = root ? regularRoutes : parent.children
        const found = current?.find(
          (r) => r.path === path || r.id?.replace('/_layout', '').split('/').pop() === path,
        )

        if (found) {
          found.children ??= []
          return found
        }

        const props = group ? (route.component ? { id: path, path: '' } : { id: path }) : { path }
        current?.[insert]({ ...props, children: [] })
        return current?.[insert === 'unshift' ? 0 : current.length - 1] as BaseRoute
      }

      if (layout) {
        return Object.assign(parent, route)
      }

      if (leaf) {
        parent?.children?.[insert]({ path, ...route })
      }

      return parent
    }, {} as BaseRoute)
  }

  if (verbose && inheritanceLogRows.length > 0) {
    console.table(inheritanceLogRows)
  }

  regularRoutes.push({
    id: '*',
    path: '*',
    component: wrapInline('__404_comp.component'),
    ...(lazy ? { __: wrapInline(`...__404_route`) } : {}),
  })

  const routeInfoEntries = entries
    .filter((entry) => !entry.routePath.includes('/_'))
    .map((entry) => {
      const path = getRoutePath(entry.routeId, routeRoot)
      if (!path) {
        return undefined
      }

      if (isNotFoundRoute(entry.routePath)) {
        return { path, importName: '__404_route' }
      }

      if (!isGeneratedRouteFile(entry)) {
        return undefined
      }

      return { path, importName: getRouteImportName(entry.moduleId) }
    })
    .filter((entry): entry is RouteInfoModuleEntry => !!entry)

  const routeInfo = unwrapInline(
    Object.fromEntries(
      routeInfoEntries.map((entry) => [entry.path, wrapInline(`${entry.importName}.info`)]),
    ),
  )

  // Loading strategy must never select the router runtime. FileRouter is always
  // browser-capable; build-time prerendering has its own private virtual entry.
  const routerImport = `import { Router } from '@solidjs/router'`
  const solidImports = lazy
    ? `import { createComponent, lazy } from 'solid-js'`
    : `import { createComponent } from 'solid-js'`
  const rootExpr = `export const Root = __app_comp.component`

  return `${solidImports}
${routerImport}
${globalImports.join('\n')}
${routeImports.join('\n')}

${rootExpr}

export const fileRoutes = ${unwrapInline(regularRoutes)}
export const routeInfo = ${routeInfo}
export const FileRouter = (props) => createComponent(Router, {
  get base() {
    return props.base
  },
  get url() {
    return props.url
  },
  get root() {
    return Root
  },
  get children() {
    return fileRoutes
  }
})
`
}
