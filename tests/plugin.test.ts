import { describe, it, expect } from 'vitest'

import { ID_ROUTER_ENTRY } from '../src/const'
import { fileRouter } from '../src/index'

type PluginWithObjectLoad = {
  load?: {
    handler?: () => string
  }
}

function getRouterEntryCodeFromPlugins(plugins: ReturnType<typeof fileRouter>) {
  const routerEntryPlugin = plugins.find((plugin) => plugin.name === ID_ROUTER_ENTRY)
  expect(routerEntryPlugin).toBeDefined()
  const load = (routerEntryPlugin as PluginWithObjectLoad | undefined)?.load
  expect(load && typeof load.handler === 'function').toBe(true)
  if (!load?.handler) {
    throw new TypeError('router entry plugin load handler is missing')
  }
  return load.handler() as string
}

describe('fileRouter mode handling', () => {
  it('uses render() by default for SPA mode', () => {
    const plugins = fileRouter()
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain('import { generateHydrationScript, render, renderToStringAsync }')
    expect(code).toContain('return render(component, element)')
    expect(plugins.some((plugin) => plugin.name.includes('solid'))).toBe(true)
  })

  it('uses hydrate() for SSR mode', () => {
    const plugins = fileRouter({ mode: 'ssr' })
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain('import { generateHydrationScript, hydrate, renderToStringAsync }')
    expect(code).toContain('return hydrate(component, element)')
    expect(plugins.some((plugin) => plugin.name.includes('solid'))).toBe(true)
  })

  it('defaults to SSG mode when ssg config is provided', () => {
    const options = {
      ssg: {
        routes: ['/'],
      },
    } satisfies Parameters<typeof fileRouter>[0]
    const plugins = fileRouter(options)
    const code = getRouterEntryCodeFromPlugins(plugins)
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
