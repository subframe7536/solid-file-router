import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getRoutePath } from '../src/route/path'
import { generateRouteTypes, parseParams } from '../src/route/type-gen'

const root = '/root/project'
const files = [
  `${root}/src/pages/(auth)/_layout.tsx`,
  `${root}/src/pages/(auth)/login/_layout.tsx`,
  `${root}/src/pages/(auth)/login/index.tsx`,
  `${root}/src/pages/(auth)/in/_layout.tsx`,
  `${root}/src/pages/(auth)/in/index.tsx`,
  `${root}/src/pages/(auth)/register.tsx`,
  `${root}/src/pages/(external-auth)/sso.tsx`,
  `${root}/src/pages/_ignored-directory/components.tsx`,
  `${root}/src/pages/_ignored-path.tsx`,
  `${root}/src/pages/about.tsx`,
  `${root}/src/pages/blog.w.o.layout.tsx`,
  `${root}/src/pages/blog/-[...all].tsx`,
  `${root}/src/pages/blog/[slug].tsx`,
  `${root}/src/pages/blog/_layout.tsx`,
  `${root}/src/pages/blog/index.tsx`,
  `${root}/src/pages/blog/tags.tsx`,
  `${root}/src/pages/content.mdx`,
  `${root}/src/pages/docs/-[lang]/index.tsx`,
  `${root}/src/pages/docs/-[lang]/resources.tsx`,
  `${root}/src/pages/docs/-en/support.tsx`,
  `${root}/src/pages/index.tsx`,
]

const customRouteRoot = `${root}/app/routes`
const customRouteFiles = [
  `${customRouteRoot}/_app.tsx`,
  `${customRouteRoot}/blog/[slug].tsx`,
  `${customRouteRoot}/docs/-[lang]/index.tsx`,
  `${customRouteRoot}/index.tsx`,
]

describe('generateRouteTypes', () => {
  it('keeps ordinary index-prefixed names and quotes unsafe parameter keys', () => {
    expect(getRoutePath(`${root}/src/pages/reindex.tsx`)).toBe('/reindex')
    expect(getRoutePath(`${root}/src/pages/indexer.tsx`)).toBe('/indexer')
    expect(getRoutePath(`${root}/src/pages/blog/-[...post-id].tsx`)).toBe('/blog/*?')
    expect(parseParams([`${root}/src/pages/[user-id].tsx`])).toStrictEqual([
      "'/:user-id': { '$user-id': string }",
    ])
  })

  it('writes route type defs and returns count', () => {
    const params = parseParams(files)
    expect(params).toStrictEqual([
      "'/login': never",
      "'/in': never",
      "'/register': never",
      "'/sso': never",
      "'/about': never",
      "'/blog/w/o/layout': never",
      "'/blog/*?': { '*'?: string }",
      "'/blog/:slug': { $slug: string }",
      "'/blog': never",
      "'/blog/tags': never",
      "'/docs/:lang?': { $lang?: string }",
      "'/docs/:lang?/resources': { $lang?: string }",
      "'/docs/en?/support': never",
      "'/': never",
    ])
  })

  it('supports a custom pagesDir when parsing params', () => {
    const params = parseParams(customRouteFiles, customRouteRoot)

    expect(params).toStrictEqual([
      "'/blog/:slug': { $slug: string }",
      "'/docs/:lang?': { $lang?: string }",
      "'/': never",
    ])
  })

  it('supports logical route paths from custom sources', () => {
    const params = parseParams([
      {
        routeId: '/',
        routePath: 'index.tsx',
        moduleId: '/root/docs/index.mdx-sfr.tsx',
      },
      {
        routeId: '/_app',
        routePath: '_app.tsx',
        moduleId: '/root/docs/app.mdx-sfr.tsx',
      },
      {
        routeId: '/dashboard/_layout',
        routePath: 'dashboard/_layout.tsx',
        moduleId: '/root/docs/dashboard-layout.mdx-sfr.tsx',
      },
      {
        routeId: '/button',
        routePath: '(general)/button.tsx',
        moduleId: '/root/docs/button.mdx-sfr.tsx',
      },
      {
        routeId: '/docs/:slug',
        routePath: 'docs/[slug].tsx',
        moduleId: '/root/docs/slug.mdx-sfr.tsx',
      },
      {
        routeId: '/404',
        routePath: '404.tsx',
        moduleId: '/root/docs/404.mdx-sfr.tsx',
      },
    ])

    expect(params).toStrictEqual([
      "'/': never",
      "'/button': never",
      "'/docs/:slug': { $slug: string }",
    ])
  })

  it('imports an external route-info interface', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'solid-file-router-route-type-'))
    const output = join(tempRoot, 'routes.d.ts')

    try {
      generateRouteTypes([`${root}/src/pages/index.tsx`], output, {
        type: 'import',
        from: './docs/build/routes',
        name: 'DocsRouteInfo',
      })
      const generated = readFileSync(output, 'utf8')

      expect(generated).toContain(
        "import type { DocsRouteInfo as FileRouteInfoDefinition } from './docs/build/routes'",
      )
      expect(generated).toContain('interface FileRouteInfo extends FileRouteInfoDefinition {}')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
