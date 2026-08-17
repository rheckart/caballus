import { describe, expect, it } from 'vitest'

import { json, noContent, rebuild } from './answer'

/**
 * The claim these hold: what `rebuild` makes from a stored status and body is
 * what the builder made in the first place. Everything ADR 0020 promises a
 * retry rests on that, and the status and body already matching is exactly
 * what hid it going wrong (#30).
 */
async function sameAnswer(first: Response, replayed: Response): Promise<void> {
  expect(replayed.status).toBe(first.status)
  expect([...replayed.headers]).toEqual([...first.headers])
  await expect(replayed.text()).resolves.toEqual(await first.text())
}

/** What a store keeps of an answer, and all it keeps. */
async function stored(answer: Response): Promise<Response> {
  return rebuild(await answer.text(), answer.status)
}

describe('json', () => {
  it('rebuilds as the answer it was', async () => {
    const first = json({ recorded: true }, 201)
    await sameAnswer(json({ recorded: true }, 201), await stored(first))
  })

  it('says null rather than nothing when there is nothing to say', async () => {
    // `JSON.stringify(undefined)` is not a string, and an answer with a content
    // type over an empty body replays as one with neither — the divergence
    // this whole module exists to make impossible.
    await expect(json(undefined).text()).resolves.toBe('null')
    await sameAnswer(json(undefined), await stored(json(undefined)))
  })

  it('refuses a status that may not carry a body, and names the door that can', () => {
    expect(() => json({ recorded: true }, 204)).toThrow(/noContent/)
  })
})

describe('noContent', () => {
  it('claims no type, because it has no body to have a type', async () => {
    const first = noContent()

    expect(first.status).toBe(204)
    expect(first.headers.get('content-type')).toBeNull()
    await sameAnswer(first, await stored(noContent()))
  })
})
