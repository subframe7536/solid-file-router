import { createComponent } from 'solid-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createServerEntry, readRouteInfo } from '../src/runtime'

vi.mock('solid-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('solid-js')>()
  return {
    ...original,
    createComponent: vi.fn(original.createComponent),
  }
})

beforeEach(() => {
  vi.mocked(createComponent).mockClear()
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
