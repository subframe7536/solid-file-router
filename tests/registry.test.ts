import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { normalizePath } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateDefinition } from '../src/routes/definition'
import { invalidateCache } from '../src/routes/extract'
import { RouteRegistry } from '../src/routes/registry'
import { generateRouteTypes } from '../src/routes/route-type'

vi.mock('../src/routes/definition', async () => {
  const actual = await vi.importActual<typeof import('../src/routes/definition')>(
    '../src/routes/definition',
  )
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

vi.mock('../src/routes/route-type', async () => {
  const actual = await vi.importActual<typeof import('../src/routes/route-type')>(
    '../src/routes/route-type',
  )
  return {
    ...actual,
    generateRouteTypes: vi.fn((_files, output: string) => {
      mkdirSync(join(output, '..'), { recursive: true })
      writeFileSync(output, 'generated')
      return 0
    }),
  }
})

vi.mock('../src/routes/extract', async () => {
  const actual =
    await vi.importActual<typeof import('../src/routes/extract')>('../src/routes/extract')
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
  it('applies ignore globs consistently to watcher events', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    const pagesDir = join(workspaceRoot, 'src/pages')
    tempDirs.push(workspaceRoot)
    mkdirSync(pagesDir, { recursive: true })
    writeFileSync(join(pagesDir, '_app.tsx'), 'export default {}')

    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: ['**/components/**', '**/node_modules/**', '**/dist/**', '**/private/**'],
      output: 'src/routes.d.ts',
      inheritance: {
        enabled: true,
        inheritLoading: true,
        inheritError: true,
      },
    })
    await registry.initialize(workspaceRoot)

    for (const relative of [
      'components/button.tsx',
      'nested/components/button.tsx',
      'node_modules/package.tsx',
      'dist/generated.tsx',
      'private/draft.tsx',
    ]) {
      const file = join(pagesDir, relative)
      expect((await registry.addFile(file)).matched).toBe(false)
      await expect(registry.markChanged(file)).resolves.toMatchObject({ matched: false })
      expect((await registry.removeFile(file)).matched).toBe(false)
    }
  })

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

    expect((await registry.addFile(addedFile)).matched).toBe(true)
    await registry.getDefinition(true)

    expect((await registry.removeFile(addedFile)).matched).toBe(true)
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

  it('canonicalizes parent-relative and absolute filesystem paths', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    const contentRoot = resolve(workspaceRoot, '../content')
    const outputPath = join(workspaceRoot, 'generated/routes.d.ts')
    tempDirs.push(workspaceRoot, contentRoot)
    mkdirSync(contentRoot, { recursive: true })

    const loadedContexts: Array<{ sourcePath: string; moduleId: string }> = []
    const registry = new RouteRegistry({
      pagesDir: '../content',
      ignore: [],
      output: outputPath,
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: '../content/**/*',
          glob: async () => ['../content/page.mdx'],
          transformPath: () => ({ path: 'page.tsx', routeId: '/page' }),
          load: (context) => {
            loadedContexts.push({ sourcePath: context.sourcePath, moduleId: context.moduleId })
            return 'export default {}'
          },
          watch: ['../content'],
        },
      ],
    })

    await registry.initialize(workspaceRoot)
    const expectedSourcePath = normalizePath(join(contentRoot, 'page.mdx'))
    const expectedModuleId = `${expectedSourcePath}-sfr.tsx`
    const expectedPagesDir = normalizePath(contentRoot)

    expect(registry.getWatchFiles()).toStrictEqual([expectedPagesDir])
    expect(generateDefinition).toHaveBeenLastCalledWith(
      [
        {
          routeId: '/page',
          routePath: 'page.tsx',
          moduleId: expectedModuleId,
          sourcePath: expectedSourcePath,
        },
      ],
      expect.any(Map),
      expectedPagesDir,
    )

    await registry.getDefinition(true)
    expect(generateRouteTypes).toHaveBeenLastCalledWith(
      [
        {
          routeId: '/page',
          routePath: 'page.tsx',
          moduleId: expectedModuleId,
          sourcePath: expectedSourcePath,
        },
      ],
      normalizePath(outputPath),
      undefined,
      expectedPagesDir,
    )

    await expect(registry.loadRouteSourceModule(expectedModuleId)).resolves.toBe(
      'export default {}',
    )
    expect(loadedContexts).toStrictEqual([
      { sourcePath: expectedSourcePath, moduleId: expectedModuleId },
    ])

    await expect(registry.markChanged(expectedSourcePath)).resolves.toMatchObject({
      matched: true,
      changedFiles: [expectedSourcePath],
      changedModuleIds: [expectedModuleId],
    })
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
      routeSources: [
        {
          filter: 'docs/pages/**/*',
          glob: async () => entries.map((entry) => entry.sourcePath),
          transformPath: (path) => {
            const entry = entries.find((entry) => entry.sourcePath === path)!
            return { path: entry.routePath, routeId: entry.routeId }
          },
          load: () => 'export default {}',
          watch: ['docs/pages'],
        },
      ],
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
      normalizePath(join(workspaceRoot, 'docs/pages/_app.tsx-sfr.tsx')),
      normalizePath(join(workspaceRoot, 'docs/pages/button.mdx-sfr.tsx')),
      normalizePath(join(workspaceRoot, 'docs/pages/input.mdx-sfr.tsx')),
    ])
    await registry.getDefinition(true)

    expect(generateRouteTypes).toHaveBeenCalledTimes(2)
  })

  it('invalidates only the changed custom route module', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const entries = [
      { routeId: '/', routePath: '_app.tsx', sourcePath: 'docs/pages/_app.tsx' },
      { routeId: '/button', routePath: 'button.tsx', sourcePath: 'docs/pages/button.mdx' },
      { routeId: '/input', routePath: 'input.tsx', sourcePath: 'docs/pages/input.mdx' },
    ]
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/pages/**/*',
          glob: async () => entries.map((entry) => entry.sourcePath),
          transformPath: (path) => {
            const entry = entries.find((entry) => entry.sourcePath === path)!
            return { path: entry.routePath, routeId: entry.routeId }
          },
          load: () => 'export default {}',
          watch: ['docs/pages'],
        },
      ],
    })

    await registry.initialize(workspaceRoot)
    const changed = await registry.markChanged(join(workspaceRoot, 'docs/pages/button.mdx'))

    expect(changed.changedModuleIds).toStrictEqual([
      normalizePath(join(workspaceRoot, 'docs/pages/button.mdx-sfr.tsx')),
    ])
  })

  it('passes custom source data through without rebuilding structure', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const firstData = { title: 'first' }
    const secondData = { title: 'second' }
    let data = firstData
    let loadedData: unknown
    const registry = new RouteRegistry<{ title: string }>({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => ['docs/button.mdx'],
          transformPath: () => ({ path: 'button.tsx', routeId: '/button', data }),
          load: (context) => {
            loadedData = context.data
            return 'export default {}'
          },
          watch: ['docs'],
        },
      ],
    })

    await registry.initialize(workspaceRoot)
    await registry.loadRouteSourceModule(
      normalizePath(join(workspaceRoot, 'docs/button.mdx-sfr.tsx')),
    )
    expect(loadedData).toBe(firstData)

    data = secondData
    const change = await registry.markChanged(join(workspaceRoot, 'docs/button.mdx'))
    expect(change.structureChanged).toBe(false)
    await registry.loadRouteSourceModule(
      normalizePath(join(workspaceRoot, 'docs/button.mdx-sfr.tsx')),
    )
    expect(loadedData).toBe(secondData)
  })

  it('derives custom route IDs from route paths', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => [
            'docs/index.mdx',
            'docs/button.mdx',
            'docs/id.mdx',
            'docs/404.mdx',
            'docs/app.mdx',
          ],
          transformPath: (path) => ({
            path: {
              'docs/index.mdx': 'index.tsx',
              'docs/button.mdx': '(general)/button.tsx',
              'docs/id.mdx': '[id].tsx',
              'docs/404.mdx': '404.tsx',
              'docs/app.mdx': '_app.tsx',
            }[path]!,
          }),
          load: () => 'export default {}',
        },
      ],
    })

    await registry.initialize(workspaceRoot)
    expect(generateDefinition).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ routeId: '/', routePath: 'index.tsx' }),
        expect.objectContaining({ routeId: '/button', routePath: '(general)/button.tsx' }),
        expect.objectContaining({ routeId: '/:id', routePath: '[id].tsx' }),
        expect.objectContaining({ routeId: '/404', routePath: '404.tsx' }),
        expect.objectContaining({ routeId: '/_app', routePath: '_app.tsx' }),
      ]),
      expect.any(Map),
      expect.any(String),
    )
  })

  it('rejects duplicate normalized route IDs within one provider', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => ['docs/first.mdx', 'docs/second.mdx'],
          transformPath: (sourcePath) => ({
            path: `${sourcePath}.tsx`,
            routeId: './same',
          }),
          load: () => 'export default {}',
        },
      ],
    })

    await expect(registry.initialize(workspaceRoot)).rejects.toThrow(
      new RegExp(
        `duplicate routeSource.routeId: /same.*${workspaceRoot}/docs/first\\.mdx.*${workspaceRoot}/docs/second\\.mdx`,
      ),
    )
  })

  it('rejects duplicate normalized route IDs across providers', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => ['docs/first.mdx'],
          transformPath: () => ({ path: 'first.tsx', routeId: './same' }),
          load: () => 'export default {}',
        },
        {
          filter: 'content/**/*.md',
          glob: async () => ['content/second.md'],
          transformPath: () => ({ path: 'second.tsx', routeId: '/same/' }),
          load: () => 'export default {}',
        },
      ],
    })

    await expect(registry.initialize(workspaceRoot)).rejects.toThrow(
      new RegExp(
        `duplicate routeSource.routeId: /same.*${workspaceRoot}/docs/first\\.mdx.*${workspaceRoot}/content/second\\.md`,
      ),
    )
  })

  it('rejects duplicate normalized route paths across providers', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => ['docs/first.mdx'],
          transformPath: () => ({ path: './same.tsx', routeId: '/first' }),
          load: () => 'export default {}',
        },
        {
          filter: 'content/**/*.md',
          glob: async () => ['content/second.md'],
          transformPath: () => ({ path: 'same.tsx', routeId: '/second' }),
          load: () => 'export default {}',
        },
      ],
    })

    await expect(registry.initialize(workspaceRoot)).rejects.toThrow(
      new RegExp(
        `duplicate routeSource.routePath: same.tsx.*${workspaceRoot}/docs/first\\.mdx.*${workspaceRoot}/content/second\\.md`,
      ),
    )
  })

  it('rejects duplicate normalized source paths across providers', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          glob: async () => ['docs/shared.mdx'],
          transformPath: () => ({ path: 'first.tsx', routeId: '/first' }),
          load: () => 'export default {}',
        },
        {
          filter: 'content/**/*.md',
          glob: async () => ['docs/shared.mdx'],
          transformPath: () => ({ path: 'second.tsx', routeId: '/second' }),
          load: () => 'export default {}',
        },
      ],
    })

    const sourcePath = `${workspaceRoot}/docs/shared.mdx`
    await expect(registry.initialize(workspaceRoot)).rejects.toThrow(
      new RegExp(`duplicate routeSource.sourcePath: ${sourcePath}.*${sourcePath}`),
    )
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
      routeSources: [
        {
          filter: 'docs/pages/**/*',
          glob: async () => ['docs/pages/_app.tsx', 'docs/pages/button.mdx'],
          transformPath: (path) => ({
            path: path.endsWith('_app.tsx') ? '_app.tsx' : '(general)/button.tsx',
            routeId: path.endsWith('_app.tsx') ? '/' : '/button',
          }),
          load: () => 'export default {}',
          watch: ['docs/config'],
        },
      ],
    })

    await registry.initialize(workspaceRoot)

    const change = await registry.markChanged(join(workspaceRoot, 'docs/config/routes.ts'))

    expect(change).toMatchObject({
      matched: true,
      structureChanged: false,
    })
    expect(change.changedModuleIds).toStrictEqual([
      normalizePath(join(workspaceRoot, 'docs/pages/_app.tsx-sfr.tsx')),
      normalizePath(join(workspaceRoot, 'docs/pages/button.mdx-sfr.tsx')),
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
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          transformPath: (path) => ({ path: path.replace(/\.mdx$/, '.tsx') }),
          load: () => 'export default {}',
        },
      ],
    })

    await registry.initialize(workspaceRoot)

    expect(generateDefinition).toHaveBeenCalledWith(
      [
        {
          routeId: '/docs/button',
          routePath: 'docs/button.tsx',
          moduleId: normalizePath(join(workspaceRoot, 'docs/button.mdx-sfr.tsx')),
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
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          transformPath: (path) => ({ path: path.replace(/\.mdx$/, '.tsx') }),
          load: () => 'export default {}',
        },
      ],
    })

    await registry.initialize(workspaceRoot)

    expect(registry.getWatchFiles()).toStrictEqual([normalizePath(join(workspaceRoot, 'docs'))])
    expect(generateDefinition).toHaveBeenLastCalledWith(
      [
        {
          routeId: '/docs/button',
          routePath: 'docs/button.tsx',
          moduleId: normalizePath(join(workspaceRoot, 'docs/button.mdx-sfr.tsx')),
          sourcePath: normalizePath(join(workspaceRoot, 'docs/button.mdx')),
        },
      ],
      expect.any(Map),
      normalizePath(join(workspaceRoot, 'src/pages')),
    )

    writeFileSync(join(workspaceRoot, 'docs/input.mdx'), '# Input')

    await expect(registry.addFile(join(workspaceRoot, 'docs/input.mdx'))).resolves.toMatchObject({
      matched: true,
    })
  })

  it('filters custom watch globs and exclusions', async () => {
    const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-registry-')))
    tempDirs.push(workspaceRoot)
    const registry = new RouteRegistry({
      pagesDir: 'src/pages',
      ignore: [],
      output: 'src/routes.d.ts',
      inheritance: { enabled: true, inheritLoading: true, inheritError: true },
      routeSources: [
        {
          filter: 'docs/**/*.mdx',
          transformPath: () => ({ path: 'button.tsx', routeId: '/button' }),
          load: () => 'export default {}',
          watch: ['docs/**/*.mdx', '!docs/private/**'],
        },
      ],
    })

    await registry.initialize(workspaceRoot)
    await expect(
      registry.markChanged(join(workspaceRoot, 'docs/config.ts')),
    ).resolves.toMatchObject({ matched: false })
    await expect(
      registry.markChanged(join(workspaceRoot, 'docs/private/config.mdx')),
    ).resolves.toMatchObject({ matched: false })
    await expect(
      registry.markChanged(join(workspaceRoot, 'docs/button.mdx')),
    ).resolves.toMatchObject({ matched: true })
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
      routeSources: [
        {
          filter: 'docs/pages/**/*',
          glob: async () => ['docs/pages/button.mdx'],
          transformPath: () => ({ path: '(general)/button.tsx', routeId: '/button' }),
          load: () => undefined,
        },
      ],
    })

    await registry.initialize(workspaceRoot)

    await expect(
      registry.loadRouteSourceModule(
        normalizePath(join(workspaceRoot, 'docs/pages/button.mdx-sfr.tsx')),
      ),
    ).rejects.toThrow('routeSource.load returned no code for routeId: /button')
  })
})
