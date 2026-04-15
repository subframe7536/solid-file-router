import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as tsdownBuild } from 'tsdown'
import { build } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { describe, expect, it, vi } from 'vitest'

import { logger } from '../src/const'

type FileRouterFn = typeof import('../src').fileRouter

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/modes/basic', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST_PLUGIN_PATH = fileURLToPath(new URL('../dist/plugin.mjs', import.meta.url))
const DIST_RUNTIME_PATH = fileURLToPath(new URL('../dist/index.mjs', import.meta.url))
let cachedFileRouter: FileRouterFn | undefined

async function getBuiltFileRouter() {
  if (!existsSync(DIST_PLUGIN_PATH)) {
    await tsdownBuild({ cwd: REPO_ROOT })
  }
  if (!cachedFileRouter) {
    const mod = (await import(DIST_PLUGIN_PATH)) as { fileRouter: FileRouterFn }
    cachedFileRouter = mod.fileRouter
  }
  return cachedFileRouter
}

function resolveClientEntryCode(outDir: string) {
  const indexHtmlPath = join(outDir, 'index.html')
  expect(existsSync(indexHtmlPath)).toBe(true)
  const html = readFileSync(indexHtmlPath, 'utf-8')
  const scriptTag = html.match(/<script[^>]*type=['"]module['"][^>]*>/)?.[0]
  expect(scriptTag).toBeDefined()
  const match = scriptTag?.match(/src=['"]([^'"]+\.js)['"]/)
  expect(match?.[1]).toBeDefined()
  const jsPath = join(outDir, match![1]!.replace(/^\//, ''))
  return readFileSync(jsPath, 'utf-8')
}

async function buildModeFixture({
  ssr,
  ssg,
}: {
  ssr?: boolean
  ssg?: boolean
}) {
  const fileRouter = await getBuiltFileRouter()
  const suffix = randomUUID()
  const outDirName = `.tmp-dist-${suffix}`
  const outputPath = `src/routes-${suffix}.d.ts`
  await build({
    configFile: false,
    root: FIXTURE_ROOT,
    logLevel: 'silent',
    resolve: {
      alias: {
        'solid-file-router': DIST_RUNTIME_PATH,
      },
    },
    plugins: [
      solidPlugin(ssr ? { ssr: true } : {}),
      ...fileRouter({
        output: outputPath,
        ssg: ssg ? { routes: ['/'] } : undefined,
      }),
    ],
    build: {
      outDir: outDirName,
      minify: false,
    },
  })
  return {
    outDir: join(FIXTURE_ROOT, outDirName),
    outputPath: join(FIXTURE_ROOT, outputPath),
  }
}

describe('fileRouter vite build fixtures', () => {
  it('builds SPA mode without prerendering when solid ssr is disabled', async () => {
    const { outDir, outputPath } = await buildModeFixture({})
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('render(component, element)')
      expect(code).toContain('"_$HY"in window?hydrate:render')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSR mode when solid ssr is enabled', async () => {
    const { outDir, outputPath } = await buildModeFixture({ ssr: true })
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('render(component, element)')
      expect(code).toContain('hydrate(component, element)')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSG mode with prerendered slot output when solid ssr is enabled', async () => {
    const { outDir, outputPath } = await buildModeFixture({ ssr: true, ssg: true })
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('render(component, element)')
      expect(code).toContain('hydrate(component, element)')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).toContain('mode-fixture-home')
      expect(html).toContain('_$HY')
      expect(existsSync(join(outDir, '404.html'))).toBe(true)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('warns and skips prerendering when ssg is configured without solid ssr', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const { outDir, outputPath } = await buildModeFixture({ ssg: true })
    try {
      expect(warnSpy).toHaveBeenCalledWith(
        'SSG config was ignored because vite-plugin-solid is not configured with { ssr: true }',
        { timestamp: true },
      )
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
      expect(existsSync(join(outDir, '404.html'))).toBe(false)
    } finally {
      warnSpy.mockRestore()
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })
})
