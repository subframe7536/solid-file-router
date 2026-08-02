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

function createTempProject(routeRoot = 'src/pages'): string {
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
  includeDraft = false,
  includeMetadata = false,
): Promise<any> {
  const root = createTempProject()
  if (includeMetadata) {
    writeFileSync(
      join(root, 'src/pages/index.tsx'),
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  metadata: {
    title: 'Home & Docs',
    description: 'Home <description>',
    canonical: 'https://example.com/home?a=1&b=2',
    meta: [{ property: 'og:title', content: 'Home "preview"' }],
    links: [{ rel: 'alternate', href: '/home?format=html' }],
  },
  component: () => <h1>home</h1>,
})
`,
    )
    writeFileSync(
      join(root, 'src/pages/about.tsx'),
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  metadata: {
    title: 'About',
    description: 'About page',
  },
  component: () => <h1>about</h1>,
})
`,
    )
    mkdirSync(join(root, 'src/pages/blog'), { recursive: true })
    writeFileSync(
      join(root, 'src/pages/blog/[slug].tsx'),
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  metadata: { title: 'Dynamic page' },
  component: () => <h1>dynamic</h1>,
})
`,
    )
  }
  if (mdx) {
    writeFileSync(
      join(root, 'src/pages/docs.mdx'),
      `---
info:
  title: MDX docs
---

# MDX descendant`,
    )
  }
  if (includeDraft) {
    writeFileSync(
      join(root, 'src/pages/draft.tsx'),
      `import { createRoute } from 'solid-file-router'

export default createRoute({
  draft: true,
  component: () => <h1>draft</h1>,
})
`,
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
  ${includeMetadata ? "metadata: { title: 'Not Found' }," : ''}
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
    aboutHtml:
      includeMetadata && existsSync(join(root, 'dist/client/about.html'))
        ? readFileSync(join(root, 'dist/client/about.html'), 'utf8')
        : undefined,
    dynamicHtml:
      includeMetadata && existsSync(join(root, 'dist/client/blog/hello.html'))
        ? readFileSync(join(root, 'dist/client/blog/hello.html'), 'utf8')
        : undefined,
    draftHtmlExists: existsSync(join(root, 'dist/client/draft.html')),
    mdxRouteQuery,
  }
}

function createTempProjectWithCustomRoot(
  customRoot: string,
  routeRoot = 'src/pages',
): { workspaceRoot: string; root: string } {
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

async function createPlugin(root: string, lazy?: boolean, pagesDir = 'src/pages'): Promise<any> {
  const plugins = fileRouter({ pagesDir, ignore: [], lazy })
  const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
  await (registryPlugin as any).configResolved({ build: { ssr: false }, root })
  return plugins.find(({ name }) => name.endsWith(':router')) as any
}

function getBuildConfig(plugin: Plugin, userConfig: UserConfig = {}): any {
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
    expect(rendered).not.toContain('data-solid-file-router-head-default')
  })

  it('replaces and inserts escaped route metadata in the document head', () => {
    const rendered = renderTemplate(
      '<html><head><title>base</title><meta name="description" content="old"><link rel="canonical" href="/old"></head><body><div id="root"></div></body></html>',
      'root',
      '<p>rendered</p>',
      {
        title: 'Page & <title>',
        description: 'Description "quoted"',
        canonical: 'https://example.com/a?x=1&y=2',
        meta: [{ property: 'og:title', content: 'Preview <page>' }],
        links: [{ rel: 'alternate', href: '/page?format=html' }],
      },
    )

    expect(rendered).toContain('<title>Page &amp; &lt;title&gt;</title>')
    expect(rendered).toContain('<meta name="description" content="Description &quot;quoted&quot;">')
    expect(rendered).toContain('<link rel="canonical" href="https://example.com/a?x=1&amp;y=2">')
    expect(rendered).toContain('<meta property="og:title" content="Preview &lt;page&gt;">')
    expect(rendered).toContain('<link rel="alternate" href="/page?format=html">')
    expect(rendered).toContain('data-solid-file-router-head-default')
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
    expect(module).toContain("import { Router, useCurrentMatches } from '@solidjs/router'")
    expect(module).not.toContain('lazy(() => import(')
  })

  it('respects lazy: true even in an SSR build', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root, true)

    const module = await plugin.load.handler()

    expect(module).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(module).toContain("import { Router, useCurrentMatches } from '@solidjs/router'")
    expect(module).toContain('lazy(() => import(')
  })

  it('keeps loader boundaries in default client and SSR definitions', async () => {
    const root = createTempProject()
    const plugin = await createPlugin(root)
    const clientModule = await plugin.load.handler(undefined, { ssr: false })
    const ssrModule = await plugin.load.handler(undefined, { ssr: true })

    expect(clientModule).toContain("import { createComponent, lazy, mergeProps } from 'solid-js'")
    expect(clientModule).toContain(
      "import { __loader__, __routeMetadataRoot__ } from 'solid-file-router'",
    )
    expect(clientModule).toContain('__loader__(lazy(() => import(')
    expect(ssrModule).toContain("import { createComponent, mergeProps } from 'solid-js'")
    expect(ssrModule).toContain(
      "import { __loader__, __routeMetadataRoot__ } from 'solid-file-router'",
    )
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
      `---
info:
  title: Content
matchFilters:
  slug: '/^[a-z-]+$/'
inherit: false
draft: true
---

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
    expect(routeModule).toContain('metadata: __sfr_mdx_route.metadata')
    expect(routeModule).toContain('matchFilters: __sfr_mdx_route.matchFilters')
    expect(routeModule).toContain('inherit: __sfr_mdx_route.inherit')
    expect(routeModule).toContain('draft: __sfr_mdx_route.draft')
    expect(routeModule).not.toContain('...__sfr_mdx_route')
    await expect(
      (plugin as any).load.handler(normalizePath(`${markdownPath}-sfr.tsx`)),
    ).resolves.toContain('MDXContent')
  })

  it('allows MDX providers to transform paths and extend generated route modules', async () => {
    const root = createTempProject()
    const mdxPath = join(root, 'src/pages/content.mdx')
    writeFileSync(
      mdxPath,
      `---
title: Content
---

# Content`,
    )
    const plugins = fileRouter({
      mdx: {
        transformPath(sourcePath, entry) {
          expect(sourcePath).toBe('src/pages/content.mdx')
          return { ...entry, path: 'docs/content.tsx', data: { section: 'docs' } }
        },
        extendLoad(document, context) {
          expect(document.frontmatter).toEqual({ title: 'Content' })
          expect(context.data).toEqual({ section: 'docs' })
          return {
            routeConfig: { info: { section: 'docs' } },
            mdxContent:
              '<components.wrapper {...props}><MDXContent {...props} /></components.wrapper>',
          }
        },
      },
      lazy: false,
    })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const routeModule = await (plugin as any).load.handler(normalizePath(`${mdxPath}-sfr.tsx`))

    expect(routeModule).toContain('useMDXComponents as __sfr_mdx_components')
    expect(routeModule).toContain('<components.wrapper {...props}>')
    expect(routeModule).toContain('component: __sfr_mdx_content')
    expect(routeModule).toContain('"section": "docs"')
  })

  it('keeps direct MDX imports independent from route extensions', async () => {
    const root = createTempProject()
    const markdownPath = join(root, 'src/content.mdx')
    writeFileSync(markdownPath, '# Content')
    let extended = false
    const mdxPlugin = fileRouter({
      mdx: {
        extendLoad() {
          extended = true
          return { mdxContent: '<MDXContent />' }
        },
      },
    }).find(({ name }) => name.endsWith(':mdx'))!

    const result = await (mdxPlugin as any).transform.handler(
      readFileSync(markdownPath, 'utf8'),
      normalizePath(markdownPath),
    )

    expect(result.code).toContain('function MDXContent')
    expect(result.code).not.toContain('useMDXComponents as __sfr_mdx_components')
    expect(extended).toBe(false)
  })

  it.each(['md', 'mdx'])(
    'compiles directly imported .%s files when mdx is enabled',
    async (ext) => {
      const root = createTempProject()
      const markdownPath = join(root, `src/content.${ext}`)
      writeFileSync(markdownPath, '---\ntitle: Content\ntags:\n  - docs\n---\n\n# Content')
      const mdxPlugin = fileRouter({ mdx: true }).find(({ name }) => name.endsWith(':mdx'))!

      const result = await (mdxPlugin as any).transform.handler(
        readFileSync(markdownPath, 'utf8'),
        normalizePath(markdownPath),
      )

      expect(result.code).toContain('function MDXContent')
      expect(result.code).toContain('export const frontmatter')
      expect(result.frontmatter).toStrictEqual({ title: 'Content', tags: ['docs'] })
      expect(result.code).toContain('Content')
      expect(result.code).toContain('docs')
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
      `---
info:
  title: Content
matchFilters:
  slug: '/^[a-z-]+$/'
inherit: false
draft: true
---

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
    expect(route).toContain('matchFilters: __sfr_mdx_route.matchFilters')
    expect(route).toContain('inherit: __sfr_mdx_route.inherit')
    expect(route).toContain('draft: __sfr_mdx_route.draft')
    expect(component).toContain('component: MDXContent')
    expect(component).not.toContain('info: __sfr_mdx_route.info')
  })

  it('ignores the legacy route export in an MDX module', async () => {
    const root = createTempProject()
    const mdxPath = join(root, 'src/pages/content.mdx')
    writeFileSync(
      mdxPath,
      '---\ninfo:\n  title: Frontmatter\n---\n\nexport const route = { info: { title: "Ignored" } }\n\n# Content',
    )
    const plugins = fileRouter({ mdx: true, lazy: false })
    const registryPlugin = plugins.find(({ name }) => name.endsWith(':router'))!
    const plugin = plugins.find(({ name }) => name.endsWith(':router'))!

    await (registryPlugin as any).configResolved({ build: { ssr: false }, root })

    const routeModule = await (plugin as any).load.handler(normalizePath(`${mdxPath}-sfr.tsx`))
    const route = (
      await (plugin as any).transform.handler(
        routeModule,
        `${normalizePath(`${mdxPath}-sfr.tsx`)}?route`,
      )
    ).code

    expect(routeModule).toContain('"title": "Frontmatter"')
    expect(route).toContain('info: __sfr_mdx_route.info')
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
    expect(module).toContain('"/404": { info: __404_route.info, draft: __404_route.draft }')

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
    expect(output.mdxRouteQuery).toContain('draft: __sfr_mdx_route.draft')
  })

  it('injects route metadata for ordinary pages and the 404 fallback', async () => {
    const output = await buildTempSsgProject(undefined, ['/', '/about'], false, false, true)

    expect(output.indexHtml).toContain('<title>Home &amp; Docs</title>')
    expect(output.indexHtml).toContain(
      '<meta name="description" content="Home &lt;description&gt;">',
    )
    expect(output.indexHtml).toContain(
      '<link rel="canonical" href="https://example.com/home?a=1&amp;b=2">',
    )
    expect(output.indexHtml).toContain(
      '<meta property="og:title" content="Home &quot;preview&quot;">',
    )
    expect(output.indexHtml).toContain('<link rel="alternate" href="/home?format=html">')
    expect(output.aboutHtml).toContain('<title>About</title>')
    expect(output.fallbackHtml).toContain('<title>Not Found</title>')
  })

  it('resolves metadata for dynamic SSG routes from the final match', async () => {
    const output = await buildTempSsgProject(undefined, ['/blog/hello'], false, false, true)

    expect(output.dynamicHtml).toContain('<title>Dynamic page</title>')
  })

  it('skips draft routes from SSG output', async () => {
    const output = await buildTempSsgProject(undefined, ['/', '/draft'], false, true)

    expect(output.indexHtml).toContain('>home</h1>')
    expect(output.draftHtmlExists).toBe(false)
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
