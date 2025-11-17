import { describe, it, expect } from 'vitest'
import { generateDefinition } from '../src/utils/definition'

const root = '/root/project'
const files = [
  root + '/src/pages/_app.tsx',
  root + '/src/pages/index.tsx',
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
      import __route1_meta from '/root/project/src/pages/nest/index.tsx?meta'
      import __route2_meta from '/root/project/src/pages/nest/[id].tsx?meta'
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
              ...__route1_meta
            },
            {
              "path": ":id",
              "id": "nest/[id]",
              "component": lazy(() => import('/root/project/src/pages/nest/[id].tsx?comp')),
              ...__route2_meta
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

  it('throws if no _app.tsx present', async () => {
    const badFiles = files.filter((f) => !f.endsWith('_app.tsx'))
    await expect(generateDefinition(badFiles as any)).rejects.toThrow()
  })
})
