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
      "import __app_comp from '/root/project/src/pages/_app.tsx?comp'
      import __route0_meta from '/root/project/src/pages/index.tsx?meta'
      import __route1_meta from '/root/project/src/pages/next.tsx?meta'
      import __route2_meta from '/root/project/src/pages/t.e.s.t.tsx?meta'
      import __route3_meta from '/root/project/src/pages/(group)/_layout.tsx?meta'
      import __route4_meta from '/root/project/src/pages/(group)/data.tsx?meta'
      import __route5_meta from '/root/project/src/pages/nest/index.tsx?meta'
      import __route6_meta from '/root/project/src/pages/nest/[id].tsx?meta'
      import __404_comp from '/root/project/src/pages/404.tsx?comp'
      import __404_meta from '/root/project/src/pages/404.tsx?meta'
      import { createComponent, lazy } from 'solid-js'
      import { Router } from '@solidjs/router'

      export const Root = __app_comp

      export const fileRoutes = [
        {
          "path": "nest",
          "children": [
            {
              "path": "/",
              "id": "nest/index",
              "component": lazy(() => import('/root/project/src/pages/nest/index.tsx?comp')),
              ...__route5_meta
            },
            {
              "path": ":id",
              "id": "nest/[id]",
              "component": lazy(() => import('/root/project/src/pages/nest/[id].tsx?comp')),
              ...__route6_meta
            }
          ]
        },
        {
          "path": "/",
          "id": "index",
          "component": lazy(() => import('/root/project/src/pages/index.tsx?comp')),
          ...__route0_meta
        },
        {
          "path": "next",
          "id": "next",
          "component": lazy(() => import('/root/project/src/pages/next.tsx?comp')),
          ...__route1_meta
        },
        {
          "path": "t/e/s/t",
          "id": "t.e.s.t",
          "component": lazy(() => import('/root/project/src/pages/t.e.s.t.tsx?comp')),
          ...__route2_meta
        },
        {
          "id": "(group)/_layout",
          "path": "",
          "children": [
            {
              "path": "data",
              "id": "(group)/data",
              "component": lazy(() => import('/root/project/src/pages/(group)/data.tsx?comp')),
              ...__route4_meta
            }
          ],
          "component": lazy(() => import('/root/project/src/pages/(group)/_layout.tsx?comp')),
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
      "import { memo } from "solid-js/web";
      const __app_comp = (props) => memo(() => props.children)
      const __404_comp = () => null
      const __404_meta = undefined
      import { createComponent, lazy } from 'solid-js'
      import { Router } from '@solidjs/router'

      export const Root = __app_comp

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
