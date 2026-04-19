import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

function createTempProject() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-plugin-')))
  const pagesDir = join(root, 'src/pages')

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

async function createPlugin(root: string, lazy?: boolean) {
  const [plugin] = fileRouter({
    baseDir: '',
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
})
