import { describe, expect, it } from 'vitest'

import { parseMdxFrontmatter } from '../src/mdx/frontmatter'

describe('MDX frontmatter', () => {
  it('parses YAML values into frontmatter and route configuration', async () => {
    const result = await parseMdxFrontmatter({
      kind: 'yaml',
      value: `info:
  title: Guide
matchFilters:
  slug: '/^[a-z-]+$/i'
  locale:
    - en
    - zh
inherit: false
draft: true
tags:
  - docs`,
    })

    expect(result.data).toStrictEqual({
      info: { title: 'Guide' },
      matchFilters: { slug: '/^[a-z-]+$/i', locale: ['en', 'zh'] },
      inherit: false,
      draft: true,
      tags: ['docs'],
    })
    expect(result.routeConfig.info).toStrictEqual({ title: 'Guide' })
    expect(result.routeConfig.matchFilters).toMatchObject({
      slug: /^[a-z-]+$/i,
      locale: ['en', 'zh'],
    })
    expect(result.routeConfig.inherit).toBe(false)
    expect(result.routeConfig.draft).toBe(true)
  })

  it('uses an empty object when frontmatter is absent or empty', async () => {
    await expect(parseMdxFrontmatter()).resolves.toMatchObject({
      data: {},
      routeConfig: {},
    })
    await expect(parseMdxFrontmatter({ kind: 'yaml', value: '' })).resolves.toMatchObject({
      data: {},
      routeConfig: {},
    })
  })

  it('rejects TOML and invalid YAML values', async () => {
    await expect(parseMdxFrontmatter({ kind: 'toml', value: 'title = "Guide"' })).rejects.toThrow(
      'TOML frontmatter is not supported',
    )
    await expect(parseMdxFrontmatter({ kind: 'yaml', value: '- one\n- two' })).rejects.toThrow(
      'must contain an object',
    )
    await expect(
      parseMdxFrontmatter({ kind: 'yaml', value: 'matchFilters:\n  slug: true' }),
    ).rejects.toThrow('frontmatter.matchFilters.slug')
  })
})
