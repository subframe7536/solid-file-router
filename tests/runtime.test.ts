import type { RouteSectionProps } from '@solidjs/router'
import { createComponent, ErrorBoundary, Suspense } from 'solid-js'
import { hydrate, render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __loader__, createClientEntry, createServerEntry, readRouteInfo } from '../src/runtime'

vi.mock('solid-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('solid-js')>()
  return {
    ...original,
    createComponent: vi.fn(original.createComponent),
  }
})

vi.mock('solid-js/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('solid-js/web')>()
  return {
    ...original,
    hydrate: vi.fn(),
    render: vi.fn(),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('readRouteInfo', () => {
  it('reads the last matched route info from router matches', () => {
    expect(
      readRouteInfo([
        { route: { info: { title: 'parent' } } },
        { route: { info: { title: 'child' } } },
      ]),
    ).toStrictEqual({ title: 'child' })
  })

  it('falls back to direct match info when present', () => {
    expect(readRouteInfo([{ info: { title: 'standalone' } }])).toStrictEqual({
      title: 'standalone',
    })
  })
})

describe('createServerEntry', () => {
  it('invokes a custom root render without adding a component boundary', async () => {
    const customRender = vi.fn((props: { url: string; base: string }) => {
      expect(props.url).toBe('/docs')
      expect(props.base).toBe('/')
      return null
    })
    const renderServer = await createServerEntry(customRender)

    await renderServer({ url: '/docs' })

    expect(customRender).toHaveBeenCalledOnce()
    expect(vi.mocked(createComponent)).not.toHaveBeenCalledWith(customRender, expect.anything())
  })
})

describe('__loader__', () => {
  const noComponent = undefined as never
  const routeProps = {
    data: undefined,
    params: { id: '42' },
    location: new URL('https://example.com/items/42'),
    navigate: vi.fn(),
    outlet: vi.fn(),
  } as unknown as RouteSectionProps

  it('renders the route component directly when no loading component is provided', () => {
    const component = vi.fn(() => null)
    const wrapped = __loader__(component, noComponent, noComponent)

    wrapped(routeProps)

    expect(component).toHaveBeenCalledWith(routeProps)
  })

  it('passes route-section props to the loading component', () => {
    const component = vi.fn(() => null)
    const loading = vi.fn(() => null)
    const wrapped = __loader__(component, loading, noComponent)

    wrapped(routeProps)

    const suspenseCall = vi
      .mocked(createComponent)
      .mock.calls.find(([component]) => component === Suspense)
    expect(suspenseCall).toBeDefined()

    const suspenseProps = suspenseCall?.[1] as {
      readonly fallback: unknown
    }
    void suspenseProps.fallback

    expect(loading).toHaveBeenCalledWith(routeProps)
  })

  it('passes the boundary error and reset callback to the explicit error component', () => {
    const component = vi.fn(() => null)
    const errorComponent = vi.fn(() => null)
    const wrapped = __loader__(component, noComponent, errorComponent)

    wrapped(routeProps)

    const boundaryCall = vi
      .mocked(createComponent)
      .mock.calls.find(([component]) => component === ErrorBoundary)
    expect(boundaryCall).toBeDefined()

    const boundaryProps = boundaryCall?.[1] as {
      readonly fallback: (error: Error, reset: VoidFunction) => unknown
    }
    const error = new Error('route failed')
    const reset = vi.fn()
    boundaryProps.fallback(error, reset)

    expect(errorComponent).toHaveBeenCalledWith({ error, reset })
  })

  it('logs and renders nothing in development when no error component is provided', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const component = vi.fn(() => null)
    const wrapped = __loader__(component, noComponent, noComponent)

    wrapped(routeProps)

    const boundaryCall = vi
      .mocked(createComponent)
      .mock.calls.find(([component]) => component === ErrorBoundary)
    expect(boundaryCall).toBeDefined()

    const boundaryProps = boundaryCall?.[1] as {
      readonly fallback: (error: Error, reset: VoidFunction) => unknown
    }
    const error = new Error('route failed')
    const reset = vi.fn()

    expect(boundaryProps.fallback(error, reset)).toBeNull()
    expect(consoleError).toHaveBeenCalledWith(error)
  })
})

describe('createClientEntry', () => {
  const component = (() => null) as Parameters<typeof createClientEntry>[0]
  const mount = {} as Parameters<typeof createClientEntry>[1]

  it('renders in development', () => {
    vi.stubEnv('DEV', true)

    createClientEntry(component, mount)

    expect(render).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledWith(component, mount)
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('hydrates in production when the hydration marker exists', () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { _$HY: {} })

    createClientEntry(component, mount)

    expect(hydrate).toHaveBeenCalledOnce()
    expect(hydrate).toHaveBeenCalledWith(component, mount)
    expect(render).not.toHaveBeenCalled()
  })

  it('renders in production when the hydration marker does not exist', () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', {})

    createClientEntry(component, mount)

    expect(render).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledWith(component, mount)
    expect(hydrate).not.toHaveBeenCalled()
  })
})
