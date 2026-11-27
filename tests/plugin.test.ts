import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineMdastPlugin } from 'satteri'
import type { Plugin } from 'vite'
import { describe, expect, it, vi } from 'vitest'

import { VID_EXTRACT, VID_MDX_ROUTE } from '../src/const'
import { createMdxPlugin } from '../src/mdx/plugin'
import type { MdxOptions } from '../src/mdx/router'
import { CompositeFileSystemRouter, DefaultFileSystemRouter, fileRouter } from '../src/plugin'

function flattenPlugins(option: unknown): Array<Plugin> {
  if (Array.isArray(option)) {
    return option.flatMap(flattenPlugins)
  }
  return option && typeof option === 'object' ? [option as Plugin] : []
}

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `sfr-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('fileRouter SSR configEnvironment', () => {
  it('injects noExternal for server environments and codeSplitting: false for SSG SSR builds', () => {
    const plugins = flattenPlugins(fileRouter({ ssg: true }))
    const rootPlugin = plugins.find((p) => p.name === 'solid-file-router:root')!
    const configEnv = rootPlugin.configEnvironment as (
      name: string,
      config: { consumer?: string },
      env: { command: string },
    ) => any

    expect(configEnv('client', { consumer: 'client' }, { command: 'build' })).toBeUndefined()
    expect(configEnv('ssr', { consumer: 'server' }, { command: 'serve' })).toEqual({
      resolve: { noExternal: ['solid-file-router'] },
    })
    expect(configEnv('ssr', { consumer: 'server' }, { command: 'build' })).toEqual({
      resolve: { noExternal: ['solid-file-router'] },
      build: {
        rolldownOptions: {
          output: { codeSplitting: false },
        },
      },
    })
  })

  it('does not set codeSplitting: false when ssg is disabled or enable is false', () => {
    for (const ssg of [undefined, false, { enable: false }] as const) {
      const plugins = flattenPlugins(fileRouter({ ssg }))
      const rootPlugin = plugins.find((p) => p.name === 'solid-file-router:root')!
      const configEnv = rootPlugin.configEnvironment as (
        name: string,
        config: { consumer?: string },
        env: { command: string },
      ) => any

      expect(configEnv('ssr', { consumer: 'server' }, { command: 'build' })).toEqual({
        resolve: { noExternal: ['solid-file-router'] },
      })
    }
  })

  it('keeps codeSplitting: false on SSR build when ssg.enable is build-only', () => {
    const plugins = flattenPlugins(fileRouter({ ssg: { enable: 'build-only' } }))
    const rootPlugin = plugins.find((p) => p.name === 'solid-file-router:root')!
    const configEnv = rootPlugin.configEnvironment as (
      name: string,
      config: { consumer?: string },
      env: { command: string },
    ) => any

    expect(configEnv('ssr', { consumer: 'server' }, { command: 'build' })).toEqual({
      resolve: { noExternal: ['solid-file-router'] },
      build: {
        rolldownOptions: {
          output: { codeSplitting: false },
        },
      },
    })
  })
})

describe('compositeFileSystemRouter and multi-dir pagesDir', () => {
  it('scans multiple directories via glob arrays and delegates to owning child router', async () => {
    const root = await createTempDir()
    try {
      const routesDir = join(root, 'routes')
      const pagesDir = join(root, 'pages')
      await mkdir(join(pagesDir, 'docs'), { recursive: true })
      await mkdir(routesDir, { recursive: true })
      await writeFile(join(routesDir, '_app.tsx'), 'export default function App() { return null }')
      await writeFile(
        join(routesDir, 'index.tsx'),
        'export default function Home() { return null }',
      )
      await writeFile(join(routesDir, 'helper.ts'), 'export const x = 1')
      await writeFile(join(pagesDir, 'docs/intro.mdx'), '# Intro')
      await writeFile(join(pagesDir, 'docs/preview.tsx'), 'export default function Preview() {}')

      const composite = new CompositeFileSystemRouter([
        new DefaultFileSystemRouter({
          dir: routesDir,
          extensions: ['ts', 'tsx'],
          ignore: ['helper.ts'],
        }),
        new DefaultFileSystemRouter({
          dir: pagesDir,
          extensions: ['md', 'mdx'],
        }),
      ])

      const globs = composite.glob()
      expect(Array.isArray(globs)).toBe(true)
      expect(globs).toHaveLength(2)

      const routes = await composite.getRoutes()
      const paths = routes.map((r) => r.path)
      expect(paths).toContain('/(app)')
      expect(paths).toContain('/(app)/')
      expect(paths).toContain('/(app)/docs/intro')
      expect(paths).not.toContain('/(app)/docs/preview')
      expect(composite.relativePath(join(pagesDir, 'docs/intro.mdx'))).toBe('docs/intro')
      expect(composite.toPath(join(pagesDir, 'docs/intro.mdx'))).toBe('/(app)/docs/intro')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('supports eager option in fileRouter and multi-dir pagesDir', async () => {
    const root = await createTempDir()
    try {
      const routesDir = join(root, 'routes')
      const pagesDir = join(root, 'pages')
      await mkdir(routesDir, { recursive: true })
      await mkdir(pagesDir, { recursive: true })
      await writeFile(join(routesDir, '_app.tsx'), 'export default function App() { return null }')
      await writeFile(
        join(routesDir, 'index.tsx'),
        'export default function Home() { return null }',
      )
      await writeFile(join(pagesDir, 'about.mdx'), '# About')

      const plugins = flattenPlugins(
        fileRouter({
          pagesDir: [{ dir: 'routes' }, { dir: 'pages', extensions: ['md', 'mdx'] }],
          mdx: true,
          eager: ['/(app)', '/'],
        }),
      )
      const rootPlugin = plugins.find((p) => p.name === 'solid-file-router:root')!
      ;(rootPlugin.config as (c: { root: string }) => void)({ root })

      const routesPlugin = plugins.find((p) => p.name === 'solid-file-router:routes')!
      const loadHook = routesPlugin.load as {
        handler: (this: unknown, id: string) => Promise<string | undefined>
      }
      const loaded = await loadHook.handler.call(
        { environment: { name: 'client', mode: 'build', config: { root, consumer: 'client' } } },
        VID_EXTRACT,
      )

      expect(loaded).toContain('import * as routeModule')
      // _app and index are eager (require), about is lazy (import)
      expect(loaded).toContain('"require":() => (routeModule0)')
      expect(loaded).toContain('"require":() => (routeModule1)')
      expect(loaded).toContain("import('")
      expect(loaded).toContain('about.mdx')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('mDX plugin caching and MdxLoadContext', () => {
  it('deduplicates compilation across $$route load and component transform and resolves path/routePath', async () => {
    const root = await createTempDir()
    try {
      const mdxFile = join(root, 'pages/docs/index.mdx')
      await mkdir(join(root, 'pages/docs'), { recursive: true })
      const source = '---\ntitle: Docs\n---\n\n# Hello\n'
      await writeFile(mdxFile, source)

      const extendLoad = vi.fn<NonNullable<MdxOptions['extendLoad']>>((_doc, ctx) => ({
        routeConfig: { info: { path: ctx.path, routePath: ctx.routePath } as any },
      }))

      const plugin = createMdxPlugin({ extendLoad }, () => ({
        path: 'docs/index',
        routePath: '/docs',
      }))
      ;(plugin.configResolved as (c: { root: string }) => void)({ root })

      const resolveIdHook = plugin.resolveId as {
        handler: (id: string) => string | undefined
      }
      const loadHook = plugin.load as {
        handler: (id: string) => Promise<string | undefined>
      }
      const resolvedRouteId = resolveIdHook.handler(`${VID_MDX_ROUTE}${mdxFile}`)!
      const routeCode = await loadHook.handler(resolvedRouteId)
      const transformHandler = (
        plugin.transform as { handler: (c: string, id: string) => Promise<string | undefined> }
      ).handler
      const componentCode = await transformHandler(source, mdxFile)

      // Both $$route load and component transform share a single compilation!
      expect(extendLoad).toHaveBeenCalledTimes(1)
      expect(extendLoad.mock.calls[0]![1]).toEqual({
        path: 'docs/index',
        routePath: '/docs',
        sourcePath: mdxFile.replaceAll('\\', '/'),
      })
      expect(routeCode).toContain('export const route')
      expect(routeCode).not.toContain('export default')
      expect(componentCode).toContain('export default')

      // Invalidating via handleHotUpdate triggers recompilation
      await (plugin.handleHotUpdate as (ctx: { file: string }) => Promise<void>)({ file: mdxFile })
      await transformHandler(source, mdxFile)
      expect(extendLoad).toHaveBeenCalledTimes(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('inlines MDX $$route configs into virtual:routes via extendRoute and only invalidates on routeConfig changes', async () => {
    const root = await createTempDir()
    try {
      const pagesDir = join(root, 'src/pages')
      await mkdir(pagesDir, { recursive: true })
      const mdxFile = join(pagesDir, 'guide.mdx')
      await writeFile(mdxFile, '---\ntitle: Guide v1\n---\n\nBody v1\n')

      const extendLoad = vi.fn<NonNullable<MdxOptions['extendLoad']>>(() => ({
        routeConfig: { info: { title: 'Full' } as any },
      }))
      const extendRoute = vi.fn<NonNullable<MdxOptions['extendRoute']>>((doc) => ({
        info: { title: String(doc.frontmatter.title) } as any,
      }))
      const mdastPlugin = vi.fn<() => ReturnType<typeof defineMdastPlugin>>(() =>
        defineMdastPlugin({ name: 'unused-on-route', heading() {} }),
      )

      const plugins = flattenPlugins(
        fileRouter({
          pagesDir: 'src/pages',
          mdx: {
            extendLoad,
            extendRoute,
            mdastPlugins: [mdastPlugin],
          },
        }),
      )
      const rootPlugin = plugins.find((p) => p.name === 'solid-file-router:root')!
      ;(rootPlugin.config as (c: { root: string }) => void)({ root })

      const routesPlugin = plugins.find((p) => p.name === 'solid-file-router:routes')!
      const routesLoad = routesPlugin.load as {
        handler: (this: unknown, id: string) => Promise<string | undefined>
      }
      const manifestCode = await routesLoad.handler.call(
        { environment: { name: 'client', mode: 'serve', config: { root, consumer: 'client' } } },
        VID_EXTRACT,
      )

      expect(manifestCode).toContain('"title": "Guide v1"')
      expect(manifestCode).not.toContain('.sfr-mdx-route')
      expect(extendRoute).toHaveBeenCalledTimes(1)
      expect(extendLoad).not.toHaveBeenCalled()
      expect(mdastPlugin).not.toHaveBeenCalled()

      const mdxPlugin = plugins.find((p) => p.name === 'solid-file-router:mdx')!
      const invalidateModule = vi.fn<() => void>()
      const reloadModule = vi.fn<() => void>()
      const fakeServer = {
        environments: {
          client: {
            name: 'client',
            moduleGraph: { getModuleById: () => ({ id: VID_EXTRACT }), invalidateModule },
            reloadModule,
          },
        },
      }
      const handleHotUpdate = mdxPlugin.handleHotUpdate as (ctx: {
        file: string
        server: unknown
      }) => Promise<void>

      // Body-only edit leaves routeConfig unchanged -> virtual:routes is not invalidated
      await writeFile(mdxFile, '---\ntitle: Guide v1\n---\n\nBody v2\n')
      await handleHotUpdate({ file: mdxFile, server: fakeServer })
      expect(invalidateModule).not.toHaveBeenCalled()

      // Frontmatter edit changes routeConfig -> virtual:routes is invalidated and reloaded
      await writeFile(mdxFile, '---\ntitle: Guide v2\n---\n\nBody v2\n')
      await handleHotUpdate({ file: mdxFile, server: fakeServer })
      expect(invalidateModule).toHaveBeenCalledTimes(1)
      expect(reloadModule).toHaveBeenCalledTimes(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
