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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineRouteProvider, fileRouter, renderTemplate } from '../src/plugin'

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

async function buildTempSsgProject(
  serverEntry?: string,
  routes: readonly string[] = ['/'],
  mdx = false,
) {
  const root = createTempProject()
  if (mdx) {
    writeFileSync(
      join(root, 'src/pages/docs.mdx'),
      `export const route = {
  info: { title: 'MDX docs' },
  preload: () => Promise.resolve(),
  loadingComponent: () => <span>mdx-loading</span>,
}

# MDX descendant`,
    )
  }
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
      `import { createServerEntry } from 'solid-file-router'

export default createServerEntry((props) => (
  <p data-custom-url={props.url}>custom-server-entry</p>
))
`,
    )
  }

  const routerPlugins = fileRouter({
    ...(mdx ? { mdx: true } : {}),
    ssg: {
      ...(serverEntry ? { serverEntry } : {}),
      routes,
    },
  })

  const virtualRoutesPlugin = routerPlugins.find(({ name }) => name.endsWith(':router'))!
  const routeTransformPlugin = routerPlugins.find(({ name }) => name.endsWith(':router'))!
  const builder = await createBuilder({
    configFile: false,
    root,
    resolve: {
      alias: [
        {
          find: 'solid-file-router/mdx',
          replacement: fileURLToPath(new URL('../src/mdx/index.ts', import.meta.url)),
        },
        {
          find: 'solid-file-router',
          replacement: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
        },
        {
          find: 'solid-js',
          replacement: fileURLToPath(new URL('../node_modules/solid-js', import.meta.url)),
        },
        {
          find: '@solidjs/router',
          replacement: fileURLToPath(new URL('../node_modules/@solidjs/router', import.meta.url)),
        },
      ],
    },
    plugins: [solidPlugin({ ssr: true }), ...routerPlugins],
  })
  await builder.buildApp()
  const mdxRouteModuleId = normalizePath(`${join(root, 'src/pages/docs.mdx')}-sfr.tsx`)
  const mdxRouteModule = mdx
    ? await (virtualRoutesPlugin as any).load.handler(mdxRouteModuleId)
    : undefined
  const mdxRouteQuery = mdx
    ? (
        await (routeTransformPlugin as any).transform.handler(
          mdxRouteModule,
          `${mdxRouteModuleId}?route`,
        )
      ).code
    : undefined
  return {
    indexHtml: readFileSync(join(root, 'dist/client/index.html'), 'utf8'),
    fallbackHtml: readFileSync(join(root, 'dist/client/404.html'), 'utf8'),
    docsHtml: mdx ? readFileSync(join(root, 'dist/client/docs.html'), 'utf8') : undefined,
    mdxRouteQuery,
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
  const plugins = fileRouter({ pagesDir, ignore: [], lazy })
  const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
  await (registryPlugin as any).configResolved({ build: { ssr: false }, root })
  return plugins.find(({ name }) => name.endsWith(':router')) as any
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
  it('returns focused plugins for each enabled feature', () => {
    expect(fileRouter({ ssg: {} }).map(({ name }) => name)).toStrictEqual([
      'solid-file-router:router',
      'solid-file-router:mdx',
      'solid-file-router:ssg',
    ])
  })

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

    expect(module).toContain("import { createComponent, mergeProps } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).not.toContain('lazy(() => import(')
  })

  it('respects lazy: true even in an SSR build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, true)

    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(module).toContain("import { Router } from '@solidjs/router'")
    expect(module).toContain('lazy(() => import(')
  })

  it('keeps loader boundaries in default client and SSR definitions', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root)
    const clientModule = await plugin.load.handler(undefined, { ssr: false })
    const ssrModule = await plugin.load.handler(undefined, { ssr: true })

    expect(clientModule).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(clientModule).toContain("import { __loader__ } from 'solid-file-router'")
    expect(clientModule).toContain('__loader__(lazy(() => import(')
    expect(ssrModule).toContain("import { createComponent, mergeProps } from 'solid-js'")
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

    expect(module).toContain(`${normalizePath(join(root, 'app/routes/index.tsx-sfr.tsx'))}?route`)
  })

  it('does not scan Markdown when mdx is disabled', async () => {
    const root = createTempProject()
    writeFileSync(join(root, 'src/pages/content.md'), '# Content')
    writeFileSync(join(root, 'src/pages/content.mdx'), '# Content')
    const plugin = await createPlugin(root)

    const module = await plugin.load.handler()

    expect(module).not.toContain('content.md')
    expect(module).not.toContain('content.mdx')
  })

  it('scans and compiles Markdown when mdx is enabled', async () => {
    const root = createTempProject()
    const mdxPath = join(root, 'src/pages/content.mdx')
    const markdownPath = join(root, 'src/pages/markdown.md')
    writeFileSync(
      mdxPath,
      `export const route = {
  info: { title: 'Content' },
  preload: () => Promise.resolve(),
  matchFilters: () => true,
  inherit: false,
  loadingComponent: () => null,
  errorComponent: () => null,
}

# Content`,
    )
    writeFileSync(markdownPath, '# Markdown')
    const plugins = fileRouter({ mdx: true, lazy: false })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const module = await (plugin as any).load.handler()
    const routeModuleId = normalizePath(`${mdxPath}-sfr.tsx`)
    const routeModule = await (plugin as any).load.handler(routeModuleId)

    expect(module).toContain(`${routeModuleId}?comp`)
    expect(routeModule).toContain('export default createRoute')
    expect(routeModule).toContain('MDXContent')
    expect(routeModule).toContain('info: __sfr_mdx_route.info')
    expect(routeModule).toContain('preload: __sfr_mdx_route.preload')
    expect(routeModule).toContain('matchFilters: __sfr_mdx_route.matchFilters')
    expect(routeModule).toContain('inherit: __sfr_mdx_route.inherit')
    expect(routeModule).toContain('loadingComponent: __sfr_mdx_route.loadingComponent')
    expect(routeModule).toContain('errorComponent: __sfr_mdx_route.errorComponent')
    expect(routeModule).not.toContain('...__sfr_mdx_route')
    await expect(
      (plugin as any).load.handler(normalizePath(`${markdownPath}-sfr.tsx`)),
    ).resolves.toContain('MDXContent')
  })

  it.each(['md', 'mdx'])(
    'compiles directly imported .%s files when mdx is enabled',
    async (ext) => {
      const root = createTempProject()
      const markdownPath = join(root, `src/content.${ext}`)
      writeFileSync(markdownPath, "export const frontmatter = { title: 'Content' }\n\n# Content")
      const mdxPlugin = fileRouter({ mdx: true }).find(({ name }) => name.endsWith(':mdx'))!

      const result = await (mdxPlugin as any).transform.handler(
        readFileSync(markdownPath, 'utf8'),
        normalizePath(markdownPath),
      )

      expect(result.code).toContain('function MDXContent')
      expect(result.code).toContain('export const frontmatter')
      expect(result.code).toContain('export default MDXContent')
    },
  )

  it('disables the direct Markdown import plugin when mdx is disabled', () => {
    const mdxPlugin = fileRouter().find(({ name }) => name.endsWith(':mdx'))!

    expect((mdxPlugin as any).apply()).toBe(false)
  })

  it('extracts native MDX route configuration through route queries', async () => {
    const root = createTempProject()
    const mdxPath = join(root, 'src/pages/content.mdx')
    writeFileSync(
      mdxPath,
      `export const route = {
  info: { title: 'Content' },
  preload: () => Promise.resolve(),
  matchFilters: () => true,
  inherit: false,
  loadingComponent: () => <span>loading</span>,
  errorComponent: (props) => <span>{props.error.message}</span>,
  component: () => <h1>this component must be ignored</h1>,
}

# Content`,
    )
    const plugins = fileRouter({ mdx: true, lazy: false })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const transformPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })
    const moduleId = normalizePath(`${mdxPath}-sfr.tsx`)
    const routeModule = await (plugin as any).load.handler(moduleId)

    const route = (
      await (transformPlugin as any).transform.handler(routeModule, `${moduleId}?route`)
    ).code
    const component = (
      await (transformPlugin as any).transform.handler(routeModule, `${moduleId}?comp`)
    ).code

    expect(route).toContain('info: __sfr_mdx_route.info')
    expect(route).toContain('preload: __sfr_mdx_route.preload')
    expect(route).toContain('matchFilters: __sfr_mdx_route.matchFilters')
    expect(route).toContain('inherit: __sfr_mdx_route.inherit')
    expect(route).toContain('loadingComponent: __sfr_mdx_route.loadingComponent')
    expect(route).toContain('errorComponent: __sfr_mdx_route.errorComponent')
    expect(component).toContain('component: MDXContent')
    expect(component).not.toContain('component: __sfr_mdx_route.component')
    expect(component).not.toContain('info: __sfr_mdx_route.info')
  })

  it('uses a collision-safe fallback when an MDX module uses the reserved name', async () => {
    const root = createTempProject()
    const mdxPath = join(root, 'src/pages/content.mdx')
    writeFileSync(mdxPath, 'export const __sfr_mdx_route = {}\n\n# Content')
    const plugins = fileRouter({ mdx: true, lazy: false })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const routeModule = await (plugin as any).load.handler(normalizePath(`${mdxPath}-sfr.tsx`))

    expect(routeModule).toContain("const __sfr_mdx_route_1 = typeof route === 'undefined'")
    expect(routeModule).not.toContain("const __sfr_mdx_route = typeof route === 'undefined'")
  })

  it.each(['_app.md', '_app.mdx', 'nested/_layout.md', 'nested/_layout.mdx'])(
    'rejects MDX layout file %s',
    async (layoutFile) => {
      const root = createTempProject()
      const layoutPath = join(root, 'src/pages', layoutFile)
      mkdirSync(join(layoutPath, '..'), { recursive: true })
      writeFileSync(layoutPath, '# Layout')
      const plugins = fileRouter({ mdx: true, lazy: false })
      const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!

      await expect(
        (registryPlugin as any).configResolved({ build: { ssr: false }, root }),
      ).rejects.toThrow('Markdown/MDX files cannot be used as layouts')
    },
  )

  it('uses the plugin pagesDir as the default MDX directory', async () => {
    const root = createTempProject('app/routes')
    const mdxPath = join(root, 'app/routes/content.mdx')
    writeFileSync(mdxPath, '# Content')
    const plugins = fileRouter({ pagesDir: 'app/routes', mdx: true, lazy: false })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const module = await (plugin as any).load.handler()

    expect(module).toContain(normalizePath(`${mdxPath}-sfr.tsx?comp`))
  })

  it('preserves an explicit MDX pagesDir override', async () => {
    const root = createTempProject('app/routes')
    const mdxDir = join(root, 'content')
    const mdxPath = join(mdxDir, 'article.mdx')
    mkdirSync(mdxDir, { recursive: true })
    writeFileSync(mdxPath, '# Article')
    const plugins = fileRouter({
      pagesDir: 'app/routes',
      mdx: { pagesDir: 'content' },
      lazy: false,
    })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const module = await (plugin as any).load.handler()

    expect(module).toContain(normalizePath(`${mdxPath}-sfr.tsx?comp`))
  })

  it('supports route providers with generated route modules', async () => {
    const root = createTempProject()
    const buttonSourcePath = 'docs/pages/general/button.mdx'
    const buttonModuleId = normalizePath(join(root, 'docs/pages/general/button.mdx-sfr.tsx'))
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
    const plugins = fileRouter({
      lazy: false,
      routeProviders: [
        {
          filter: 'docs/pages/**/*',
          glob: async () => [buttonSourcePath, 'docs/routes/404.tsx'],
          transformPath: (sourcePath) => ({
            path: sourcePath.includes('button')
              ? '(general)/button.tsx'
              : sourcePath.split('/').pop()!,
            routeId: sourcePath.includes('button') ? '/button' : undefined,
          }),
          load: (entry) => modules.get(entry.routeId),
        },
      ],
    })

    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({
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

  it('returns generated route provider modules from the Vite hot update hook', async () => {
    const root = createTempProject()
    const sourcePath = join(root, 'docs/button.mdx')
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(sourcePath, '# Button')

    const plugins = fileRouter({
      routeProviders: [
        {
          filter: 'docs/**/*.mdx',
          transformPath: () => ({ path: 'button.tsx' }),
          load: () => 'export default {}',
        },
      ],
    })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const moduleId = normalizePath(`${sourcePath}-sfr.tsx`)
    const routeModule = { id: `${moduleId}?route` }
    const componentModule = { id: `${moduleId}?comp` }
    const send = vi.fn()
    const environment = {
      hot: { send },
      moduleGraph: {
        getModuleById: vi.fn((id: string) => {
          if (id === routeModule.id) {
            return routeModule
          }
          if (id === componentModule.id) {
            return componentModule
          }
        }),
      },
    }

    const modules = await (registryPlugin as any).hotUpdate.handler.call(
      { environment },
      {
        type: 'update',
        file: sourcePath,
        timestamp: 1,
        modules: [],
        server: {},
      },
    )

    expect(modules).toStrictEqual([routeModule, componentModule])
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the current Vite environment for explicit route reloads', async () => {
    const root = createTempProject()
    const sourcePath = join(root, 'docs/button.mdx')
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(sourcePath, '# Button')

    const plugins = fileRouter({
      reloadOnChange: true,
      routeProviders: [
        {
          filter: 'docs/**/*.mdx',
          transformPath: () => ({ path: 'button.tsx' }),
          load: () => 'export default {}',
        },
      ],
    })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const send = vi.fn()
    const modules = await (registryPlugin as any).hotUpdate.handler.call(
      {
        environment: {
          hot: { send },
          moduleGraph: { getModuleById: vi.fn() },
        },
      },
      {
        type: 'update',
        file: sourcePath,
        timestamp: 1,
        modules: [],
        server: {},
      },
    )

    expect(modules).toStrictEqual([])
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' })
  })

  it('infers typed provider data in load', async () => {
    const provider = defineRouteProvider<{ title: string }>({
      filter: 'docs/**/*.mdx',
      glob: async () => ['docs/button.mdx'],
      transformPath: () => ({ path: 'button.tsx', data: { title: 'Button' } }),
      load: ({ data }) =>
        data ? `export default { title: '${data.title}' }` : 'export default {}',
    })
    const root = createTempProject()
    const plugins = fileRouter({ routeProviders: [provider] })

    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({
      build: { ssr: false },
      root,
    })

    const moduleId = normalizePath(join(root, 'docs/button.mdx-sfr.tsx'))
    await expect((plugin as any).load.handler(moduleId)).resolves.toContain("title: 'Button'")
  })

  it('does not inject ssg config unless explicitly enabled', () => {
    const plugins = fileRouter()
    const configPlugin = plugins.find(({ name }) => name.endsWith(':ssg'))
    const config = configPlugin ? getBuildConfig(configPlugin) : undefined
    expect(config).toBeUndefined()
  })

  it('injects default ssg environment config when enabled', () => {
    const plugins = fileRouter({
      ssg: {},
    })
    const configPlugin = plugins.find(({ name }) => name.endsWith(':ssg'))
    const config = configPlugin ? getBuildConfig(configPlugin) : undefined
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

  it('builds mixed TSX and MDX routes with a TSX layout', async () => {
    const output = await buildTempSsgProject(undefined, ['/', '/docs'], true)

    expect(output.indexHtml).toContain('>home</h1>')
    expect(output.docsHtml).toContain('MDX descendant')
    expect(output.mdxRouteQuery).toContain('MDX docs')
    expect(output.mdxRouteQuery).toContain('info: __sfr_mdx_route.info')
    expect(output.mdxRouteQuery).toContain('preload: __sfr_mdx_route.preload')
    expect(output.mdxRouteQuery).toContain('loadingComponent: __sfr_mdx_route.loadingComponent')
  })

  it('uses a custom SSG server entry when configured', async () => {
    const output = await buildTempSsgProject('src/custom-server.tsx')
    expect(output.indexHtml).toContain('data-custom-url="/"')
    expect(output.indexHtml).toContain('custom-server-entry')
    expect(output.fallbackHtml).toContain('data-custom-url="/404"')
  })

  it('renders the fallback when /404 is explicitly listed or no routes are listed', async () => {
    const duplicateRouteOutput = await buildTempSsgProject(undefined, ['/404', '/'])
    expect(duplicateRouteOutput.fallbackHtml).toContain('>not-found-fallback</h1>')

    const emptyRouteOutput = await buildTempSsgProject(undefined, [])
    expect(emptyRouteOutput.fallbackHtml).toContain('>not-found-fallback</h1>')
  })

  it('respects custom ssg server entry and outDir', () => {
    const plugins = fileRouter({
      ssg: {
        serverEntry: 'app/entry-ssg.tsx',
      },
    })
    const configPlugin = plugins.find(({ name }) => name.endsWith(':ssg'))!
    const config = getBuildConfig(configPlugin, {
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
    const plugins = fileRouter({
      ssg: {},
    })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const solidWithSsr = createSolidPluginStub(
      'import { ssr as _$ssr } from "solid-js/web"; export default _$ssr',
    )

    await expect(
      (registryPlugin as any).configResolved({
        root,
        plugins: [solidWithSsr],
      }),
    ).resolves.toBeUndefined()
  })
})
