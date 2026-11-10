import type { Component } from 'solid-js'
import { describe, expect, it } from 'vitest'

import { adaptFileRoutes, defineRoute } from '../src/route'

const comp = (name: string): Component => {
  const c = (): null => null
  Object.defineProperty(c, 'name', { value: name })
  return c
}

const tree = () =>
  [
    {
      path: '/',
      component: comp('App'),
      loadingComponent: comp('AppLoading'),
      errorComponent: comp('AppError'),
      children: [
        { path: '/', component: comp('Index'), info: { name: 'index' } },
        { path: '/about', component: comp('About'), metadata: { title: 'About' } },
        {
          path: '/blog',
          component: comp('BlogLayout'),
          loadingComponent: comp('BlogLoading'),
          children: [
            { path: '/:id', component: comp('Post') },
            {
              path: '/plain',
              component: comp('Plain'),
              inherit: { loading: false },
            },
          ],
        },
        { path: '/draft', component: comp('Draft'), draft: true },
      ],
    },
  ] as const

describe('adaptFileRoutes', () => {
  it('wraps components with inherited boundaries', () => {
    const { routes } = adaptFileRoutes(tree() as any)
    const app = routes[0]!
    expect(app.component).not.toBe(tree()[0].component)
    const index = (app.children as any[])[0]
    const blog = (app.children as any[])[2]
    const post = blog.children[0]
    // every component is wrapped (boundaries inherited from ancestors)
    for (const entry of [index, blog, post]) {
      expect(entry.component).not.toBeUndefined()
    }
    // sfr extension keys are stripped from the definition
    expect(index.loadingComponent).toBeUndefined()
    expect(index.inherit).toBeUndefined()
    expect(index.draft).toBeUndefined()
  })

  it('collects routeInfo and routeMetadata by stripped path', () => {
    const { routeInfo, routeMetadata } = adaptFileRoutes(tree() as any)
    expect(routeInfo['/']).toEqual({ name: 'index' })
    expect(routeMetadata['/about']).toEqual({ title: 'About' })
  })

  it('keeps draft routes during development', () => {
    const { routes } = adaptFileRoutes(tree() as any)
    const draft = (routes[0]!.children as any[]).find((r) => r.path === '/draft')
    expect(draft).toBeDefined()
  })

  it('respects inherit: false shape on leaf routes', () => {
    const { routes } = adaptFileRoutes([
      {
        path: '/',
        loadingComponent: comp('L'),
        children: [
          { path: '/x', component: comp('X'), inherit: false },
          { path: '/y', component: comp('Y') },
        ],
      },
    ] as any)
    expect(routes[0]!.children).toHaveLength(2)
  })
})

describe('defineRoute', () => {
  it('is an identity helper', () => {
    const config = defineRoute({ draft: true, metadata: { title: 't' } })
    expect(config.draft).toBe(true)
  })
})
