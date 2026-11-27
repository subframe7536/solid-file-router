import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
      const loaded = await (routesPlugin.load as any).call(
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

      const resolvedRouteId = (plugin.resolveId as (id: string) => string | undefined)(
        `${VID_MDX_ROUTE}${mdxFile}`,
      )!
      const routeCode = await (plugin.load as (id: string) => Promise<string | undefined>)(
        resolvedRouteId,
      )
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
      ;(plugin.handleHotUpdate as (ctx: { file: string }) => void)({ file: mdxFile })
      await transformHandler(source, mdxFile)
      expect(extendLoad).toHaveBeenCalledTimes(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
