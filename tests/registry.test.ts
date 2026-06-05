import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePath } from 'vite'

import { generateDefinition } from '../src/utils/definition'
import { invalidateCache } from '../src/utils/extract'
import { RouteRegistry } from '../src/utils/registry'
import { generateRouteTypes } from '../src/utils/route-type'

vi.mock('../src/utils/definition', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/definition')>('../src/utils/definition')
  return {
    ...actual,
    generateDefinition: vi.fn(
      (files: string[], cache: Map<string, { file: string; id: string; segments: string[] }>) => {
        for (const file of files.filter(
          (f) => !cache.has(f) && !f.includes('/_app.') && !f.endsWith('/404.tsx'),
        )) {
          cache.set(file, { file, id: file, segments: ['index'] })
        }
        return cache
      },
    ),
    assembleDefinition: vi.fn(
      (files: string[], _cache: unknown, lazy: boolean) =>
        `mode:${lazy ? 'lazy' : 'eager'}:${files.join('|')}`,
    ),
  }
})

vi.mock('../src/utils/route-type', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/route-type')>('../src/utils/route-type')
  return {
    ...actual,
    generateRouteTypes: vi.fn(() => 0),
  }
})

vi.mock('../src/utils/extract', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/extract')>('../src/utils/extract')
  return {
    ...actual,
    invalidateCache: vi.fn(),
  }
})

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }

  vi.clearAllMocks()
})

async function createTempRegistry(
  customRoot = '',
  includeIndexRoute = false,
  routeRoot = 'src/pages',
) {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
  const root = customRoot ? join(workspaceRoot, customRoot) : workspaceRoot
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

  if (includeIndexRoute) {
    writeFileSync(
      join(pagesDir, 'index.tsx'),
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
    )
  }

  const registry = new RouteRegistry({
    pagesDir: routeRoot,
    ignore: [],
    output: 'src/routes.d.ts',
    inheritance: {
      enabled: true,
      inheritLoading: true,
      inheritError: true,
    },
  })

  await registry.initialize(root)

  return { registry, pagesDir }
}

describe('RouteRegistry', () => {
  it('caches definition and avoids repeated generation', async () => {
    const generateDefinitionMock = vi.mocked(generateDefinition)
    const generateRouteTypesMock = vi.mocked(generateRouteTypes)
    const { registry, pagesDir } = await createTempRegistry()
    const routeFile = join(pagesDir, 'index.tsx')

    writeFileSync(
      routeFile,
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
    )

    await registry.addFile(routeFile)

    const first = await registry.getDefinition(true)
    const second = await registry.getDefinition(true)
    const third = await registry.getDefinition(true)

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(generateDefinitionMock).toHaveBeenCalledTimes(2)
    expect(generateDefinitionMock.mock.calls[0]?.[0]).toEqual([
      normalizePath(join(pagesDir, '_app.tsx')),
    ])
    expect(generateDefinitionMock.mock.calls[1]?.[0]).toEqual([normalizePath(routeFile)])
    expect(generateRouteTypesMock).toHaveBeenCalledTimes(1)
  })

  it('keeps topology cache intact on route edits', async () => {
    const generateDefinitionMock = vi.mocked(generateDefinition)
    const generateRouteTypesMock = vi.mocked(generateRouteTypes)
    const invalidateCacheMock = vi.mocked(invalidateCache)
    const { registry, pagesDir } = await createTempRegistry()
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

    await registry.addFile(routeFile)
    await registry.getDefinition(true)

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
    await registry.getDefinition(true)

    expect(generateDefinitionMock).toHaveBeenCalledTimes(2)
    expect(generateRouteTypesMock).toHaveBeenCalledTimes(1)
    expect(invalidateCacheMock).toHaveBeenCalledWith(normalizePath(routeFile))
    expect((registry as any).definitionCache.has(normalizePath(routeFile))).toBe(true)
  })

  it('regenerates route types when route files are added or removed', async () => {
    const generateDefinitionMock = vi.mocked(generateDefinition)
    const generateRouteTypesMock = vi.mocked(generateRouteTypes)
    const invalidateCacheMock = vi.mocked(invalidateCache)
    const { registry, pagesDir } = await createTempRegistry()
    const routeFile = join(pagesDir, 'index.tsx')
    const addedFile = join(pagesDir, 'about.tsx')

    writeFileSync(
      routeFile,
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
    )

    await registry.addFile(routeFile)
    await registry.getDefinition(true)

    writeFileSync(
      addedFile,
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>about</h1>,
})
`,
    )

    expect(await registry.addFile(addedFile)).toBe(true)
    await registry.getDefinition(true)

    expect(await registry.removeFile(addedFile)).toBe(true)
    await registry.getDefinition(true)

    expect(generateDefinitionMock).toHaveBeenCalledTimes(3)
    expect(generateRouteTypesMock).toHaveBeenCalledTimes(3)
    expect(invalidateCacheMock).toHaveBeenCalledWith(normalizePath(addedFile))
    expect((registry as any).definitionCache.has(normalizePath(addedFile))).toBe(false)
  })

  it('discovers route files under a custom root during initialization', async () => {
    const generateDefinitionMock = vi.mocked(generateDefinition)
    const { registry, pagesDir } = await createTempRegistry('apps/site', true)
    const routeFile = join(pagesDir, 'index.tsx')

    expect(generateDefinitionMock).toHaveBeenCalledWith(
      [normalizePath(join(pagesDir, '_app.tsx')), normalizePath(routeFile)],
      expect.any(Map),
      normalizePath(pagesDir),
    )
    expect(await registry.getDefinition(true)).toBe(
      `mode:lazy:${normalizePath(join(pagesDir, '_app.tsx'))}|${normalizePath(routeFile)}`,
    )
  })

  it('discovers route files under a custom pagesDir during initialization', async () => {
    const generateDefinitionMock = vi.mocked(generateDefinition)
    const { registry, pagesDir } = await createTempRegistry('apps/site', true, 'app/routes')
    const routeFile = join(pagesDir, 'index.tsx')

    expect(generateDefinitionMock).toHaveBeenCalledWith(
      [normalizePath(join(pagesDir, '_app.tsx')), normalizePath(routeFile)],
      expect.any(Map),
      normalizePath(pagesDir),
    )
    expect(await registry.getDefinition(true)).toBe(
      `mode:lazy:${normalizePath(join(pagesDir, '_app.tsx'))}|${normalizePath(routeFile)}`,
    )
  })
})
