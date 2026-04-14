import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
import { describe, expect, it } from 'vitest'

type Mode = 'spa' | 'ssr' | 'ssg'
type FileRouterFn = typeof import('../src').fileRouter

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/modes/basic', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST_PLUGIN_PATH = fileURLToPath(new URL('../dist/plugin.mjs', import.meta.url))
const DIST_RUNTIME_PATH = fileURLToPath(new URL('../dist/index.mjs', import.meta.url))

let cachedFileRouter: FileRouterFn | undefined

async function getBuiltFileRouter() {
  if (!existsSync(DIST_PLUGIN_PATH)) {
    execFileSync('npx', ['tsdown'], { cwd: REPO_ROOT, stdio: 'pipe' })
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
  const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/)
  expect(match?.[1]).toBeDefined()
  const jsPath = join(outDir, match![1]!.replace(/^\//, ''))
  return readFileSync(jsPath, 'utf-8')
}

async function buildModeFixture(mode: Mode) {
  const fileRouter = await getBuiltFileRouter()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const outDirName = `.tmp-dist-${mode}-${suffix}`
  const outputPath = `src/routes-${mode}-${suffix}.d.ts`
  await build({
    configFile: false,
    root: FIXTURE_ROOT,
    logLevel: 'silent',
    resolve: {
      alias: {
        'solid-file-router': DIST_RUNTIME_PATH,
      },
    },
    plugins: fileRouter({
      mode,
      output: outputPath,
      ssg: mode === 'ssg' ? { routes: ['/'] } : undefined,
    }),
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
  it('builds SPA mode with render() client entry', async () => {
    const { outDir, outputPath } = await buildModeFixture('spa')
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('render(component, element)')
      expect(code).not.toContain('hydrate(component, element)')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSR mode with hydrate() client entry', async () => {
    const { outDir, outputPath } = await buildModeFixture('ssr')
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('hydrate(component, element)')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSG mode with hydrate() client entry and prerendered output', async () => {
    const { outDir, outputPath } = await buildModeFixture('ssg')
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('hydrate(component, element)')
      const html = readFileSync(join(outDir, 'index.html'), 'utf-8')
      expect(html).toContain('mode-fixture-home')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })
})
