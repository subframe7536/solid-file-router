import { logger, VID_HELPER } from '../const'

import { getRoutePath } from './route-type'

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
  importCode: string
  path: string
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
      if (layout.path.includes('_app.')) {
        // App is always an ancestor
        ancestorLayouts.push(layout)
      } else if (routePath.startsWith(layoutDir + '/')) {
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
 * @param routeIndex - Index of the route in the routes array
 * @param layouts - Ordered array of ancestor layouts (nearest first)
 * @param inheritanceConfig - Build-time inheritance configuration from plugin options
 * @returns Object with loadExpr and errorExpr containing the fallback chain expressions
 *
 * @example
 * // With inheritance enabled and layouts [dashboard/_layout, _app]
 * // Returns:
 * // {
 * //   loadExpr: '__route5_load.loadingComponent || ((__route5_meta.inherit === false || __route5_meta.inherit?.loading === false) ? undefined : (__layout0_load.loadingComponent || __app_load.loadingComponent))',
 * //   errorExpr: '__route5_error.errorComponent || ((__route5_meta.inherit === false || __route5_meta.inherit?.error === false) ? undefined : (__layout0_error.errorComponent || __app_error.errorComponent))'
 * // }
 *
 * @example
 * // With inheritance disabled globally
 * // Returns:
 * // {
 * //   loadExpr: '__route5_load.loadingComponent',
 * //   errorExpr: '__route5_error.errorComponent'
 * // }
 */
function resolveInheritedComponents(
  routeIndex: number,
  layouts: LayoutInfo[],
  inheritanceConfig: InheritanceConfig,
): { loadExpr: string; errorExpr: string } {
  const { enabled = true, inheritError = true, inheritLoading = true } = inheritanceConfig
  // Start with route's own components
  const routeLoadImport = `__route${routeIndex}_route.loadingComponent`
  const routeErrorImport = `__route${routeIndex}_route.errorComponent`

  // Check route-level inheritance control
  const routeInheritCheck = `__route${routeIndex}_route.inherit`

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

export async function generateRegularRoutes(
  files: string[],
  verbose = false,
  inheritanceConfig: InheritanceConfig = {
    enabled: true,
    inheritLoading: true,
    inheritError: true,
  },
  ssr = false,
  ssgClient = false,
): Promise<[imports: string[], routs: BaseRoute[]]> {
  const imports: string[] = ssr ? [] : [`import __comp from '${VID_HELPER}'`]
  const layouts: LayoutInfo[] = []

  const appPath = files.find((key) => key.endsWith('_app.tsx') || key.endsWith('_app.jsx'))
  if (appPath) {
    imports.push(`import __app_comp from '${appPath}?comp'`)
    if (!ssr) {
      imports.push(`import __app_route from '${appPath}?route'`)
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
    if (ssr) {
      imports.push(`const __app_comp = { component: (props) => props.children }`)
    } else {
      imports.push(
        `import { memo } from "solid-js/web";`,
        `const __app_comp = { component: (props) => memo(() => props.children) }`,
        `const __app_route = {}`,
      )
    }
  }

  if (!ssr) {
    // Find and import layout defaults (client only)
    const layoutFiles = files.filter((key) => REG_LAYOUT.test(key))
    layoutFiles.forEach((layoutPath, index) => {
      imports.push(`import __layout${index}_route from '${layoutPath}?route'`)
      layouts.push({
        path: layoutPath,
        loadImportName: `__layout${index}_route.loadingComponent`,
        errorImportName: `__layout${index}_route.errorComponent`,
      })
    })
  }

  const filtered = files.filter(
    (key) => (!key.includes('/_') || REG_LAYOUT.test(key)) && !key.endsWith('404.tsx'),
  )

  // Build route-to-layout mapping
  const routeLayoutMap = ssr ? {} : buildRouteLayoutMap(filtered, layouts)

  const regularRoutes: BaseRoute[] = []
  for (let i = 0; i < filtered.length; i++) {
    const file = filtered[i]

    imports.push(`import __route${i}_route from '${file}?route'`)

    let route: BaseRoute

    if (ssr) {
      imports.push(`import __route${i}_comp from '${file}?comp'`)
      route = {
        id: file.replace(...patterns.route),
        component: wrapInline(`__route${i}_comp.component`),
        __: wrapInline(`...__route${i}_route`),
      }
    } else {
      // Resolve inherited components
      const ancestorLayouts = routeLayoutMap[file] || []
      const { loadExpr, errorExpr } = resolveInheritedComponents(
        i,
        ancestorLayouts,
        inheritanceConfig,
      )

      // Log component inheritance chain in development mode
      if (verbose && ancestorLayouts.length > 0) {
        const routeId = file.replace(...patterns.route)
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

        logger.info(`Route "${routeId}" component inheritance:`, {
          timestamp: true,
        })
        if (loadChain.length > 1) {
          logger.info(`  loadingComponent: ${loadChain.join(' -> ')}`, {
            timestamp: false,
          })
        }
        if (errorChain.length > 1) {
          logger.info(`  errorComponent: ${errorChain.join(' -> ')}`, {
            timestamp: false,
          })
        }
      }

      if (ssgClient) {
        imports.push(`import __route${i}_comp from '${file}?comp'`)
        route = {
          id: file.replace(...patterns.route),
          component: wrapInline(`__comp(__route${i}_comp.component, ${loadExpr}, ${errorExpr})`),
          __: wrapInline(`...__route${i}_route`),
        }
      } else {
        route = {
          id: file.replace(...patterns.route),
          component: wrapInline(
            `__comp(lazy(() => import('${file}?comp').then(mod => ({ default: mod.default.component }))), ${loadExpr}, ${errorExpr})`,
          ),
          __: wrapInline(`...__route${i}_route`),
        }
      }
    }

    const segments = file
      .replace(...patterns.route)
      .replace(...patterns.splat)
      .replace(...patterns.param)
      .split('/')
      .filter(Boolean)

    segments.reduce((parent, segment, index) => {
      const path = segment.replace(...patterns.slash).replace(...patterns.optional)
      const root = index === 0
      const leaf = index === segments.length - 1 && segments.length > 1
      const node = !root && !leaf
      const layout = segment === '_layout'
      const group = REG_GROUP.test(path)
      const insert = REG_INSERT.test(path) ? 'unshift' : 'push'

      if (root) {
        const last = segments.length === 1
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

        const props = group ? (route?.component ? { id: path, path: '' } : { id: path }) : { path }
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

  const notFoundPath = files.find((key) => key.endsWith('404.tsx') || key.endsWith('404.jsx'))
  if (notFoundPath) {
    imports.push(`import __404_comp from '${notFoundPath}?comp'`)
    if (!ssr) {
      imports.push(`import __404_route from '${notFoundPath}?route'`)
    }
  } else {
    logger.warn('No `404.jsx` or `404.tsx` found, fallback to `() => null`', {
      timestamp: true,
    })
    imports.push(`const __404_comp = ${ssr ? '{ component: () => null }' : '() => null'}`)
    if (!ssr) {
      imports.push(`const __404_route = undefined`)
    }
  }
  regularRoutes.push({
    id: '*',
    path: '*',
    component: wrapInline(ssr ? '__404_comp.component' : '__404_comp'),
    ...(ssr ? {} : { __: wrapInline(`...__404_route`) }),
  })

  return [imports, regularRoutes]
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

export async function generateDefinition(
  files: string[],
  verbose = false,
  inheritanceConfig: InheritanceConfig = {
    enabled: true,
    inheritLoading: true,
    inheritError: true,
  },
  ssr = false,
  ssgClient = false,
): Promise<string> {
  const [imports, regularRoutes] = await generateRegularRoutes(
    files,
    verbose,
    inheritanceConfig,
    ssr,
    ssgClient,
  )
  const routerImport = ssr
    ? `import { StaticRouter } from '@solidjs/router'`
    : `import { Router } from '@solidjs/router'`
  const routerComponent = ssr ? 'StaticRouter' : 'Router'
  const routerUrlProp = ssr ? 'url' : 'base'
  const solidImports =
    ssr || ssgClient
      ? `import { createComponent } from 'solid-js'`
      : `import { createComponent, lazy } from 'solid-js'`
  const rootExpr = ssr
    ? `export const Root = __app_comp.component`
    : `export const Root = __comp(__app_comp.component, __app_route.loadingComponent, __app_route.errorComponent)`
  const result = `${solidImports}
${routerImport}
${imports.join('\n')}

${rootExpr}

export const fileRoutes = ${unwrapInline(regularRoutes)}
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
  return result
}

export function generateRouteInfoModule(files: string[]): string {
  const routes = files
    .filter((file) => !file.includes('/_'))
    .map((file, index) => {
      const path = getRoutePath(file)
      if (!path) {
        return undefined
      }
      return {
        importName: `__route${index}_route`,
        importCode: `import __route${index}_route from '${file}?route'`,
        path,
      }
    })
    .filter((route): route is RouteInfoModuleEntry => !!route)

  return `${routes.map((route) => route.importCode).join('\n')}

export const routeInfo = {
${routes.map((route) => `  '${route.path}': ${route.importName}.info,`).join('\n')}
}

export default routeInfo
`
}
