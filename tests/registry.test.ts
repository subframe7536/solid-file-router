import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
      (
        files: Array<string | { moduleId: string; routeId: string; routePath: string }>,
        cache: Map<string, { file: string; id: string; segments: string[] }>,
      ) => {
        for (const file of files.filter((f) => {
          const moduleId = typeof f === 'string' ? f : f.moduleId
          return (
            !cache.has(moduleId) && !moduleId.includes('/_app.') && !moduleId.endsWith('/404.tsx')
          )
        })) {
          const moduleId = typeof file === 'string' ? file : file.moduleId
          cache.set(moduleId, { file: moduleId, id: moduleId, segments: ['index'] })
        }
        return cache
      },
    ),
    assembleDefinition: vi.fn(
      (files: Array<string | { moduleId: string }>, _cache: unknown, lazy: boolean) =>
        `mode:${lazy ? 'lazy' : 'eager'}:${files.map((file) => (typeof file === 'string' ? file : file.moduleId)).join('|')}`,
    ),
  }
})

vi.mock('../src/utils/route-type', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils/route-type')>('../src/utils/route-type')
  return {
    ...actual,
    generateRouteTypes: vi.fn((_files, output: string) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'generated')
      return 0
    }),
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

    await expect(registry.markChanged(routeFile)).resolves.toMatchObject({ matched: true })
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

  it('rescans custom route sources when watched files change', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'docs/pages'), { recursive: true })

    let entries = [
      { routeId: '/', routePath: '_app.tsx', sourcePath: 'docs/pages/_app.tsx' },
      {
        routeId: '/button',
        routePath: '(general)/button.tsx',
        sourcePath: 'docs/pages/button.mdx',
      },
    ]
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
      routeSource: {
        scan: () => entries,
        load: () => 'export default {}',
        watchFiles: ['docs/pages'],
      },
    })

    await registry.initialize(workspaceRoot)
    await registry.getDefinition(true)

    entries = [
      ...entries,
      { routeId: '/input', routePath: '(general)/input.tsx', sourcePath: 'docs/pages/input.mdx' },
    ]

    const change = await registry.markChanged(join(workspaceRoot, 'docs/pages/button.mdx'))
    expect(change).toMatchObject({
      matched: true,
      structureChanged: true,
    })
    expect(change.changedModuleIds).toStrictEqual([
      normalizePath(join(workspaceRoot, 'docs/pages/_app.tsx.solid-file-router.tsx')),
      normalizePath(join(workspaceRoot, 'docs/pages/button.mdx.solid-file-router.tsx')),
    ])
    await registry.getDefinition(true)

    expect(generateRouteTypes).toHaveBeenCalledTimes(2)
  })

  it('invalidates all custom route modules when extra watched files change', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'docs/config'), { recursive: true })

    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
      routeSource: {
        scan: () => [
          { routeId: '/', routePath: '_app.tsx', sourcePath: 'docs/pages/_app.tsx' },
          {
            routeId: '/button',
            routePath: '(general)/button.tsx',
            sourcePath: 'docs/pages/button.mdx',
          },
        ],
        load: () => 'export default {}',
        watchFiles: ['docs/config'],
      },
    })

    await registry.initialize(workspaceRoot)

    const change = await registry.markChanged(join(workspaceRoot, 'docs/config/routes.ts'))

    expect(change).toMatchObject({
      matched: true,
      structureChanged: false,
    })
    expect(change.changedModuleIds).toStrictEqual([
      normalizePath(join(workspaceRoot, 'docs/pages/_app.tsx.solid-file-router.tsx')),
      normalizePath(join(workspaceRoot, 'docs/pages/button.mdx.solid-file-router.tsx')),
    ])
  })

  it('ignores mdx files in the built-in pagesDir source', async () => {
    const { registry, pagesDir } = await createTempRegistry()
    writeFileSync(
      join(pagesDir, 'content.mdx'),
      `import { createRoute } from 'solid-file-router'
export default createRoute({ component: () => null })
`,
    )

    await registry.initialize(join(pagesDir, '../..'))

    await expect(registry.markChanged(join(pagesDir, 'content.mdx'))).resolves.toMatchObject({
      matched: false,
    })
  })

  it('normalizes mdx glob route sources without leaking the source extension', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'docs'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'docs/button.mdx'), '# Button')

    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
      routeSource: {
        scan: 'docs/**/*.mdx',
        load: () => 'export default {}',
      },
    })

    await registry.initialize(workspaceRoot)

    expect(generateDefinition).toHaveBeenCalledWith(
      [
        {
          routeId: '/docs/button',
          routePath: 'docs/button.tsx',
          moduleId: normalizePath(join(workspaceRoot, 'docs/button.mdx.solid-file-router.tsx')),
          sourcePath: normalizePath(join(workspaceRoot, 'docs/button.mdx')),
        },
      ],
      expect.any(Map),
      normalizePath(join(workspaceRoot, 'src/pages')),
    )
  })

  it('uses ignore patterns and inferred watch roots for glob route sources', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    mkdirSync(join(workspaceRoot, 'docs/private'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'docs/button.mdx'), '# Button')
    writeFileSync(join(workspaceRoot, 'docs/private/draft.mdx'), '# Draft')

    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: ['**/private/**'],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
      routeSource: {
        scan: 'docs/**/*.mdx',
        load: () => 'export default {}',
      },
    })

    await registry.initialize(workspaceRoot)

    expect(registry.getWatchFiles()).toStrictEqual([normalizePath(join(workspaceRoot, 'docs'))])
    expect(generateDefinition).toHaveBeenLastCalledWith(
      [
        {
          routeId: '/docs/button',
          routePath: 'docs/button.tsx',
          moduleId: normalizePath(join(workspaceRoot, 'docs/button.mdx.solid-file-router.tsx')),
          sourcePath: normalizePath(join(workspaceRoot, 'docs/button.mdx')),
        },
      ],
      expect.any(Map),
      normalizePath(join(workspaceRoot, 'src/pages')),
    )

    writeFileSync(join(workspaceRoot, 'docs/input.mdx'), '# Input')

    await expect(registry.addFile(join(workspaceRoot, 'docs/input.mdx'))).resolves.toBe(true)
  })

  it('throws when route source load returns no code', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)

    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
      routeSource: {
        scan: () => [
          {
            routeId: '/button',
            routePath: '(general)/button.tsx',
            sourcePath: 'docs/pages/button.mdx',
          },
        ],
        load: () => undefined,
      },
    })

    await registry.initialize(workspaceRoot)

    await expect(
      registry.loadRouteSourceModule(
        normalizePath(join(workspaceRoot, 'docs/pages/button.mdx.solid-file-router.tsx')),
      ),
    ).rejects.toThrow('routeSource.load returned no code for routeId: /button')
  })
})
