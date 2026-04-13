import { describe, expect, it } from 'vitest'

import { readRouteInfo } from '../src/runtime'

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
