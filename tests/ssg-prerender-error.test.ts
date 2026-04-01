import { describe, it, expect } from 'vitest'

import { assertAllFulfilled } from '../src/ssg/index'

describe('SSG prerender error handling', () => {
  it('throws when any render rejects', () => {
    const results = [
      { status: 'fulfilled', value: { url: '/ok', result: {} } } as PromiseFulfilledResult<any>,
      { status: 'rejected', reason: new Error('boom') } as PromiseRejectedResult,
    ] as Array<PromiseSettledResult<any>>

    expect(() => assertAllFulfilled(results, ['/ok', '/boom'])).toThrow(
      /SSG prerender failed for \/boom/,
    )
  })

  it('does not throw when all fulfilled', () => {
    const results = [
      { status: 'fulfilled', value: { url: '/a', result: {} } } as PromiseFulfilledResult<any>,
      { status: 'fulfilled', value: { url: '/b', result: {} } } as PromiseFulfilledResult<any>,
    ] as Array<PromiseSettledResult<any>>

    expect(() => assertAllFulfilled(results, ['/a', '/b'])).not.toThrow()
  })
})
