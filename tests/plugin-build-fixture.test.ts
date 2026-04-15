import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build as tsdownBuild } from 'tsdown'
import { build, createBuilder, type InlineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { describe, expect, it } from 'vitest'

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
  // Vite build emits a module script entry tag in index.html.
  const scriptTag = html.match(/<script[^>]*type=['"]module['"][^>]*>/)?.[0]
  expect(scriptTag).toBeDefined()
  const match = scriptTag?.match(/src=['"]([^'"]+\.js)['"]/)
  expect(match?.[1]).toBeDefined()
  const jsPath = join(outDir, match![1]!.replace(/^\//, ''))
  return readFileSync(jsPath, 'utf-8')
}

/**
 * Build a fixture with the given options.
 *
 * - No extra options → SPA (render): plain `vite build`
 * - `withSSREnv: true` → SSR (hydrate): plain `vite build` with an SSR environment
 *   registered in the config so the plugin auto-infers hydrate mode from `configResolved`
 * - `ssg` config → SSG (hydrate + prerender): `vite build --app` using SSG plugin
 */
async function buildFixture(opts: {
  ssg?: { routes: string[] }
  withSSREnv?: boolean
}) {
  const fileRouter = await getBuiltFileRouter()
  const suffix = randomUUID()
  const outDirName = `.tmp-dist-${suffix}`
  const outputPath = `src/routes-${suffix}.d.ts`

  const base: InlineConfig = {
    configFile: false,
    root: FIXTURE_ROOT,
    logLevel: 'silent',
    resolve: {
      alias: {
        'solid-file-router': DIST_RUNTIME_PATH,
      },
    },
    plugins: [solidPlugin(), ...fileRouter({ output: outputPath, ssg: opts.ssg })],
    build: {
      outDir: outDirName,
      minify: false,
    },
  }

  if (opts.ssg) {
    // SSG: use Vite's builder API so both client and SSR environments are
    // built.  The SSG plugin's closeBundle fires after the SSR build to run
    // prerendering.
    const builder = await createBuilder(base)
    await builder.buildApp()
  } else if (opts.withSSREnv) {
    // SSR auto-inference: register an SSR environment in the Vite config so
    // that configResolved sees it and enables hydrate mode on the client build.
    // We only build the client here (plain `vite build`), which is enough to
    // verify that the client entry uses hydrate().
    await build({
      ...base,
      environments: {
        ssr: {
          build: {
            rolldownOptions: { input: join(FIXTURE_ROOT, 'src/entry-server.tsx') },
          },
        },
      },
    })
  } else {
    await build(base)
  }

  return {
    outDir: join(FIXTURE_ROOT, outDirName),
    outputPath: join(FIXTURE_ROOT, outputPath),
  }
}

describe('fileRouter vite build fixtures', () => {
  it('builds SPA mode with render() client entry', async () => {
    const { outDir, outputPath } = await buildFixture({})
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
    const { outDir, outputPath } = await buildFixture({ withSSREnv: true })
    try {
      const code = resolveClientEntryCode(outDir)
      expect(code).toContain('hydrate(component, element)')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
      rmSync(outputPath, { force: true })
    }
  })

  it('builds SSG mode with hydrate() client entry and prerendered output', async () => {
    const { outDir, outputPath } = await buildFixture({ ssg: { routes: ['/'] } })
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
