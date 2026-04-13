import { describe, it, expect } from 'vitest'

import { generateDefinition } from '../src/utils/definition'

const root = '/root/project'
const files = [
  root + '/src/pages/_app.tsx',
  root + '/src/pages/index.tsx',
  root + '/src/pages/next.tsx',
  root + '/src/pages/t.e.s.t.tsx',
  root + '/src/pages/(group)/_layout.tsx',
  root + '/src/pages/(group)/data.tsx',
  root + '/src/pages/nest/index.tsx',
  root + '/src/pages/nest/[id].tsx',
  root + '/src/pages/404.tsx',
]

describe('generateDefinition', () => {
  it('generates fileRoutes and imports', async () => {
    const module = await generateDefinition(files)
    expect(module).toContain("import __app_route from '/root/project/src/pages/_app.tsx?route'")
    expect(module).toContain(
      "import __layout0_route from '/root/project/src/pages/(group)/_layout.tsx?route'",
    )
    expect(module).toContain("import __route0_route from '/root/project/src/pages/index.tsx?route'")
    expect(module).toContain(
      'export const Root = __comp(__app_comp.component, __app_route.loadingComponent, __app_route.errorComponent)',
    )
    expect(module).toContain(
      "__comp(lazy(() => import('/root/project/src/pages/index.tsx?comp').then(mod => ({ default: mod.default.component }))), __route0_route.loadingComponent || ((__route0_route.inherit === false || __route0_route.inherit?.loading === false) ? undefined : (__app_route.loadingComponent)), __route0_route.errorComponent || ((__route0_route.inherit === false || __route0_route.inherit?.error === false) ? undefined : (__app_route.errorComponent)))",
    )
    expect(module).toContain('...__route4_route')
    expect(module).toContain("import __404_route from '/root/project/src/pages/404.tsx?route'")
    expect(module).toContain('export const routeInfo = {')
    expect(module).toContain('"/": __route0_route.info')
    expect(module).toContain('"/404": __404_route.info')
  })

  it('generates SSG client routes with lazy route components', async () => {
    const module = await generateDefinition(files, false, undefined, false)
    expect(module).toContain("import { createComponent, lazy } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).toContain('export const Root = __comp(__app_comp.component')
    expect(module).toContain("import __route0_route from '/root/project/src/pages/index.tsx?route'")
    expect(module).toContain("lazy(() => import('/root/project/src/pages/index.tsx?comp')")
    expect(module).toContain('get base()')
  })

  it('generate fallback if no _app.tsx present', async () => {
    const module = await generateDefinition([] as any)
    expect(module).toContain(
      `const __app_comp = { component: (props) => memo(() => props.children) }`,
    )
    expect(module).toContain(`const __app_route = {}`)
    expect(module).toContain(`const __404_route = undefined`)
    expect(module).toContain(
      `export const Root = __comp(__app_comp.component, __app_route.loadingComponent, __app_route.errorComponent)`,
    )
  })

  it('includes routeInfo in generated module', async () => {
    const module = await generateDefinition(files)
    expect(module).toContain('"/next": __route1_route.info')
    expect(module).toContain('"/t/e/s/t": __route2_route.info')
    expect(module).toContain('"/data": __route4_route.info')
    expect(module).toContain('"/nest": __route5_route.info')
    expect(module).toContain('"/nest/:id": __route6_route.info')
  })
})
