import { describe, expect, it } from 'vitest'

import {
  compareTimeline,
  isTimelineKind,
  TIMELINE_KINDS,
  TIMELINE_KIND_LABEL,
  type Placeable,
} from './timeline'

function entry(id: string, at: number): Placeable {
  return { id, at }
}

describe('the order of a Timeline', () => {
  it('puts the newest first', () => {
    const ordered = [entry('a', 100), entry('b', 300), entry('c', 200)].sort(compareTimeline)

    expect(ordered.map((one) => one.id)).toEqual(['b', 'c', 'a'])
  })

  it('breaks a tie on the id, so two reads of one horse agree', () => {
    // Two records written in the same millisecond is not hypothetical: a Feed
    // Schedule version and the measurement recorded beside it at one desk land
    // together, and a comparator returning 0 there leaves the order to whatever
    // the database happened to return.
    const ordered = [entry('z', 100), entry('a', 100), entry('m', 100)].sort(compareTimeline)

    expect(ordered.map((one) => one.id)).toEqual(['a', 'm', 'z'])
  })

  it('is a total order, so sorting twice does not move anything', () => {
    const rows = [entry('b', 200), entry('a', 200), entry('c', 100), entry('d', 300)]

    const once = [...rows].sort(compareTimeline)
    const twice = [...once].sort(compareTimeline)

    expect(twice).toEqual(once)
  })
})

describe('the vocabulary', () => {
  it('names every kind the profile can render', () => {
    expect([...TIMELINE_KINDS]).toEqual([
      'observation',
      'alert_raised',
      'alert_ended',
      'measurement',
      'feed_schedule',
    ])
  })

  it('has a label for every kind, so a sixth does not compile without one', () => {
    for (const kind of TIMELINE_KINDS) {
      expect(TIMELINE_KIND_LABEL[kind]).toBeTruthy()
    }
  })

  it('refuses a kind this build does not know', () => {
    expect(isTimelineKind('observation')).toBe(true)
    expect(isTimelineKind('adoption')).toBe(false)
  })
})
