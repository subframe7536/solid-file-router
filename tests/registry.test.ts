import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { RouteRegistry } from '../src/utils/registry'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTempRegistry() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
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

  const registry = new RouteRegistry({
    baseDir: '',
    ignore: [],
    output: 'src/routes.d.ts',
    inheritance: {
      enabled: true,
      inheritLoading: true,
      inheritError: true,
    },
  })

  registry.setRoot(root)

  return { registry, pagesDir }
}

describe('RouteRegistry', () => {
  it('clears the virtual routes cache when a route file changes', async () => {
    const { registry, pagesDir } = createTempRegistry()
    const routeFile = join(pagesDir, 'index.tsx')

    writeFileSync(
      routeFile,
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  info: { title: 'before' },
  component: () => <h1>before</h1>,
})
`,
    )

    await registry.getDefinition({ lazy: true })
    expect((registry as any).definitionCache.size).toBe(1)

    writeFileSync(
      routeFile,
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  info: { title: 'after' },
  component: () => <h1>after</h1>,
})
`,
    )

    expect(registry.markChanged(routeFile)).toBe(true)
    expect((registry as any).definitionCache.size).toBe(0)

    await registry.getDefinition({ lazy: true })
    expect((registry as any).definitionCache.size).toBe(1)
  })
})
