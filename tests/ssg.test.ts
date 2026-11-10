import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createPreviewFallbackMiddleware,
  getPrerenderAssetFileName,
  normalizeRoutePath,
  staticPathsOf,
} from '../src/ssg'

describe('getPrerenderAssetFileName', () => {
  it.each([
    ['/', 'index.html'],
    ['/about', 'about.html'],
    ['/blog/', 'blog/index.html'],
    ['/docs/guide', 'docs/guide.html'],
  ])('%s -> %s', (route, file) => {
    expect(getPrerenderAssetFileName(route)).toBe(file)
  })
})

describe('normalizeRoutePath', () => {
  it('rejects non-slash paths', () => {
    expect(() => normalizeRoutePath('about')).toThrow()
  })
  it('strips trailing slashes except root', () => {
    expect(normalizeRoutePath('/a/')).toBe('/a')
    expect(normalizeRoutePath('/')).toBe('/')
  })
})

describe('staticPathsOf', () => {
  it('strips groups and drops dynamic/segment paths', () => {
    expect(
      staticPathsOf([
        '/(app)',
        '/(app)/',
        '/(app)/about',
        '/(app)/blog/:id',
        '/(app)/*404',
        '/(app)/docs/*rest',
        '/(app)/x/-y',
      ]),
    ).toEqual(['/', '/about', '/x/-y'])
  })
})

describe('createPreviewFallbackMiddleware', () => {
  it('serves prerendered file without falling through to 404', async () => {
    const dir = join(tmpdir(), `sfr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(join(dir, 'about.html'), '<h1>About</h1>')
      await writeFile(join(dir, '404.html'), '<h1>404</h1>')

      const middleware = createPreviewFallbackMiddleware(dir)
      const headers: Record<string, string> = {}
      let statusCode = 200
      let body = ''
      let nextCalled = false

      const req = {
        url: '/about',
        headers: { accept: 'text/html,application/xhtml+xml' },
      }
      const res = {
        setHeader: (name: string, value: string) => {
          headers[name] = value
        },
        statusCode,
        end: (content?: string) => {
          body = content ?? ''
        },
      }

      await middleware(req, res, () => {
        nextCalled = true
      })

      expect(headers['content-type']).toBe('text/html')
      expect(body).toBe('<h1>About</h1>')
      expect(res.statusCode).toBe(200)
      expect(nextCalled).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves 404.html for missing routes', async () => {
    const dir = join(tmpdir(), `sfr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(join(dir, '404.html'), '<h1>404 Not Found</h1>')

      const middleware = createPreviewFallbackMiddleware(dir)
      const headers: Record<string, string> = {}
      let body = ''
      let nextCalled = false

      const req = {
        url: '/missing',
        headers: { accept: 'text/html' },
      }
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => {
          headers[name] = value
        },
        end: (content?: string) => {
          body = content ?? ''
        },
      }

      await middleware(req, res, () => {
        nextCalled = true
      })

      expect(headers['content-type']).toBe('text/html')
      expect(body).toBe('<h1>404 Not Found</h1>')
      expect(res.statusCode).toBe(404)
      expect(nextCalled).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('calls next for non-HTML requests', async () => {
    const middleware = createPreviewFallbackMiddleware('/nonexistent')
    let nextCalled = false

    await middleware(
      { url: '/api', headers: { accept: 'application/json' } },
      {
        setHeader: () => {},
        statusCode: 200,
        end: () => {},
      },
      () => {
        nextCalled = true
      },
    )

    expect(nextCalled).toBe(true)
  })
})
