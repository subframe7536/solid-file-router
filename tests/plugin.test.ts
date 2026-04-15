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
  it('uses render() by default when no SSR is configured (SPA)', () => {
    const plugins = fileRouter()
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain(
      'import { generateHydrationScript, render, renderToStringAsync, getAssets }',
    )
    expect(code).toContain('const renderContext = { url, Router, getAssets }')
    expect(code).toContain('return render(component, element)')
    expect(plugins.some((plugin) => plugin.name.includes('solid-file-router'))).toBe(true)
  })

  it('uses hydrate() when ssg config is provided (SSG)', () => {
    const options = {
      ssg: {
        routes: ['/'],
      },
    } satisfies Parameters<typeof fileRouter>[0]
    const plugins = fileRouter(options)
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain(
      'import { generateHydrationScript, hydrate, renderToStringAsync, getAssets }',
    )
    expect(code).toContain('return hydrate(component, element)')
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(true)
  })

  it('SSG plugin is present when ssg config is provided', () => {
    const plugins = fileRouter({ ssg: { routes: ['/'] } })
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(true)
  })

  it('SSG plugin is absent when no ssg config is provided', () => {
    const plugins = fileRouter()
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(false)
  })
})
