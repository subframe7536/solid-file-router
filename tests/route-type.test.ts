import { describe, it, expect } from 'vitest'

import { parseParams } from '../src/utils/route-type'

const root = '/root/project'
const files = [
  `${root}/src/pages/(auth)/_layout.tsx`,
  `${root}/src/pages/(auth)/login/_layout.tsx`,
  `${root}/src/pages/(auth)/login/index.tsx`,
  `${root}/src/pages/(auth)/in/_layout.tsx`,
  `${root}/src/pages/(auth)/in/index.tsx`,
  `${root}/src/pages/(auth)/register.tsx`,
  `${root}/src/pages/(external-auth)/sso.tsx`,
  `${root}/src/pages/_ignored-directory/components.tsx`,
  `${root}/src/pages/_ignored-path.tsx`,
  `${root}/src/pages/about.tsx`,
  `${root}/src/pages/blog.w.o.layout.tsx`,
  `${root}/src/pages/blog/-[...all].tsx`,
  `${root}/src/pages/blog/[slug].tsx`,
  `${root}/src/pages/blog/_layout.tsx`,
  `${root}/src/pages/blog/index.tsx`,
  `${root}/src/pages/blog/tags.tsx`,
  `${root}/src/pages/content.mdx`,
  `${root}/src/pages/docs/-[lang]/index.tsx`,
  `${root}/src/pages/docs/-[lang]/resources.tsx`,
  `${root}/src/pages/docs/-en/support.tsx`,
  `${root}/src/pages/index.tsx`,
]

const customRouteRoot = `${root}/app/routes`
const customRouteFiles = [
  `${customRouteRoot}/_app.tsx`,
  `${customRouteRoot}/blog/[slug].tsx`,
  `${customRouteRoot}/docs/-[lang]/index.tsx`,
  `${customRouteRoot}/index.tsx`,
]

describe('generateRouteTypes', () => {
  it('writes route type defs and returns count', () => {
    const params = parseParams(files)
    expect(params).toStrictEqual([
      "'/login': never",
      "'/in': never",
      "'/register': never",
      "'/sso': never",
      "'/about': never",
      "'/blog/w/o/layout': never",
      "'/blog/*?': { '*': string }",
      "'/blog/:slug': { $slug: string }",
      "'/blog': never",
      "'/blog/tags': never",
      "'/content': never",
      "'/docs/:lang?': { $lang?: string }",
      "'/docs/:lang?/resources': { $lang?: string }",
      "'/docs/en?/support': never",
      "'/': never",
    ])
  })

  it('supports a custom pagesDir when parsing params', () => {
    const params = parseParams(customRouteFiles, customRouteRoot)

    expect(params).toStrictEqual([
      "'/blog/:slug': { $slug: string }",
      "'/docs/:lang?': { $lang?: string }",
      "'/': never",
    ])
  })
})
