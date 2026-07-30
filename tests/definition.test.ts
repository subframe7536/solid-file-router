import { describe, it, expect, vi } from 'vitest'

import {
  assembleDefinition,
  generateDefinition,
  getComponentImportName,
  getRouteImportName,
} from '../src/routes/definition'
import type { InheritanceConfig } from '../src/routes/definition'

const root = '/root/project'
const defaultRouteRoot = `${root}/src/pages`

async function buildDefinition(
  files: string[],
  verbose?: boolean,
  inheritanceConfig?: InheritanceConfig,
  lazy?: boolean,
  routeRoot = defaultRouteRoot,
) {
  const cache = generateDefinition(files, new Map(), routeRoot)
  return assembleDefinition(files, cache, lazy, inheritanceConfig, verbose, routeRoot)
}
const files = [
  `${root}/src/pages/_app.tsx`,
  `${root}/src/pages/index.tsx`,
  `${root}/src/pages/next.tsx`,
  `${root}/src/pages/t.e.s.t.tsx`,
  `${root}/src/pages/(group)/_layout.tsx`,
  `${root}/src/pages/(group)/data.tsx`,
  `${root}/src/pages/nest/index.tsx`,
  `${root}/src/pages/nest/[id].tsx`,
  `${root}/src/pages/404.tsx`,
]

const inheritanceFiles = [
  `${root}/src/pages/_app.tsx`,
  `${root}/src/pages/dashboard/_layout.tsx`,
  `${root}/src/pages/dashboard/admin/_layout.tsx`,
  `${root}/src/pages/dashboard/admin/users.tsx`,
  `${root}/src/pages/404.tsx`,
]

const customRouteRoot = `${root}/app/routes`
const customRouteFiles = [
  `${customRouteRoot}/_app.tsx`,
  `${customRouteRoot}/index.tsx`,
  `${customRouteRoot}/blog/[slug].tsx`,
  `${customRouteRoot}/404.tsx`,
]

const routeComponentExpression = (
  filePath: string,
  loadingExpression: string,
  errorExpression: string,
) =>
  `__loader__(lazy(() => import('${filePath}?comp').then(mod => ({ default: mod.default.component }))), ${loadingExpression}, ${errorExpression})`

const eagerRouteComponentExpression = (
  filePath: string,
  loadingExpression: string,
  errorExpression: string,
) =>
  `__loader__(${getComponentImportName(filePath)}.component, ${loadingExpression}, ${errorExpression})`

const inheritedExpression = (
  filePath: string,
  channel: 'loading' | 'error',
  fallbackExpression: string,
) =>
  `${getRouteImportName(filePath)}.${channel}Component || ((${getRouteImportName(filePath)}.inherit === false || ${getRouteImportName(filePath)}.inherit?.${channel} === false) ? undefined : (${fallbackExpression}))`

const routeOnlyExpression = (filePath: string, channel: 'loading' | 'error') =>
  `${getRouteImportName(filePath)}.${channel}Component`

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('generateDefinition', () => {
  it('generates fileRoutes and imports', async () => {
    const module = await buildDefinition(files)
    expect(module).toContain("import __app_route from '/root/project/src/pages/_app.tsx?route'")
    expect(module).toContain(
      `import ${getRouteImportName(`${root}/src/pages/(group)/_layout.tsx`)} from '/root/project/src/pages/(group)/_layout.tsx?route'`,
    )
    expect(module).toContain(
      `import ${getRouteImportName(`${root}/src/pages/index.tsx`)} from '/root/project/src/pages/index.tsx?route'`,
    )
    expect(module).toContain("import { __loader__ } from 'solid-file-router'")
    expect(module).toContain('export const Root = __app_comp.component')
    expect(module).toContain(
      `__loader__(lazy(() => import('/root/project/src/pages/index.tsx?comp').then(mod => ({ default: mod.default.component }))), ${getRouteImportName(`${root}/src/pages/index.tsx`)}.loadingComponent || ((${getRouteImportName(`${root}/src/pages/index.tsx`)}.inherit === false || ${getRouteImportName(`${root}/src/pages/index.tsx`)}.inherit?.loading === false) ? undefined : (__app_route.loadingComponent)), ${getRouteImportName(`${root}/src/pages/index.tsx`)}.errorComponent || ((${getRouteImportName(`${root}/src/pages/index.tsx`)}.inherit === false || ${getRouteImportName(`${root}/src/pages/index.tsx`)}.inherit?.error === false) ? undefined : (__app_route.errorComponent)))`,
    )
    expect(module).toContain(`...${getRouteImportName(`${root}/src/pages/(group)/data.tsx`)}`)
    expect(module).toContain("import __404_route from '/root/project/src/pages/404.tsx?route'")
    expect(module).toContain('export const routeInfo = {')
    expect(module).toContain(`"/": ${getRouteImportName(`${root}/src/pages/index.tsx`)}.info`)
    expect(module).toContain('"/404": __404_route.info')
  })

  it('only treats exact special basenames as conventions', async () => {
    const myAppFile = `${root}/src/pages/my_app.tsx`
    const fooLayoutFile = `${root}/src/pages/foo_layout.tsx`
    const about404File = `${root}/src/pages/about404.tsx`
    const collisionFiles = [
      myAppFile,
      fooLayoutFile,
      about404File,
      `${root}/src/pages/dashboard.tsx`,
      `${root}/src/pages/_app.tsx`,
      `${root}/src/pages/_layout.tsx`,
      `${root}/src/pages/404.tsx`,
    ]
    const module = await buildDefinition(collisionFiles)
    const appFile = `${root}/src/pages/_app.tsx`
    const layoutFile = `${root}/src/pages/_layout.tsx`
    const dashboardFile = `${root}/src/pages/dashboard.tsx`

    expect(module).toContain(`import __app_route from '${appFile}?route'`)
    expect(module).not.toContain(`import __app_route from '${myAppFile}?route'`)
    expect(module).toContain(
      inheritedExpression(
        dashboardFile,
        'loading',
        `${getRouteImportName(layoutFile)}.loadingComponent || __app_route.loadingComponent`,
      ),
    )
    expect(module).not.toContain(
      inheritedExpression(
        dashboardFile,
        'loading',
        `${getRouteImportName(fooLayoutFile)}.loadingComponent || ${getRouteImportName(layoutFile)}.loadingComponent || __app_route.loadingComponent`,
      ),
    )
    expect(module).toContain(`import __404_route from '${root}/src/pages/404.tsx?route'`)
    expect(module).not.toContain(`import __404_route from '${about404File}?route'`)
    expect(module).toContain(`"/my_app": ${getRouteImportName(myAppFile)}.info`)
    expect(module).toContain(`"/foo_layout": ${getRouteImportName(fooLayoutFile)}.info`)
    expect(module).toContain(`"/about404": ${getRouteImportName(about404File)}.info`)
  })

  it('recognizes JSX special basenames', async () => {
    const myAppFile = `${root}/src/pages/my_app.jsx`
    const fooLayoutFile = `${root}/src/pages/foo_layout.jsx`
    const about404File = `${root}/src/pages/about404.jsx`
    const jsxFiles = [
      myAppFile,
      fooLayoutFile,
      about404File,
      `${root}/src/pages/_app.jsx`,
      `${root}/src/pages/_layout.jsx`,
      `${root}/src/pages/404.jsx`,
    ]
    const module = await buildDefinition(jsxFiles)

    expect(module).toContain(`import __app_route from '${root}/src/pages/_app.jsx?route'`)
    expect(module).not.toContain(`import __app_route from '${myAppFile}?route'`)
    expect(module).toContain(`import __404_route from '${root}/src/pages/404.jsx?route'`)
    expect(module).not.toContain(`import __404_route from '${about404File}?route'`)
    expect(module).toContain(`"/my_app": ${getRouteImportName(myAppFile)}.info`)
    expect(module).toContain(`"/foo_layout": ${getRouteImportName(fooLayoutFile)}.info`)
    expect(module).toContain(`"/about404": ${getRouteImportName(about404File)}.info`)
  })

  it('generates client routes with lazy route components', async () => {
    const module = await buildDefinition(files, false, undefined, true)
    expect(module).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).not.toContain("import { renderToStringAsync } from 'solid-js/web'")
    expect(module).toContain("import { __loader__ } from 'solid-file-router'")
    expect(module).toContain('export const Root = __app_comp.component')
    expect(module).toContain(
      `import ${getRouteImportName(`${root}/src/pages/index.tsx`)} from '/root/project/src/pages/index.tsx?route'`,
    )
    expect(module).toContain("lazy(() => import('/root/project/src/pages/index.tsx?comp')")
    expect(module).toContain('"component": __404_comp.component')
    expect(module).not.toContain('createServerEntry')
  })

  it('generate fallback if no _app.tsx present', async () => {
    const module = await buildDefinition([] as any)
    expect(module).toContain(
      `const __app_comp = { component: (props) => memo(() => props.children) }`,
    )
    expect(module).toContain(`const __app_route = {}`)
    expect(module).toContain(`const __404_comp = { component: () => null }`)
    expect(module).toContain(`const __404_route = undefined`)
    expect(module).toContain(`export const Root = __app_comp.component`)
  })

  it('includes routeInfo in generated module', async () => {
    const module = await buildDefinition(files)
    expect(module).toContain(`"/next": ${getRouteImportName(`${root}/src/pages/next.tsx`)}.info`)
    expect(module).toContain(
      `"/t/e/s/t": ${getRouteImportName(`${root}/src/pages/t.e.s.t.tsx`)}.info`,
    )
    expect(module).toContain(
      `"/data": ${getRouteImportName(`${root}/src/pages/(group)/data.tsx`)}.info`,
    )
    expect(module).toContain(
      `"/nest": ${getRouteImportName(`${root}/src/pages/nest/index.tsx`)}.info`,
    )
    expect(module).toContain(
      `"/nest/:id": ${getRouteImportName(`${root}/src/pages/nest/[id].tsx`)}.info`,
    )
  })

  it('derives route ids from a custom pagesDir', async () => {
    const module = await buildDefinition(customRouteFiles, false, undefined, true, customRouteRoot)

    expect(module).toContain(
      `import ${getRouteImportName(`${customRouteRoot}/index.tsx`)} from '${customRouteRoot}/index.tsx?route'`,
    )
    expect(module).toContain(`...${getRouteImportName(`${customRouteRoot}/blog/[slug].tsx`)}`)
    expect(module).toContain(`"/": ${getRouteImportName(`${customRouteRoot}/index.tsx`)}.info`)
    expect(module).toContain(
      `"/blog/:slug": ${getRouteImportName(`${customRouteRoot}/blog/[slug].tsx`)}.info`,
    )
  })

  it('builds custom source route tree from routeId and imports module IDs', async () => {
    const appModuleId = `${root}/docs/routes/_app.tsx-sfr.tsx`
    const moduleId = `${root}/docs/pages/button.mdx-sfr.tsx`
    const notFoundModuleId = `${root}/docs/routes/404.tsx-sfr.tsx`
    const cache = generateDefinition(
      [
        { routeId: '/', routePath: '_app.tsx', moduleId: appModuleId },
        { routeId: '/docs/button', routePath: '(general)/button.tsx', moduleId },
        { routeId: '/404', routePath: '404.tsx', moduleId: notFoundModuleId },
      ],
      new Map(),
      defaultRouteRoot,
    )
    const module = assembleDefinition(
      [
        { routeId: '/', routePath: '_app.tsx', moduleId: appModuleId },
        { routeId: '/docs/button', routePath: '(general)/button.tsx', moduleId },
        { routeId: '/404', routePath: '404.tsx', moduleId: notFoundModuleId },
      ],
      cache,
      false,
      undefined,
      false,
      defaultRouteRoot,
    )

    expect(module).toContain(`import ${getRouteImportName(moduleId)} from '${moduleId}?route'`)
    expect(module).toContain(`import ${getComponentImportName(moduleId)} from '${moduleId}?comp'`)
    expect(module).toContain(`"path": "docs"`)
    expect(module).toContain(`"path": "button"`)
    expect(module).toContain(`"id": "/docs/button"`)
    expect(module).toContain(`"/docs/button": ${getRouteImportName(moduleId)}.info`)
  })

  it('orders ancestor layouts by proximity and skips self inheritance', async () => {
    const module = await buildDefinition(inheritanceFiles)

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/_layout.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/_layout.tsx`,
          'loading',
          '__app_route.loadingComponent',
        ),
        inheritedExpression(
          `${root}/src/pages/dashboard/_layout.tsx`,
          'error',
          '__app_route.errorComponent',
        ),
      ),
    )

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/_layout.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/_layout.tsx`,
          'loading',
          `${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/_layout.tsx`,
          'error',
          `${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'loading',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.loadingComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'error',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.errorComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )
  })

  it('emits each layout route import only once in lazy and eager modes', async () => {
    const lazyModule = await buildDefinition(inheritanceFiles)
    const eagerModule = await buildDefinition(inheritanceFiles, false, undefined, false)
    const dashboardLayoutImport = `import ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)} from '/root/project/src/pages/dashboard/_layout.tsx?route'`
    const adminLayoutImport = `import ${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)} from '/root/project/src/pages/dashboard/admin/_layout.tsx?route'`

    expect(countOccurrences(lazyModule, dashboardLayoutImport)).toBe(1)
    expect(countOccurrences(lazyModule, adminLayoutImport)).toBe(1)
    expect(countOccurrences(eagerModule, dashboardLayoutImport)).toBe(1)
    expect(countOccurrences(eagerModule, adminLayoutImport)).toBe(1)
    expect(eagerModule).toContain(
      `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.loadingComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
    )
  })

  it('logs route inheritance rows once with console.table in verbose lazy mode', async () => {
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})

    try {
      await buildDefinition(inheritanceFiles, true)

      expect(tableSpy).toHaveBeenCalledTimes(1)
      expect(tableSpy).toHaveBeenCalledWith([
        {
          route: 'dashboard/_layout',
          loadingComponent: 'route → _app',
          errorComponent: 'route → _app',
        },
        {
          route: 'dashboard/admin/_layout',
          loadingComponent: 'route → dashboard → _app',
          errorComponent: 'route → dashboard → _app',
        },
        {
          route: 'dashboard/admin/users',
          loadingComponent: 'route → dashboard/admin → dashboard → _app',
          errorComponent: 'route → dashboard/admin → dashboard → _app',
        },
      ])
    } finally {
      tableSpy.mockRestore()
    }
  })

  it('disables inheritance when configured globally', async () => {
    const module = await buildDefinition(inheritanceFiles, false, { enabled: false })

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        routeOnlyExpression(`${root}/src/pages/dashboard/admin/users.tsx`, 'loading'),
        routeOnlyExpression(`${root}/src/pages/dashboard/admin/users.tsx`, 'error'),
      ),
    )
  })

  it('disables loading inheritance independently', async () => {
    const module = await buildDefinition(inheritanceFiles, false, { inheritLoading: false })

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        routeOnlyExpression(`${root}/src/pages/dashboard/admin/users.tsx`, 'loading'),
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'error',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.errorComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )
  })

  it('disables error inheritance independently', async () => {
    const module = await buildDefinition(inheritanceFiles, false, { inheritError: false })

    expect(module).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'loading',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.loadingComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        routeOnlyExpression(`${root}/src/pages/dashboard/admin/users.tsx`, 'error'),
      ),
    )
  })

  it('generates eager SSR routes with the same loader boundaries', async () => {
    const module = await buildDefinition(inheritanceFiles, false, undefined, false)
    const usersFile = `${root}/src/pages/dashboard/admin/users.tsx`

    expect(module).toContain("import { createComponent, mergeProps } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).not.toContain('StaticRouter')
    expect(module).toContain("import { __loader__ } from 'solid-file-router'")
    expect(module).toContain("import __app_route from '/root/project/src/pages/_app.tsx?route'")
    expect(module).toContain('export const Root = __app_comp.component')
    expect(module).toContain(
      `import ${getComponentImportName(usersFile)} from '/root/project/src/pages/dashboard/admin/users.tsx?comp'`,
    )
    expect(module).toContain(
      eagerRouteComponentExpression(
        usersFile,
        inheritedExpression(
          usersFile,
          'loading',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.loadingComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        inheritedExpression(
          usersFile,
          'error',
          `${getRouteImportName(`${root}/src/pages/dashboard/admin/_layout.tsx`)}.errorComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )
    expect(module).toContain('"component": __404_comp.component')
    expect(module).not.toContain('createServerEntry')
    expect(module).not.toContain('lazy(() => import(')
  })

  it('keeps route import names stable when files are added', async () => {
    const cache = generateDefinition(files)
    const before = assembleDefinition(files, cache, true)
    const addedFile = `${root}/src/pages/about.tsx`
    const nextFiles = [...files, addedFile]

    generateDefinition(nextFiles, cache)
    const after = assembleDefinition(nextFiles, cache, true)

    expect(before).toContain(`"/": ${getRouteImportName(`${root}/src/pages/index.tsx`)}.info`)
    expect(after).toContain(`"/": ${getRouteImportName(`${root}/src/pages/index.tsx`)}.info`)
    expect(after).toContain(`import ${getRouteImportName(addedFile)} from '${addedFile}?route'`)
    expect(after).toContain(`"/about": ${getRouteImportName(addedFile)}.info`)
  })

  it('updates descendant inheritance when a nested layout is added', async () => {
    const baseFiles = [
      `${root}/src/pages/_app.tsx`,
      `${root}/src/pages/dashboard/_layout.tsx`,
      `${root}/src/pages/dashboard/admin/users.tsx`,
      `${root}/src/pages/404.tsx`,
    ]
    const nestedLayout = `${root}/src/pages/dashboard/admin/_layout.tsx`
    const cache = generateDefinition(baseFiles)
    const before = assembleDefinition(baseFiles, cache, true)

    expect(before).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'loading',
          `${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'error',
          `${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )

    generateDefinition([...baseFiles, nestedLayout], cache)
    const after = assembleDefinition([...baseFiles, nestedLayout], cache, true)

    expect(after).toContain(
      routeComponentExpression(
        `${root}/src/pages/dashboard/admin/users.tsx`,
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'loading',
          `${getRouteImportName(nestedLayout)}.loadingComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.loadingComponent || __app_route.loadingComponent`,
        ),
        inheritedExpression(
          `${root}/src/pages/dashboard/admin/users.tsx`,
          'error',
          `${getRouteImportName(nestedLayout)}.errorComponent || ${getRouteImportName(`${root}/src/pages/dashboard/_layout.tsx`)}.errorComponent || __app_route.errorComponent`,
        ),
      ),
    )
  })

  it('assembles lazy and eager modules from the same cache', async () => {
    const cache = generateDefinition(inheritanceFiles)
    const lazyModule = assembleDefinition(inheritanceFiles, cache, true)
    const eagerModule = assembleDefinition(inheritanceFiles, cache, false)

    expect(lazyModule).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(eagerModule).toContain("import { createComponent, mergeProps } from 'solid-js'")
    expect(eagerModule).toContain(
      `import ${getComponentImportName(`${root}/src/pages/dashboard/admin/users.tsx`)} from '/root/project/src/pages/dashboard/admin/users.tsx?comp'`,
    )
    expect(lazyModule).toContain("import { __loader__ } from 'solid-file-router'")
    expect(eagerModule).toContain("import { __loader__ } from 'solid-file-router'")
  })
})
