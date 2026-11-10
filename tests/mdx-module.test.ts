import { describe, expect, it } from 'vitest'

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
})
