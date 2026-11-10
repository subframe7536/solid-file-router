import { describe, expect, it } from 'vitest'

import { getPrerenderAssetFileName, normalizeRoutePath, staticPathsOf } from '../src/ssg'

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
