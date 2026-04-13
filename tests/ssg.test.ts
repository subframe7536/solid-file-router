import { describe, it, expect } from 'vitest'

import { createRouteManifestEntryCode, getSSRBuildOutputPath } from '../src/ssg'
import {
  expandDynamicRoute,
  collectRoutesFromConfig,
  collectRoutesFromPrerender,
  crawlLinks,
} from '../src/ssg/collect'
import { injectHTML } from '../src/ssg/render'

const mockFileRoutes = [
  {
    path: 'nest',
    children: [
      { path: '/', id: 'nest/index' },
      { path: 'value', id: 'nest/value' },
      { path: ':id', id: 'nest/[id]' },
    ],
  },
  { path: '/', id: 'index' },
  { path: 'about', id: 'about' },
  { path: 'data', id: 'data' },
  {
    path: 'blog',
    children: [
      { path: '/', id: 'blog/index' },
      { path: ':slug', id: 'blog/[slug]', prerender: { params: { slug: ['hello', 'world'] } } },
    ],
  },
  {
    path: 'docs',
    children: [
      { path: '/', id: 'docs/index', prerender: true },
      { path: 'guide', id: 'docs/guide', prerender: true },
      { path: 'api', id: 'docs/api', prerender: false },
    ],
  },
  { path: '*', id: '404' },
]

describe('expandDynamicRoute', () => {
  it('expands single param', () => {
    expect(expandDynamicRoute('/blog/:slug', { slug: ['a', 'b', 'c'] })).toEqual([
      '/blog/a',
      '/blog/b',
      '/blog/c',
    ])
  })

  it('expands multiple params (cartesian product)', () => {
    expect(
      expandDynamicRoute('/shop/:category/:id', {
        category: ['books', 'toys'],
        id: ['1', '2'],
      }),
    ).toEqual(['/shop/books/1', '/shop/books/2', '/shop/toys/1', '/shop/toys/2'])
  })

  it('handles string param (non-array)', () => {
    expect(expandDynamicRoute('/user/:name', { name: 'alice' })).toEqual(['/user/alice'])
  })

  it('returns empty for empty params', () => {
    expect(expandDynamicRoute('/test/:id', {})).toEqual([])
  })
})

describe('collectRoutesFromConfig', () => {
  it('collects exact paths', () => {
    const result = collectRoutesFromConfig({ routes: ['/', '/about'] })
    expect(result).toEqual([
      { path: '/', source: 'config' },
      { path: '/about', source: 'config' },
    ])
  })

  it('collects all static routes with * wildcard', () => {
    const result = collectRoutesFromConfig({ routes: ['*'] }, mockFileRoutes)
    const paths = result.map((r) => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/about')
    expect(paths).toContain('/data')
    expect(paths).toContain('/nest')
    expect(paths).toContain('/nest/value')
    expect(paths).toContain('/blog')
    expect(paths).toContain('/docs')
    expect(paths).toContain('/docs/guide')
    // Dynamic segments should be excluded
    expect(paths).not.toContain('/nest/:id')
    expect(paths).not.toContain('/blog/:slug')
    // Catch-all should be excluded
    expect(paths).not.toContain('*')
  })

  it('supports glob patterns', () => {
    const result = collectRoutesFromConfig({ routes: ['/nest/*'] }, mockFileRoutes)
    const paths = result.map((r) => r.path)
    expect(paths).toContain('/nest/value')
    expect(paths).not.toContain('/')
    expect(paths).not.toContain('/about')
    expect(paths).not.toContain('/nest')
  })

  it('expands SSGRouteEntry with params', () => {
    const result = collectRoutesFromConfig({
      routes: [{ path: '/blog/:slug' as any, params: { slug: ['hello', 'world'] } }],
    })
    expect(result).toEqual([
      { path: '/blog/hello', source: 'config' },
      { path: '/blog/world', source: 'config' },
    ])
  })

  it('returns empty for no routes', () => {
    expect(collectRoutesFromConfig({})).toEqual([])
    expect(collectRoutesFromConfig({ routes: [] })).toEqual([])
  })

  it('ignores * when no fileRoutes provided', () => {
    const result = collectRoutesFromConfig({ routes: ['*'] })
    expect(result).toEqual([])
  })
})

describe('collectRoutesFromPrerender', () => {
  it('collects routes with prerender: true', () => {
    const result = collectRoutesFromPrerender(mockFileRoutes)
    const paths = result.map((r) => r.path)
    expect(paths).toContain('/docs')
    expect(paths).toContain('/docs/guide')
    expect(paths).not.toContain('/docs/api')
  })

  it('expands dynamic routes with prerender params', () => {
    const result = collectRoutesFromPrerender(mockFileRoutes)
    const paths = result.map((r) => r.path)
    expect(paths).toContain('/blog/hello')
    expect(paths).toContain('/blog/world')
  })

  it('skips routes without prerender', () => {
    const result = collectRoutesFromPrerender([
      { path: '/', id: 'index' },
      { path: 'about', id: 'about' },
    ])
    expect(result).toEqual([])
  })
})

describe('crawlLinks', () => {
  it('extracts internal links from HTML', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/blog/hello">Blog</a>
      <a href="https://example.com">External</a>
    `
    const visited = new Set<string>()
    const links = crawlLinks(html, visited)
    expect(links).toEqual(['/about', '/blog/hello'])
  })

  it('skips already visited links', () => {
    const html = `<a href="/about">About</a><a href="/blog">Blog</a>`
    const visited = new Set(['/about'])
    const links = crawlLinks(html, visited)
    expect(links).toEqual(['/blog'])
  })

  it('skips external and protocol links', () => {
    const html = `
      <a href="https://example.com">HTTPS</a>
      <a href="//cdn.example.com/file">Protocol-relative</a>
      <a href="mailto:test@test.com">Mail</a>
    `
    const links = crawlLinks(html, new Set())
    expect(links).toEqual([])
  })

  it('strips query strings and hashes', () => {
    const html = `<a href="/page?foo=bar#section">Link</a>`
    const links = crawlLinks(html, new Set())
    expect(links).toEqual(['/page'])
  })

  it('deduplicates links', () => {
    const html = `<a href="/about">A</a><a href="/about">B</a>`
    const links = crawlLinks(html, new Set())
    expect(links).toEqual(['/about'])
  })
})

describe('injectHTML', () => {
  const template = `<!doctype html>
<html>
  <head><title>Test</title>
    <script type="module" crossorigin src="/assets/index.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`

  it('injects rendered HTML into mount element', () => {
    const result = { html: '<h1>Hello</h1>', head: '' }
    const output = injectHTML(template, result, '#app')
    expect(output).toContain('<div id="app"><h1>Hello</h1></div>')
  })

  it('injects head content when provided', () => {
    const result = { html: '<h1>Hello</h1>', head: '<script>window._$HY={};</script>' }
    const output = injectHTML(template, result, '#app')
    expect(output).toContain('<script>window._$HY={};</script>')
    expect(output).toContain('</head>')
  })

  it('does not inject empty head', () => {
    const result = { html: '<h1>Hello</h1>', head: '' }
    const output = injectHTML(template, result, '#app')
    expect(output).not.toMatch(/\n<\/head>/)
  })

  it('handles custom mountId', () => {
    const customTemplate = template.replace('id="app"', 'id="root"')
    const result = { html: '<p>Content</p>', head: '' }
    const output = injectHTML(customTemplate, result, '#root')
    expect(output).toContain('<div id="root"><p>Content</p></div>')
  })
})

describe('ssg helpers', () => {
  it('derives the SSR output path from the entry file name', () => {
    expect(getSSRBuildOutputPath('/tmp/out', 'src/entry-server.tsx')).toBe(
      '/tmp/out/entry-server.js',
    )
    expect(getSSRBuildOutputPath('/tmp/out', 'src/custom.server.ts')).toBe(
      '/tmp/out/custom.server.js',
    )
  })

  it('generates a dedicated route manifest entry', () => {
    expect(createRouteManifestEntryCode()).toBe("export { fileRoutes } from 'virtual:routes'\n")
  })
})
