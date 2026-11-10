import { describe, expect, it } from 'vitest'

import { DefaultFileSystemRouter, routePathFromFile } from '../src/convention'

describe('routePathFromFile', () => {
  const cases: [file: string, path: string | undefined][] = [
    ['/_app', '/(app)'],
    ['/_layout', '/(app)'],
    ['/index', '/(app)/'],
    ['/about', '/(app)/about'],
    ['/blog/index', '/(app)/blog/'],
    ['/blog/_layout', '/(app)/blog'],
    ['/blog/[id]', '/(app)/blog/:id'],
    ['/docs/-[lang]/index', '/(app)/docs/:lang?/'],
    ['/blog/-[...all]', '/(app)/blog/*all'],
    ['/blog/[...all]', '/(app)/blog/*all'],
    ['/(auth)/login', '/(app)/(auth)/login'],
    ['/(auth)/_layout', '/(app)/(auth)'],
    ['/account.settings', '/(app)/account/settings'],
    ['/404', '/(app)/*404'],
    ['/nested/404', '/(app)/nested/*404'],
    ['/foo.index', '/(app)/foo'],
    ['/blog/[id].edit', '/(app)/blog/:id/edit'],
    ['/blog/-[tab]/[id]', '/(app)/blog/:tab?/:id'],
    // private segments
    ['/_foo', undefined],
    ['/x/_app', undefined],
    ['/_app/x', undefined],
    ['/_layout/x', undefined],
    ['/x/_layout/y', undefined],
    ['/x/_private/index', undefined],
    // nested layout keeps trailing segments
    ['/blog/_layout', '/(app)/blog'],
    // optional param mid-path
    ['/docs/-[lang]/about', '/(app)/docs/:lang?/about'],
  ]

  it.each(cases)('%s -> %s', (file, expected) => {
    expect(routePathFromFile(file)).toBe(expected)
  })
})

describe('DefaultFileSystemRouter', () => {
  const router = new DefaultFileSystemRouter({
    dir: 'src/pages',
    extensions: ['tsx'],
  })

  it('maps src through routePathFromFile', () => {
    expect(router.toPath(`${process.cwd()}/src/pages/blog/[id].tsx`)).toBe('/(app)/blog/:id')
  })

  it('has no default ignores — only extensions filter scan results', () => {
    const pages = `${process.cwd()}/src/pages`
    expect(router.isRoute(`${pages}/about.tsx`)).toBe(true)
    expect(router.isRoute(`${pages}/components/Button.tsx`)).toBe(true)
    expect(router.isRoute(`${pages}/about.md`)).toBe(false)
  })

  it('matches ignore globs relative to dir', () => {
    const custom = new DefaultFileSystemRouter({
      dir: 'src/pages',
      extensions: ['tsx'],
      ignore: ['components/**', '**/*.test.tsx'],
    })
    const pages = `${process.cwd()}/src/pages`
    expect(custom.isRoute(`${pages}/components/Button.tsx`)).toBe(false)
    expect(custom.isRoute(`${pages}/a/x.test.tsx`)).toBe(false)
    expect(custom.isRoute(`${pages}/about.tsx`)).toBe(true)
  })
})
