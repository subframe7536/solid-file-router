import { describe, it, expect } from 'vitest'
import { generatePath } from '../src/runtime'

declare module '../src/runtime' {
  interface FileRoutePath {
    [x: string]: any
  }
}

describe('generatePath', () => {
  it('returns path when params is undefined', () => {
    expect(generatePath('/home', undefined as any)).toBe('/home')
  })

  it('replaces dynamic segment with $ prefixed key', () => {
    expect(generatePath('/user/:id', { $id: '123' } as any)).toBe('/user/123')
  })

  it('appends query params', () => {
    expect(generatePath('/user/:id', { $id: '123', q: 'abc' } as any)).toBe('/user/123?q=abc')
  })
})
