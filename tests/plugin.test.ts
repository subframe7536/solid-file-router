import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { normalizePath } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { fileRouter, renderTemplate } from '../src/index'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTempProject(routeRoot = 'src/pages') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-plugin-')))
  const pagesDir = join(root, routeRoot)

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

  writeFileSync(
    join(pagesDir, 'index.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
  )

  return root
}

function createTempProjectWithCustomRoot(customRoot: string, routeRoot = 'src/pages') {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'solid-file-router-plugin-')))
  const root = join(workspaceRoot, customRoot)
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

  writeFileSync(
    join(pagesDir, 'index.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>home</h1>,
})
`,
  )

  writeFileSync(
    join(pagesDir, 'about.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>about</h1>,
})
`,
  )

  return { workspaceRoot, root }
}

async function createPlugin(root: string, lazy?: boolean, pagesDir = 'src/pages') {
  const [plugin] = fileRouter({
    pagesDir,
    ignore: [],
    lazy,
  })

  await (plugin as any).configResolved({
    build: { ssr: false },
    root,
  })

  return plugin as any
}

function getBuildConfig(plugin: Plugin, userConfig: UserConfig = {}) {
  const configHook = plugin.config
  if (!configHook || typeof configHook !== 'function') {
    return
  }

  const env: ConfigEnv = { command: 'build', mode: 'production' }
  return configHook.call({} as never, userConfig, env)
}

function createSolidPluginStub(transformedCode: string): Plugin {
  return {
    name: 'solid',
    transform() {
      return {
        code: transformedCode,
      }
    },
  }
}

describe('fileRouter', () => {
  it('throws a helpful SSG error when the configured root id is missing', () => {
    const html = '<html><head></head><body><div id="app"></div></body></html>'

    expect(() => renderTemplate(html, 'root', '<main>app</main>')).toThrow(
      [
        '[solid-file-router] SSG could not find the app root element in index.html.',
        'Expected to find: <div id="root"></div>',
        "Either add that element to index.html, or set fileRouter({ ssg: { id: '...' } }) to match your root element id.",
      ].join('\n'),
    )
  })

  it('respects lazy: false even in a client build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, false)
    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent } from 'solid-js'")
    expect(module).toContain("import { StaticRouter } from '@solidjs/router'")
    expect(module).not.toContain('lazy(() => import(')
  })

  it('respects lazy: true even in an SSR build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, true)

    await plugin.configResolved({
      build: { ssr: true },
      root,
    })

    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent, lazy } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).toContain('lazy(() => import(')
  })

  it('supports a custom Vite root from config', async () => {
    const { workspaceRoot, root } = createTempProjectWithCustomRoot('apps/site')
    const plugin = await createPlugin(root, false)

    await plugin.load.handler()

    expect(existsSync(join(root, 'src/routes.d.ts'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'src/routes.d.ts'))).toBe(false)
  })

  it('supports a custom pagesDir from config', async () => {
    const { root } = createTempProjectWithCustomRoot('apps/site', 'app/routes')
    const plugin = await createPlugin(root, false, 'app/routes')

    const module = await plugin.load.handler()

    expect(module).toContain(`${normalizePath(join(root, 'app/routes/index.tsx'))}?route`)
  })

  it('supports custom route sources with generated route modules', async () => {
    const root = createTempProject()
    const buttonSourcePath = 'docs/pages/general/button.mdx'
    const buttonModuleId = normalizePath(
      join(root, 'docs/pages/general/button.mdx.solid-file-router.tsx'),
    )
    const modules = new Map([
      [
        '/',
        `import { createRoute } from 'solid-file-router'
export default createRoute({ component: (props) => <main>{props.children}</main> })
`,
      ],
      [
        '/button',
        `import { createRoute } from 'solid-file-router'
export default createRoute({ info: { title: 'Button' }, component: () => <h1>button</h1> })
`,
      ],
      [
        '/404',
        `import { createRoute } from 'solid-file-router'
export default createRoute({ component: () => <h1>missing</h1> })
`,
      ],
    ])
    const [plugin] = fileRouter({
      lazy: false,
      routeSource: {
        scan: () => [
          { routeId: '/', routePath: '_app.tsx', sourcePath: 'docs/routes/_app.tsx' },
          { routeId: '/button', routePath: '(general)/button.tsx', sourcePath: buttonSourcePath },
          { routeId: '/404', routePath: '404.tsx', sourcePath: 'docs/routes/404.tsx' },
        ],
        load: (entry) => modules.get(entry.routeId),
      },
    })

    await (plugin as any).configResolved({
      build: { ssr: false },
      root,
    })

    const module = await (plugin as any).load.handler()

    expect(module).toContain(`${buttonModuleId}?route`)
    expect(module).toContain(`${buttonModuleId}?comp`)
    expect(module).toContain('"id": "/button"')
    expect(module).toContain('"/button":')
    expect(module).toContain('"/404": __404_route.info')

    const routeModule = await (plugin as any).load.handler(buttonModuleId)
    expect(routeModule).toContain('title')
  })

  it('does not inject ssg config unless explicitly enabled', () => {
    const [plugin] = fileRouter()
    const config = getBuildConfig(plugin!)
    expect(config).toBeUndefined()
  })

  it('injects default ssg environment config when enabled', () => {
    const [plugin] = fileRouter({
      ssg: {},
    })
    const config = getBuildConfig(plugin!)
    expect(config).toMatchObject({
      build: { copyPublicDir: false },
      environments: {
        client: {
          build: { outDir: 'dist/client', copyPublicDir: true },
        },
        ssr: {
          build: {
            outDir: 'dist/server',
            ssr: 'src/entry-server.tsx',
            copyPublicDir: false,
          },
        },
      },
    })
  })

  it('respects custom ssg server entry and outDir', () => {
    const [plugin] = fileRouter({
      ssg: {
        serverEntry: 'app/entry-ssg.tsx',
      },
    })
    const config = getBuildConfig(plugin!, {
      environments: {
        client: { build: { outDir: 'build' } },
        ssr: { build: { outDir: 'build' } },
      },
    })
    expect(config).toMatchObject({
      environments: {
        client: {
          build: { outDir: 'build/client' },
        },
        ssr: {
          build: {
            outDir: 'build/server',
            ssr: 'app/entry-ssg.tsx',
          },
        },
      },
    })
  })

  it('throws helpful error when ssg is enabled without vite-plugin-solid', async () => {
    const root = createTempProject()
    const [plugin] = fileRouter({
      ssg: {},
    })

    await expect(
      (plugin as any).configResolved({
        root,
        plugins: [],
      }),
    ).rejects.toThrow(/missing vite-plugin-solid/)
  })

  it('throws helpful error when ssg is enabled without solid ssr transform', async () => {
    const root = createTempProject()
    const [plugin] = fileRouter({
      ssg: {},
    })
    const solidWithoutSsr = createSolidPluginStub('export default () => null')

    await expect(
      (plugin as any).configResolved({
        root,
        plugins: [solidWithoutSsr],
      }),
    ).rejects.toThrow(/must be configured with ssr: true/)
  })

  it('accepts ssg config when solid ssr transform is enabled', async () => {
    const root = createTempProject()
    const [plugin] = fileRouter({
      ssg: {},
    })
    const solidWithSsr = createSolidPluginStub(
      'import { ssr as _$ssr } from "solid-js/web"; export default _$ssr',
    )

    await expect(
      (plugin as any).configResolved({
        root,
        plugins: [solidWithSsr],
      }),
    ).resolves.toBeUndefined()
  })
})
