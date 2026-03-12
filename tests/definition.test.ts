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
    expect(module).toMatchInlineSnapshot(`
      "import { createComponent, lazy } from 'solid-js'
      import { Router } from '@solidjs/router'
      import __comp from 'virtual:solid-file-router-helper'
      import __app_comp from '/root/project/src/pages/_app.tsx?comp'
      import __app_load from '/root/project/src/pages/_app.tsx?load'
      import __app_error from '/root/project/src/pages/_app.tsx?error'
      import __layout0_load from '/root/project/src/pages/(group)/_layout.tsx?load'
      import __layout0_error from '/root/project/src/pages/(group)/_layout.tsx?error'
      import __route0_meta from '/root/project/src/pages/index.tsx?meta'
      import __route0_load from '/root/project/src/pages/index.tsx?load'
      import __route0_error from '/root/project/src/pages/index.tsx?error'
      import __route1_meta from '/root/project/src/pages/next.tsx?meta'
      import __route1_load from '/root/project/src/pages/next.tsx?load'
      import __route1_error from '/root/project/src/pages/next.tsx?error'
      import __route2_meta from '/root/project/src/pages/t.e.s.t.tsx?meta'
      import __route2_load from '/root/project/src/pages/t.e.s.t.tsx?load'
      import __route2_error from '/root/project/src/pages/t.e.s.t.tsx?error'
      import __route3_meta from '/root/project/src/pages/(group)/_layout.tsx?meta'
      import __route3_load from '/root/project/src/pages/(group)/_layout.tsx?load'
      import __route3_error from '/root/project/src/pages/(group)/_layout.tsx?error'
      import __route4_meta from '/root/project/src/pages/(group)/data.tsx?meta'
      import __route4_load from '/root/project/src/pages/(group)/data.tsx?load'
      import __route4_error from '/root/project/src/pages/(group)/data.tsx?error'
      import __route5_meta from '/root/project/src/pages/nest/index.tsx?meta'
      import __route5_load from '/root/project/src/pages/nest/index.tsx?load'
      import __route5_error from '/root/project/src/pages/nest/index.tsx?error'
      import __route6_meta from '/root/project/src/pages/nest/[id].tsx?meta'
      import __route6_load from '/root/project/src/pages/nest/[id].tsx?load'
      import __route6_error from '/root/project/src/pages/nest/[id].tsx?error'
      import __404_comp from '/root/project/src/pages/404.tsx?comp'
      import __404_meta from '/root/project/src/pages/404.tsx?meta'

      export const Root = __comp(__app_comp.component, __app_load.loadingComponent, __app_error.errorComponent)

      export const fileRoutes = [
        {
          "path": "nest",
          "children": [
            {
              "path": "/",
              "id": "nest/index",
              "component": __comp(lazy(() => import('/root/project/src/pages/nest/index.tsx?comp').then(mod => ({ default: mod.default.component }))), __route5_load.loadingComponent || ((__route5_meta.inherit === false || __route5_meta.inherit?.loading === false) ? undefined : (__app_load.loadingComponent)), __route5_error.errorComponent || ((__route5_meta.inherit === false || __route5_meta.inherit?.error === false) ? undefined : (__app_error.errorComponent))),
              ...__route5_meta
            },
            {
              "path": ":id",
              "id": "nest/[id]",
              "component": __comp(lazy(() => import('/root/project/src/pages/nest/[id].tsx?comp').then(mod => ({ default: mod.default.component }))), __route6_load.loadingComponent || ((__route6_meta.inherit === false || __route6_meta.inherit?.loading === false) ? undefined : (__app_load.loadingComponent)), __route6_error.errorComponent || ((__route6_meta.inherit === false || __route6_meta.inherit?.error === false) ? undefined : (__app_error.errorComponent))),
              ...__route6_meta
            }
          ]
        },
        {
          "path": "/",
          "id": "index",
          "component": __comp(lazy(() => import('/root/project/src/pages/index.tsx?comp').then(mod => ({ default: mod.default.component }))), __route0_load.loadingComponent || ((__route0_meta.inherit === false || __route0_meta.inherit?.loading === false) ? undefined : (__app_load.loadingComponent)), __route0_error.errorComponent || ((__route0_meta.inherit === false || __route0_meta.inherit?.error === false) ? undefined : (__app_error.errorComponent))),
          ...__route0_meta
        },
        {
          "path": "next",
          "id": "next",
          "component": __comp(lazy(() => import('/root/project/src/pages/next.tsx?comp').then(mod => ({ default: mod.default.component }))), __route1_load.loadingComponent || ((__route1_meta.inherit === false || __route1_meta.inherit?.loading === false) ? undefined : (__app_load.loadingComponent)), __route1_error.errorComponent || ((__route1_meta.inherit === false || __route1_meta.inherit?.error === false) ? undefined : (__app_error.errorComponent))),
          ...__route1_meta
        },
        {
          "path": "t/e/s/t",
          "id": "t.e.s.t",
          "component": __comp(lazy(() => import('/root/project/src/pages/t.e.s.t.tsx?comp').then(mod => ({ default: mod.default.component }))), __route2_load.loadingComponent || ((__route2_meta.inherit === false || __route2_meta.inherit?.loading === false) ? undefined : (__app_load.loadingComponent)), __route2_error.errorComponent || ((__route2_meta.inherit === false || __route2_meta.inherit?.error === false) ? undefined : (__app_error.errorComponent))),
          ...__route2_meta
        },
        {
          "id": "(group)/_layout",
          "path": "",
          "children": [
            {
              "path": "data",
              "id": "(group)/data",
              "component": __comp(lazy(() => import('/root/project/src/pages/(group)/data.tsx?comp').then(mod => ({ default: mod.default.component }))), __route4_load.loadingComponent || ((__route4_meta.inherit === false || __route4_meta.inherit?.loading === false) ? undefined : (__layout0_load.loadingComponent || __app_load.loadingComponent)), __route4_error.errorComponent || ((__route4_meta.inherit === false || __route4_meta.inherit?.error === false) ? undefined : (__layout0_error.errorComponent || __app_error.errorComponent))),
              ...__route4_meta
            }
          ],
          "component": __comp(lazy(() => import('/root/project/src/pages/(group)/_layout.tsx?comp').then(mod => ({ default: mod.default.component }))), __route3_load.loadingComponent || ((__route3_meta.inherit === false || __route3_meta.inherit?.loading === false) ? undefined : (__layout0_load.loadingComponent || __app_load.loadingComponent)), __route3_error.errorComponent || ((__route3_meta.inherit === false || __route3_meta.inherit?.error === false) ? undefined : (__layout0_error.errorComponent || __app_error.errorComponent))),
          ...__route3_meta
        },
        {
          "id": "*",
          "path": "*",
          "component": __404_comp,
          ...__404_meta
        }
      ]
      export const FileRouter = (props) => createComponent(Router, {
        get base() {
          return props.base
        },
        get root() {
          return Root
        },
        get children() {
          return fileRoutes
        }
      })
      "
    `)
  })

  it('generate fallback if no _app.tsx present', async () => {
    expect(await generateDefinition([] as any)).toMatchInlineSnapshot(`
      "import { createComponent, lazy } from 'solid-js'
      import { Router } from '@solidjs/router'
      import __comp from 'virtual:solid-file-router-helper'
      import { memo } from "solid-js/web";
      const __app_comp = (props) => memo(() => props.children)
      const __404_comp = () => null
      const __404_meta = undefined

      export const Root = __comp(__app_comp.component, __app_load.loadingComponent, __app_error.errorComponent)

      export const fileRoutes = [
        {
          "id": "*",
          "path": "*",
          "component": __404_comp,
          ...__404_meta
        }
      ]
      export const FileRouter = (props) => createComponent(Router, {
        get base() {
          return props.base
        },
        get root() {
          return Root
        },
        get children() {
          return fileRoutes
        }
      })
      "
    `)
  })
})
