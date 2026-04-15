import { fileURLToPath } from 'node:url'

import { resolveConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { describe, it, expect, vi } from 'vitest'

import { ID_ROUTER_ENTRY, logger } from '../src/const'
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
  it('uses render() in dev and hydrates only when hydration markers exist', () => {
    const plugins = fileRouter()
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain(
      'import { generateHydrationScript, getAssets, hydrate, render, renderToStringAsync }',
    )
    expect(code).toContain('if (import.meta.env.DEV) {')
    expect(code).toContain('return render(component, element)')
    expect(code).toContain("return ('_$HY' in window ? hydrate : render)(component, element)")
  })

  it('emits router-entry server slots and does not include the solid plugin', () => {
    const plugins = fileRouter()
    const code = getRouterEntryCodeFromPlugins(plugins)
    expect(code).toContain('const assets = getAssets()')
    expect(code).toContain('slots: {')
    expect(code).toContain('app: html')
    expect(code).toContain("head: hydrationScript + (extra || '')")
    expect(code).toContain('assets,')
    expect(plugins.some((plugin) => plugin.name === 'solid')).toBe(false)
  })

  it('enables the SSG plugin when ssg config is provided', () => {
    const options = {
      ssg: {
        routes: ['/'],
      },
    } satisfies Parameters<typeof fileRouter>[0]
    const plugins = fileRouter(options)
    expect(plugins.some((plugin) => plugin.name === 'solid-file-router:ssg')).toBe(true)
  })

  it('warns when ssg config is provided without solid ssr enabled', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      await resolveConfig(
        {
          configFile: false,
          root: fileURLToPath(new URL('./fixtures/modes/basic', import.meta.url)),
          logLevel: 'silent',
          plugins: [solidPlugin(), ...fileRouter({ ssg: { routes: ['/'] } })],
          build: {
            outDir: '.tmp-plugin-test',
          },
        },
        'build',
      )

      expect(warnSpy).toHaveBeenCalledWith(
        'SSG config was ignored because vite-plugin-solid is not configured with { ssr: true }',
        { timestamp: true },
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
