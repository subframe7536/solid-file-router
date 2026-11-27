import { defineMdastPlugin } from 'satteri'
import { describe, expect, it, vi } from 'vitest'

import { compileMdx, compileMdxRouteModule } from '../src/mdx/router'

const source = `---
title: Test Post
draft: true
---

# Hello

World **bold**.
`

describe('compileMdx', () => {
  it('emits route/frontmatter exports and a default component', async () => {
    const { code } = await compileMdx(source, '/tmp/post.mdx')
    expect(code).toContain('export const route')
    expect(code).toContain('export const frontmatter')
    expect(code).toMatch(/export default \w+/)
    expect(code).not.toContain('createRoute')
  })

  it('parses frontmatter route config', async () => {
    const { routeConfig, frontmatter } = await compileMdx(source, '/tmp/post.mdx')
    expect(frontmatter.title).toBe('Test Post')
    expect(routeConfig.draft).toBe(true)
  })
})

describe('compileMdxRouteModule', () => {
  it('emits only route-facing exports', async () => {
    const { code } = await compileMdxRouteModule(source, '/tmp/post.mdx')
    expect(code).toContain('export const route')
    expect(code).toContain('export const frontmatter')
    expect(code).not.toContain('export default')
    expect(code).not.toContain('MDXContent')
  })

  it('uses extendRoute without running extendLoad or full mdast compilation', async () => {
    const extendLoad = vi.fn<() => undefined>(() => undefined)
    const extendRoute = vi.fn<() => { info: { title: string } }>(() => ({
      info: { title: 'Fast Route' } as any,
    }))
    const mdastPlugin = vi.fn<() => ReturnType<typeof defineMdastPlugin>>(() =>
      defineMdastPlugin({ name: 'unused', heading() {} }),
    )

    const { code, routeConfig, frontmatter } = await compileMdxRouteModule(
      source,
      '/tmp/post.mdx',
      {
        extendLoad,
        extendRoute,
        mdastPlugins: [mdastPlugin],
      },
    )

    expect(extendRoute).toHaveBeenCalledTimes(1)
    expect(extendLoad).not.toHaveBeenCalled()
    expect(mdastPlugin).not.toHaveBeenCalled()
    expect(frontmatter.title).toBe('Test Post')
    expect(routeConfig.draft).toBe(true)
    expect(routeConfig.info).toEqual({ title: 'Fast Route' })
    expect(code).toContain('"Fast Route"')
  })
})
