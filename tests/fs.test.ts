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
    expect(normalizePath(String.raw`a\b\c`)).toBe('a/b/c')
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

  it('nests under the nearest existing ancestor and keeps relative ids', () => {
    const entries = [
      { path: '/(app)', page: true },
      { path: '/(app)/docs', page: true },
      { path: '/(app)/docs/api', page: true },
      { path: '/(app)/docs/api/:fn', page: true },
      { path: '/(app)/blog/:id/comments', page: true },
    ]
    const tree = buildRouteTree(entries)
    expect(tree).toHaveLength(1)
    const docs = tree[0]!.children?.find((c) => c.id === '/docs')
    const orphan = tree[0]!.children?.find((c) => c.id === '/blog/:id/comments')
    expect(tree[0]!.children).toHaveLength(2)
    expect(docs!.children![0]!.id).toBe('/api')
    expect(docs!.children![0]!.children![0]!.id).toBe('/:fn')
    // `/(app)/blog` is missing, so this nests directly under `/(app)`
    expect(orphan!.id).toBe('/blog/:id/comments')
    expect(orphan!.path).toBe('/blog/:id/comments')
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
    expect(sanitizeChunkFileName('src/pages/index.tsx?pick=default&lang.tsx')).toBe(
      'src/pages/index',
    )
    expect(sanitizeChunkFileName('src/pages/index.tsx?pick=default&pick=$css&lang.tsx')).toBe(
      'src/pages/index',
    )
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

  it('removes unused imports and imports only used by mutually recursive dead helpers', () => {
    const code = `
import Unused from './unused';
import Preview from './preview.tsx';

function helperA() {
  return helperB();
}
function helperB() {
  return helperA() || Preview;
}

export const route = { info: { title: 'Doc' } };

export default function Page() {
  return helperA();
}
`
    const result = pickExports(code, 'page.tsx', ['route'])
    expect(result.code).toContain('export const route')
    expect(result.code).not.toContain('./unused')
    expect(result.code).not.toContain('./preview.tsx')
    expect(result.code).not.toContain('helperA')
    expect(result.code).not.toContain('helperB')
    expect(result.code).not.toContain('function Page')
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

describe('baseFileSystemRouter with tinyglobby', () => {
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

describe('incremental route updates', () => {
  const config = {
    dir: '/x',
    extensions: ['tsx'],
    toPath: () => '/a',
  }

  it('skips reload when rescanning produces an identical entry', async () => {
    const router = new BaseFileSystemRouter({
      ...config,
      toRoute: () => ({ path: '/a', page: true, $component: { src: '/x/a.tsx', pick: ['d'] } }),
    })
    await router.updateRoute('/x/a.tsx')
    const events: Array<string> = []
    router.on('reload', (evt) => events.push(evt.detail.type))
    const version = router.version
    await router.updateRoute('/x/a.tsx')
    expect(events).toEqual([])
    expect(router.version).toBe(version)
  })

  it('reloads when rescanning produces a changed entry', async () => {
    let flag = false
    const router = new BaseFileSystemRouter({
      ...config,
      toRoute: () => ({ path: '/a', page: true, extra: flag }),
    })
    await router.updateRoute('/x/a.tsx')
    const events: Array<string> = []
    router.on('reload', (evt) => events.push(evt.detail.type))
    flag = true
    await router.updateRoute('/x/a.tsx')
    expect(events).toEqual(['update'])
  })

  it('removes and re-adds when the mapped path changes', async () => {
    let path = '/a'
    const router = new BaseFileSystemRouter({
      ...config,
      toRoute: () => ({ path, page: true }),
    })
    await router.updateRoute('/x/a.tsx')
    const events: Array<string> = []
    router.on('reload', (evt) => events.push(evt.detail.type))
    path = '/b'
    await router.updateRoute('/x/a.tsx')
    expect(events).toEqual(['remove', 'add'])
    expect(router.routes.map((r) => r.path)).toEqual(['/b'])
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
