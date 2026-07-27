import { createComponent } from 'solid-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerEntry, readRouteInfo } from '../src/runtime'

const mocks = vi.hoisted(() => ({
  fileRouter: vi.fn(() => null),
}))

vi.mock('solid-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('solid-js')>()
  return {
    ...original,
    createComponent: vi.fn(original.createComponent),
  }
})

vi.mock('virtual:routes', () => ({
  FileRouter: mocks.fileRouter,
}))

beforeEach(() => {
  vi.mocked(createComponent).mockClear()
  mocks.fileRouter.mockClear()
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

  it('mounts the default file router with one component boundary', async () => {
    const renderServer = await createServerEntry()

    await renderServer({ url: '/docs' })

    const fileRouterCall = vi
      .mocked(createComponent)
      .mock.calls.find(([component]) => component === mocks.fileRouter)
    expect(fileRouterCall).toBeDefined()
    expect(fileRouterCall?.[1].url).toBe('/docs')
    expect(fileRouterCall?.[1].base).toBe('/')
  })
})
