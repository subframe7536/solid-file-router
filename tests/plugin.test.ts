import { describe, it, expect } from 'vitest'

import { ID_ROUTER_ENTRY } from '../src/const'
import { fileRouter } from '../src/index'

function getRouterEntryCode(options?: Parameters<typeof fileRouter>[0]) {
  const plugins = fileRouter(options)
  const routerEntryPlugin = plugins.find((plugin) => plugin.name === ID_ROUTER_ENTRY)
  expect(routerEntryPlugin).toBeDefined()
  const load = (routerEntryPlugin as any).load
  expect(typeof load?.handler).toBe('function')
  return load.handler() as string
}

describe('fileRouter mode handling', () => {
  it('uses render() by default for SPA mode', () => {
    const code = getRouterEntryCode()
    expect(code).toContain('import { generateHydrationScript, render, renderToStringAsync }')
    expect(code).toContain('return render(component, element)')
  })

  it('uses hydrate() for SSR mode', () => {
    const code = getRouterEntryCode({ mode: 'ssr' })
    expect(code).toContain('import { generateHydrationScript, hydrate, renderToStringAsync }')
    expect(code).toContain('return hydrate(component, element)')
  })

  it('defaults to SSG mode when ssg config is provided', () => {
    const plugins = fileRouter({
      ssg: {
        routes: ['/'],
      },
    })
    const code = getRouterEntryCode({
      ssg: {
        routes: ['/'],
      },
    })
    expect(code).toContain('import { generateHydrationScript, hydrate, renderToStringAsync }')
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(true)
  })

  it('can disable SSG plugin by setting mode to spa', () => {
    const plugins = fileRouter({
      mode: 'spa',
      ssg: {
        routes: ['/'],
      },
    })
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(false)
  })
})
