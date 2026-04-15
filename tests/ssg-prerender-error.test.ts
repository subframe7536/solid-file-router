import { describe, it, expect } from 'vitest'

import { assertAllFulfilled } from '../src/ssg/index'

interface MockPrerenderResult {
  url: string
  result: {}
}

describe('SSG prerender error handling', () => {
  it('throws when any render rejects', () => {
    const results = [
      {
        status: 'fulfilled',
        value: { url: '/ok', result: {} },
      } as PromiseFulfilledResult<MockPrerenderResult>,
      { status: 'rejected', reason: new Error('boom') } as PromiseRejectedResult,
    ] as Array<PromiseSettledResult<MockPrerenderResult>>

    expect(() => assertAllFulfilled(results, ['/ok', '/boom'])).toThrow(
      /SSG prerender failed for \/boom/,
    )
  })

  it('does not throw when all fulfilled', () => {
    const results = [
      {
        status: 'fulfilled',
        value: { url: '/a', result: {} },
      } as PromiseFulfilledResult<MockPrerenderResult>,
      {
        status: 'fulfilled',
        value: { url: '/b', result: {} },
      } as PromiseFulfilledResult<MockPrerenderResult>,
    ] as Array<PromiseSettledResult<MockPrerenderResult>>

    expect(() => assertAllFulfilled(results, ['/a', '/b'])).not.toThrow()
  })
})
