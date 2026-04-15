import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { glob } from 'tinyglobby'
import { build as tsdownBuild } from 'tsdown'
import { build } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { describe, expect, it } from 'vitest'

type FileRouterFn = typeof import('../src').fileRouter

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/modes/basic', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST_PLUGIN_PATH = fileURLToPath(new URL('../dist/plugin.mjs', import.meta.url))
const DIST_RUNTIME_PATH = fileURLToPath(new URL('../dist/index.mjs', import.meta.url))
let cachedFileRouter: FileRouterFn | undefined
let builtDist = false

async function getBuiltFileRouter() {
  if (!builtDist) {
    await tsdownBuild({ cwd: REPO_ROOT })
    builtDist = true
  }
  if (!cachedFileRouter) {
    const mod = (await import(DIST_PLUGIN_PATH)) as { fileRouter: FileRouterFn }
    cachedFileRouter = mod.fileRouter
  }
  return cachedFileRouter
}

async function resolveBuiltJS(outDir: string) {
  const jsFiles = await glob('**/*.js', { cwd: outDir, absolute: true })
  expect(jsFiles.length).toBeGreaterThan(0)
  return jsFiles.map((file) => readFileSync(file, 'utf-8')).join('\n')
}

async function buildModeFixture({ ssr, ssg }: { ssr?: boolean; ssg?: boolean }) {
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
      const code = await resolveBuiltJS(outDir)
      expect(code).toContain('Mount element with id')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
      expect(existsSync(join(outDir, '404.html'))).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSR mode when solid ssr is enabled', async () => {
    const { outDir, outputPath } = await buildModeFixture({ ssr: true })
    try {
      const code = await resolveBuiltJS(outDir)
      expect(code).toContain('Mount element with id')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
      expect(existsSync(join(outDir, '404.html'))).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSG mode with prerendered slot output when solid ssr is enabled', async () => {
    const { outDir, outputPath } = await buildModeFixture({ ssr: true, ssg: true })
    try {
      const code = await resolveBuiltJS(outDir)
      expect(code).toContain('Mount element with id')
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
    const { outDir, outputPath } = await buildModeFixture({ ssg: true })
    try {
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).not.toContain('mode-fixture-home')
      expect(existsSync(join(outDir, '404.html'))).toBe(false)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })
})
