import { describe, expect, it } from 'vitest'

import {
  BaseFileSystemRouter,
  buildRouteTree,
  cleanPath,
  createAPIHandler,
  createAPIMatcher,
  normalizePath,
  PageFileSystemRouter,
  pickExports,
  routePathFromFile,
  sanitizeChunkFileName,
  stripPathBase,
  stripRouteGroups,
  toPickId,
} from '../src/fs'

describe('normalizePath and cleanPath', () => {
  it('normalizes backslashes to posix', () => {
    expect(normalizePath('a\\b\\c')).toBe('a/b/c')
  })

  it('cleans path prefix and extension', () => {
    const config = { dir: '/app/src/pages', extensions: ['tsx', 'ts'] }
    expect(cleanPath('/app/src/pages/blog/[id].tsx', config)).toBe('/blog/[id]')
  })
})

describe('stripRouteGroups and buildRouteTree', () => {
  it('strips group segments from path', () => {
    expect(stripRouteGroups('/(app)/blog/(auth)/login')).toBe('/blog/login')
    expect(stripRouteGroups('/(app)/')).toBe('/')
    expect(stripRouteGroups('/(app)')).toBe('/')
    expect(stripRouteGroups('(app)')).toBe('/')
  })

  it('builds a nested route tree from flat entries', () => {
    const entries = [
      { path: '/(app)', page: true },
      { path: '/(app)/about', page: true },
      { path: '/(app)/blog', page: true },
      { path: '/(app)/blog/:id', page: true },
    ]
    const tree = buildRouteTree(entries)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe('/(app)')
    expect(tree[0]!.path).toBe('/')
    expect(tree[0]!.children).toHaveLength(2)

    const about = tree[0]!.children?.find((c) => c.path === '/about')
    const blog = tree[0]!.children?.find((c) => c.path === '/blog')
    expect(about).toBeDefined()
    expect(blog).toBeDefined()
    expect(blog!.children).toHaveLength(1)
    expect(blog!.children![0]!.path).toBe('/:id')
  })
})

describe('toPickId and sanitizeChunkFileName', () => {
  it('formats pick module id with extension preserved', () => {
    expect(toPickId('/src/pages/index.tsx', ['default', '$css'])).toBe(
      '/src/pages/index.tsx?pick=default&pick=$css&lang.tsx',
    )
  })

  it('sanitizes chunk file names removing invalid chars and pick query', () => {
    expect(sanitizeChunkFileName('src/pages/index.tsx?pick=default&lang')).toBe('src/pages/index')
  })
})

describe('pickExports with Vite parseSync', () => {
  it('picks route export and tree-shakes default export and unused imports', () => {
    const code = `
import { heavyHelper } from './heavy';
import './style.css';

export const route = {
  preload: () => 'data',
};

export default function Page() {
  heavyHelper();
  return null;
}
`
    const result = pickExports(code, 'page.tsx', ['route'])
    expect(result.code).toContain('export const route =')
    expect(result.code).not.toContain('heavyHelper')
    expect(result.code).not.toContain('./heavy')
    expect(result.code).not.toContain('./style.css')
    expect(result.code).not.toContain('function Page')
  })

  it('picks default export and retains $css import', () => {
    const code = `
import './style.css';

export const route = { title: 'Hello' };

export default function Page() {
  return null;
}
`
    const result = pickExports(code, 'page.tsx', ['default', '$css'])
    expect(result.code).toContain('./style.css')
    expect(result.code).toContain('function Page')
    expect(result.code).not.toContain('export const route')
  })

  it('removes css import if $css is not picked', () => {
    const code = `
import './style.css';
export default function Page() { return null; }
`
    const result = pickExports(code, 'page.tsx', ['default'])
    expect(result.code).not.toContain('./style.css')
    expect(result.code).toContain('function Page')
  })
})

describe('standard routePathFromFile', () => {
  it('converts file paths to standard patterns', () => {
    expect(routePathFromFile('/index')).toBe('/')
    expect(routePathFromFile('/about')).toBe('/about')
    expect(routePathFromFile('/blog/[id]')).toBe('/blog/:id')
    expect(routePathFromFile('/blog/[[optional]]')).toBe('/blog/:optional?')
    expect(routePathFromFile('/blog/[...all]')).toBe('/blog/*all')
  })
})

describe('BaseFileSystemRouter with tinyglobby', () => {
  it('scans routes using tinyglobby', async () => {
    const router = new BaseFileSystemRouter({
      dir: 'playground/src/pages',
      extensions: ['tsx', 'ts'],
      toPath: (file) => file,
      toRoute: (src) => ({ path: src, page: true }),
    })
    const routes = await router.getRoutes()
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.some((r) => r.path.endsWith('404.tsx'))).toBe(true)
  })

  it('works with PageFileSystemRouter convention', async () => {
    const router = new PageFileSystemRouter({
      dir: 'playground/src/pages',
      extensions: ['tsx', 'ts'],
    })
    const routes = await router.getRoutes()
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.some((r) => r.path === '/')).toBe(true)
  })
})

describe('radix3 API matcher and handler', () => {
  it('strips path base correctly', () => {
    expect(stripPathBase('/app/api/users', '/app')).toBe('/api/users')
    expect(stripPathBase('/app', '/app')).toBe('/')
    expect(stripPathBase('/other', '/app')).toBe('/other')
  })

  it('matches routes and extracts parameters using radix3', () => {
    const matcher = createAPIMatcher([
      {
        path: '/api/users/:id',
        $GET: {
          require: () => ({ GET: () => new Response('user') }),
        },
      },
      {
        path: '/api/*all',
        $POST: {
          require: () => ({ POST: () => new Response('catchall') }),
        },
      },
    ])

    const matchGet = matcher('/api/users/42', 'GET')
    expect(matchGet).toBeDefined()
    expect(matchGet?.params).toEqual({ id: '42' })

    const matchPost = matcher('/api/anything/else', 'POST')
    expect(matchPost).toBeDefined()
    expect(matchPost?.params).toEqual({ all: 'anything/else' })

    const matchHead = matcher('/api/users/42', 'HEAD')
    expect(matchHead).toBeDefined()

    const matchMissing = matcher('/unknown', 'GET')
    expect(matchMissing).toBeUndefined()
  })

  it('dispatches request via createAPIHandler', async () => {
    const handler = createAPIHandler([
      {
        path: '/api/hello',
        $GET: {
          require: () => ({ GET: () => 'hello world' }),
        },
      },
    ])

    const event = { request: new Request('http://localhost/api/hello') }
    const res = await handler(event, () => new Response('fallback', { status: 404 }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello world')

    const missingEvent = { request: new Request('http://localhost/api/notfound') }
    const fallbackRes = await handler(missingEvent, () => new Response('fallback', { status: 404 }))
    expect(fallbackRes.status).toBe(404)
    expect(await fallbackRes.text()).toBe('fallback')
  })
})
