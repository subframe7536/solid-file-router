import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { fileRouter } from '../src/index'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTempProject(routeRoot = 'src/pages') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-plugin-')))
  const pagesDir = join(root, routeRoot)

  tempDirs.push(root)
  mkdirSync(pagesDir, { recursive: true })

  writeFileSync(
    join(pagesDir, '_app.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <div>{props.children}</div>,
})
`,
  )

  writeFileSync(
    join(pagesDir, 'index.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
  )

  return root
}

function createTempProjectWithCustomRoot(customRoot: string, routeRoot = 'src/pages') {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-plugin-')))
  const root = join(workspaceRoot, customRoot)
  const pagesDir = join(root, routeRoot)

  tempDirs.push(workspaceRoot)
  mkdirSync(pagesDir, { recursive: true })

  writeFileSync(
    join(pagesDir, '_app.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: (props) => <div>{props.children}</div>,
})
`,
  )

  writeFileSync(
    join(pagesDir, 'index.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
  )

  writeFileSync(
    join(pagesDir, 'about.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>about</h1>,
})
`,
  )

  return { workspaceRoot, root }
}

async function createPlugin(root: string, lazy?: boolean, pagesDir = 'src/pages') {
  const [plugin] = fileRouter({
    pagesDir,
    ignore: [],
    lazy,
  })

  await (plugin as any).configResolved({
    build: { ssr: false },
    root,
  })

  return plugin as any
}

describe('fileRouter', () => {
  it('respects lazy: false even in a client build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, false)
    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent } from 'solid-js'")
    expect(module).toContain("import { StaticRouter } from '@solidjs/router'")
    expect(module).not.toContain('lazy(() => import(')
  })

  it('respects lazy: true even in an SSR build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, true)

    await plugin.configResolved({
      build: { ssr: true },
      root,
    })

    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent, lazy } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).toContain('lazy(() => import(')
  })

  it('supports a custom Vite root from config', async () => {
    const { workspaceRoot, root } = createTempProjectWithCustomRoot('apps/site')
    const plugin = await createPlugin(root, false)

    await plugin.load.handler()

    expect(existsSync(join(root, 'src/routes.d.ts'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'src/routes.d.ts'))).toBe(false)
  })

  it('supports a custom pagesDir from config', async () => {
    const { root } = createTempProjectWithCustomRoot('apps/site', 'app/routes')
    const plugin = await createPlugin(root, false, 'app/routes')

    const module = await plugin.load.handler()

    expect(module).toContain(`${join(root, 'app/routes/index.tsx')}?route`)
  })
})
