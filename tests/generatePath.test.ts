import { describe, it, expect } from 'vitest'

import { generatePath } from '../src/index'

declare module '../src/index' {
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

  it('omits optional parameters when they are not provided', () => {
    expect(generatePath('/docs/:lang?/resources', {} as any)).toBe('/docs/resources')
    expect(generatePath('/:lang?', {} as any)).toBe('/')
    expect(generatePath('/docs/:lang?/resources', { $lang: 'en' } as any)).toBe(
      '/docs/en/resources',
    )
  })

  it('replaces repeated parameters and splats', () => {
    expect(generatePath('/compare/:id/:id', { $id: '42' } as any)).toBe('/compare/42/42')
    expect(generatePath('/files/*', { '*': 'a/b' } as any)).toBe('/files/a/b')
    expect(generatePath('/files/*?', {} as any)).toBe('/files')
  })

  it('throws when a required parameter is missing', () => {
    expect(() => generatePath('/user/:id', {} as any)).toThrow(
      'Missing required route parameter "$id"',
    )
    expect(() => generatePath('/files/*', {} as any)).toThrow(
      'Missing required route parameter "*"',
    )
  })
})
