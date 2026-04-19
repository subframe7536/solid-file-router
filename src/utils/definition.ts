import { logger, PACKAGE_NAME } from '../const'

export const patterns = {
  optional: [/^-(:?[\w-]+|\*)/, '$1?'],
  param: [/\[([^\]]+)]/g, ':$1'],
  route: [/^.*\/?src\/pages\/|\.(jsx|tsx|mdx)$/g, ''],
  slash: [/^index$|\./g, '/'],
  splat: [/\[\.{3}\w+\]/g, '*'],
} as const

const REG_LAYOUT = /_layout\.(jsx|tsx)$/
const REG_GROUP = /\([\w-]+\)/
const REG_INSERT = /^\w|\//

function isNotFoundRoute(file: string) {
  return file.endsWith('404.tsx') || file.endsWith('404.jsx')
}

export function getRoutePath(key: string): string | undefined {
  if (key.includes('/_') && !key.endsWith('/404.tsx') && !key.endsWith('/404.jsx')) {
    return undefined
  }

  if (key.includes('/404.')) {
    return '/404'
  }

  const path = key
    .replace(...patterns.route)
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
  file: string
  id: string
  segments: string[]
}

const DEFAULT_INHERITANCE_CONFIG = {
  enabled: true,
  inheritLoading: true,
  inheritError: true,
} satisfies InheritanceConfig

function isGeneratedRouteFile(file: string): boolean {
  return (!file.includes('/_') || REG_LAYOUT.test(file)) && !isNotFoundRoute(file)
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

function createRouteEntry(file: string): RouteEntry {
  return {
    file,
    id: file.replace(...patterns.route),
    segments: file
      .replace(...patterns.route)
      .replace(...patterns.splat)
      .replace(...patterns.param)
      .split('/')
      .filter(Boolean),
  }
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
function buildRouteLayoutMap(routeFiles: string[], layouts: LayoutInfo[]): RouteLayoutMap {
  const map: RouteLayoutMap = {}

  for (const routePath of routeFiles) {
    const ancestorLayouts: LayoutInfo[] = []

    // Find layouts in ancestor directories
    for (const layout of layouts) {
      const layoutDir = layout.path.substring(0, layout.path.lastIndexOf('/'))

      // Check if layout is an ancestor of this route
      if (
        layout.path !== routePath &&
        (layout.path.includes('_app.') || routePath.startsWith(`${layoutDir}/`))
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

    map[routePath] = ancestorLayouts
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

function computeGlobalContext(files: string[], lazy: boolean) {
  const globalImports: string[] = lazy ? [`import { __loader__ } from '${PACKAGE_NAME}'`] : []
  const layouts: LayoutInfo[] = []

  const appPath = files.find((key) => key.endsWith('_app.tsx') || key.endsWith('_app.jsx'))
  if (appPath) {
    globalImports.push(`import __app_comp from '${appPath}?comp'`)
    if (lazy) {
      globalImports.push(`import __app_route from '${appPath}?route'`)
      layouts.push({
        path: appPath,
        loadImportName: '__app_route.loadingComponent',
        errorImportName: '__app_route.errorComponent',
      })
    }
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

  if (lazy) {
    const layoutFiles = files.filter((key) => REG_LAYOUT.test(key))
    layoutFiles.forEach((layoutPath) => {
      const layoutImportName = getRouteImportName(layoutPath)
      globalImports.push(`import ${layoutImportName} from '${layoutPath}?route'`)
      layouts.push({
        path: layoutPath,
        loadImportName: `${layoutImportName}.loadingComponent`,
        errorImportName: `${layoutImportName}.errorComponent`,
      })
    })
  }

  const filteredFiles = files.filter(isGeneratedRouteFile)
  const routeLayoutMap = lazy ? buildRouteLayoutMap(filteredFiles, layouts) : {}

  const notFoundPath = files.find((key) => isNotFoundRoute(key))
  if (notFoundPath) {
    globalImports.push(`import __404_comp from '${notFoundPath}?comp'`)
    globalImports.push(`import __404_route from '${notFoundPath}?route'`)
  } else {
    logger.warn('No `404.jsx` or `404.tsx` found, fallback to `() => null`', {
      timestamp: true,
    })
    globalImports.push(`const __404_comp = ${lazy ? '() => null' : '{ component: () => null }'}`)
    globalImports.push(`const __404_route = undefined`)
  }

  return { globalImports, filteredFiles, routeLayoutMap }
}

function generateSingleRouteDefinition(
  entry: RouteEntry,
  ancestorLayouts: LayoutInfo[],
  inheritanceConfig: InheritanceConfig,
  lazy: boolean,
  verbose: boolean,
): { imports: string[]; route: BaseRoute; inheritanceLogRow?: RouteInheritanceLogRow } {
  const routeImportName = getRouteImportName(entry.file)
  const imports: string[] = [`import ${routeImportName} from '${entry.file}?route'`]
  let route: BaseRoute
  let inheritanceLogRow: RouteInheritanceLogRow | undefined

  if (!lazy) {
    const componentImportName = getComponentImportName(entry.file)
    imports.push(`import ${componentImportName} from '${entry.file}?comp'`)
    route = {
      id: entry.id,
      component: wrapInline(`${componentImportName}.component`),
      __: wrapInline(`...${routeImportName}`),
    }
  } else {
    const { loadExpr, errorExpr } = resolveInheritedComponents(
      routeImportName,
      ancestorLayouts,
      inheritanceConfig,
    )

    if (verbose && ancestorLayouts.length > 0) {
      const loadChain: string[] = ['route']
      const errorChain: string[] = ['route']

      for (const layout of ancestorLayouts) {
        const layoutName = layout.path.includes('_app.')
          ? '_app'
          : layout.path.replace(...patterns.route).replace('/_layout', '')

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
        `__loader__(lazy(() => import('${entry.file}?comp').then(mod => ({ default: mod.default.component }))), ${loadExpr}, ${errorExpr})`,
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
  files: string[],
  cache: Map<string, RouteEntry> = new Map(),
): Map<string, RouteEntry> {
  for (const file of files.filter(isGeneratedRouteFile)) {
    if (cache.has(file)) {
      continue
    }

    cache.set(file, createRouteEntry(file))
  }

  return cache
}

export function assembleDefinition(
  files: string[],
  cache: Map<string, RouteEntry>,
  lazy = true,
  inheritanceConfig: InheritanceConfig = DEFAULT_INHERITANCE_CONFIG,
  verbose = false,
): string {
  const { globalImports, filteredFiles, routeLayoutMap } = computeGlobalContext(files, lazy)

  const routeImports: string[] = []
  const regularRoutes: BaseRoute[] = []
  const inheritanceLogRows: RouteInheritanceLogRow[] = []

  for (const file of filteredFiles) {
    const entry = cache.get(file) ?? createRouteEntry(file)
    const ancestorLayouts = routeLayoutMap[file] ?? []
    const { imports, route, inheritanceLogRow } = generateSingleRouteDefinition(
      entry,
      ancestorLayouts,
      inheritanceConfig,
      lazy,
      verbose,
    )
    // In lazy mode, _layout.tsx files already have their `?route` import
    // emitted by computeGlobalContext. Skip the duplicate here.
    const importsToAdd = lazy && REG_LAYOUT.test(entry.file) ? imports.slice(1) : imports
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
    component: wrapInline(lazy ? '__404_comp' : '__404_comp.component'),
    ...(lazy ? { __: wrapInline(`...__404_route`) } : {}),
  })

  const routeInfoEntries = files
    .filter((file) => !file.includes('/_'))
    .map((file) => {
      const path = getRoutePath(file)
      if (!path) {
        return undefined
      }

      if (isNotFoundRoute(file)) {
        return { path, importName: '__404_route' }
      }

      if (!isGeneratedRouteFile(file)) {
        return undefined
      }

      return { path, importName: getRouteImportName(file) }
    })
    .filter((entry): entry is RouteInfoModuleEntry => !!entry)

  const routeInfo = unwrapInline(
    Object.fromEntries(
      routeInfoEntries.map((entry) => [entry.path, wrapInline(`${entry.importName}.info`)]),
    ),
  )

  const routerImport = lazy
    ? `import { Router } from '@solidjs/router'`
    : `import { StaticRouter } from '@solidjs/router'`
  const routerComponent = lazy ? 'Router' : 'StaticRouter'
  const routerUrlProp = lazy ? 'base' : 'url'
  const solidImports = lazy
    ? `import { createComponent, lazy } from 'solid-js'`
    : `import { createComponent } from 'solid-js'`
  const rootExpr = lazy
    ? `export const Root = __loader__(__app_comp.component, __app_route.loadingComponent, __app_route.errorComponent)`
    : `export const Root = __app_comp.component`

  return `${solidImports}
${routerImport}
${globalImports.join('\n')}
${routeImports.join('\n')}

${rootExpr}

export const fileRoutes = ${unwrapInline(regularRoutes)}
export const routeInfo = ${routeInfo}
export const FileRouter = (props) => createComponent(${routerComponent}, {
  get ${routerUrlProp}() {
    return props.${routerUrlProp}
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
