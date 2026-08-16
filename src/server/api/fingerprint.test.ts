import { describe, expect, it } from 'vitest'

import { fingerprint } from './fingerprint'

const KEY = '019267c0-6f7e-7a3d-9c2f-2f9a1c7e5b10'

describe('fingerprint', () => {
  it('is the same for the same request sent twice', () => {
    const first = fingerprint('POST /observations', { note: 'gate latch', idempotencyKey: KEY })
    const second = fingerprint('POST /observations', { note: 'gate latch', idempotencyKey: KEY })

    expect(first).toEqual(second)
  })

  it('ignores the order the keys arrived in', () => {
    // A client that reserialises its queue between attempts — which any
    // IndexedDB round trip may — must not have its retry read as a conflict.
    const first = fingerprint('POST /observations', { note: 'gate latch', idempotencyKey: KEY })
    const second = fingerprint('POST /observations', { idempotencyKey: KEY, note: 'gate latch' })

    expect(first).toEqual(second)
  })

  it('keeps the order of an array, because a list is not a bag', () => {
    const first = fingerprint('POST /ticks', { items: ['hay', 'water'] })
    const second = fingerprint('POST /ticks', { items: ['water', 'hay'] })

    expect(first).not.toEqual(second)
  })

  it('is different when the body says something else', () => {
    const first = fingerprint('POST /observations', { note: 'gate latch', idempotencyKey: KEY })
    const second = fingerprint('POST /observations', { note: 'gate open', idempotencyKey: KEY })

    expect(first).not.toEqual(second)
  })

  it('is different when the same key is sent to another route', () => {
    // Two endpoints reached with one key is the same client bug as two bodies,
    // and it must not be answered with the other endpoint's response.
    const first = fingerprint('POST /observations', { idempotencyKey: KEY })
    const second = fingerprint('POST /attendance', { idempotencyKey: KEY })

    expect(first).not.toEqual(second)
  })

  it('tells a nested change from an unchanged one', () => {
    const first = fingerprint('POST /ticks', { by: { volunteer: 'v_01J8', at: 3 } })
    const second = fingerprint('POST /ticks', { by: { at: 3, volunteer: 'v_01J8' } })
    const third = fingerprint('POST /ticks', { by: { at: 4, volunteer: 'v_01J8' } })

    expect(first).toEqual(second)
    expect(first).not.toEqual(third)
  })

  it('does not confuse an absent field with a null one', () => {
    const absent = fingerprint('POST /observations', { note: 'gate latch' })
    const nulled = fingerprint('POST /observations', { note: 'gate latch', horse: null })

    expect(absent).not.toEqual(nulled)
  })
})
