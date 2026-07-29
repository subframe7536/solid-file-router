import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ConfigEnv, Plugin, UserConfig } from 'vite'
import { createBuilder, normalizePath } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { afterEach, describe, expect, it } from 'vitest'

import { defineRouteSource, fileRouter, renderTemplate } from '../src/index'

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

async function buildTempSsgProject(serverEntry?: string, routes: readonly string[] = ['/']) {
  const root = createTempProject()
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  )
  writeFileSync(
    join(root, 'src/index.tsx'),
    `import { FileRouter } from 'virtual:routes'
import { createClientEntry } from 'solid-file-router'

createClientEntry(() => <FileRouter />, document.getElementById('root')!)
`,
  )
  writeFileSync(
    join(root, 'src/pages/404.tsx'),
    `import { createRoute } from 'solid-file-router'

export default createRoute({
  component: () => <h1>not-found-fallback</h1>,
})
`,
  )
  if (serverEntry) {
    writeFileSync(
      join(root, serverEntry),
      `export default ({ url }: { url: string }) => Promise.resolve('<p>custom:' + url + '</p>')
`,
    )
  }

  const builder = await createBuilder({
    configFile: false,
    root,
    resolve: {
      alias: {
        'solid-file-router': fileURLToPath(new URL('../src/runtime.ts', import.meta.url)),
        'solid-js': fileURLToPath(new URL('../node_modules/solid-js', import.meta.url)),
        '@solidjs/router': fileURLToPath(
          new URL('../node_modules/@solidjs/router', import.meta.url),
        ),
      },
    },
    plugins: [
      solidPlugin({ ssr: true }),
      fileRouter({
        ssg: {
          ...(serverEntry ? { serverEntry } : {}),
          routes,
        },
      }),
    ],
  })
  await builder.buildApp()
  return {
    indexHtml: readFileSync(join(root, 'dist/client/index.html'), 'utf8'),
    fallbackHtml: readFileSync(join(root, 'dist/client/404.html'), 'utf8'),
  }
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
  it.each([
    '<div id="root"></div>',
    '<div class="app" id="root">\n</div>',
    "<div id='root'></div>",
    '<main id="root"></main>',
    '<!--solid-file-router-outlet-->',
  ])('renders supported SSG outlet %s', (outlet) => {
    const html = `<html><head><title>app</title></head><body>${outlet}</body></html>`
    const rendered = renderTemplate(html, 'root', '<p>rendered</p>')
    expect(rendered).toContain('<p>rendered</p>')
    expect(rendered).toContain('<title>app</title>')
  })

  it('rejects duplicate SSG outlet markers', () => {
    expect(() =>
      renderTemplate(
        '<html><head></head><body><!--solid-file-router-outlet--><!--solid-file-router-outlet--></body></html>',
        'root',
        'app',
      ),
    ).toThrow('duplicate')
  })
  it('throws a helpful SSG error when the configured root id is missing', () => {
    const html = '<html><head></head><body><div id="app"></div></body></html>'

    expect(() => renderTemplate(html, 'root', '<main>app</main>')).toThrow(
      [
        '[solid-file-router] SSG could not find an outlet in index.html.',
        'Add <!--solid-file-router-outlet--> or an element with id="root".',
      ].join('\n'),
    )
  })

  it('respects lazy: false even in a client build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, false)
    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).toContain('get url()')
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
    expect(module).toContain('get url()')
    expect(module).toContain('lazy(() => import(')
  })

  it('keeps loader boundaries in default client and SSR definitions', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root)
    const clientModule = await plugin.load.handler(undefined, { ssr: false })
    const ssrModule = await plugin.load.handler(undefined, { ssr: true })

    expect(clientModule).toContain("import { createComponent, lazy } from 'solid-js'")
    expect(clientModule).toContain("import { __loader__ } from 'solid-file-router'")
    expect(clientModule).toContain('__loader__(lazy(() => import(')
    expect(ssrModule).toContain("import { createComponent } from 'solid-js'")
    expect(ssrModule).toContain("import { __loader__ } from 'solid-file-router'")
    expect(ssrModule).toContain('__loader__(')
    expect(ssrModule).not.toContain('__loader__(lazy(() => import(')
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

  it('infers typed custom source data in load', async () => {
    const source = defineRouteSource<{ title: string }>({
      scan: () => [
        {
          routePath: 'button.tsx',
          sourcePath: 'docs/button.mdx',
          data: { title: 'Button' },
        },
      ],
      load: ({ data }) =>
        data ? `export default { title: '${data.title}' }` : 'export default {}',
    })
    const root = createTempProject()
    const [plugin] = fileRouter({ routeSource: source })

    await (plugin as any).configResolved({
      build: { ssr: false },
      root,
    })

    const moduleId = normalizePath(join(root, 'docs/button.mdx.solid-file-router.tsx'))
    await expect((plugin as any).load.handler(moduleId)).resolves.toContain("title: 'Button'")
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
            ssr: true,
            rolldownOptions: {
              input: 'virtual:solid-file-router/prerender-entry',
            },
            copyPublicDir: false,
          },
        },
      },
    })
  })

  it('builds SSG with the internal renderer by default', async () => {
    const output = await buildTempSsgProject()
    expect(output.indexHtml).toContain('>home</h1>')
    expect(output.fallbackHtml).toContain('>not-found-fallback</h1>')
    expect(output.fallbackHtml).toContain('_$HY')
  })

  it('uses a custom SSG server entry when configured', async () => {
    const output = await buildTempSsgProject('src/custom-server.ts')
    expect(output.indexHtml).toContain('custom:/')
    expect(output.fallbackHtml).toContain('custom:/404')
  })

  it('renders the fallback when /404 is explicitly listed or no routes are listed', async () => {
    const duplicateRouteOutput = await buildTempSsgProject(undefined, ['/404', '/'])
    expect(duplicateRouteOutput.fallbackHtml).toContain('>not-found-fallback</h1>')

    const emptyRouteOutput = await buildTempSsgProject(undefined, [])
    expect(emptyRouteOutput.fallbackHtml).toContain('>not-found-fallback</h1>')
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
    expect((config as any).environments.ssr.build.rolldownOptions).toBeUndefined()
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
