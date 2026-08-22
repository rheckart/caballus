import { describe, expect, it } from 'vitest'

import { ALERT_KINDS, compareAlerts, isAlertKind, type Alertish } from './alerts'

function alert(kind: string, raisedAt: number, id = String(raisedAt)): Alertish {
  return { id, kind: kind as Alertish['kind'], raisedAt }
}

describe('the Alert vocabulary', () => {
  it('is exactly three kinds, and a fourth is a deploy (ADR 0024)', () => {
    expect([...ALERT_KINDS]).toEqual(['prohibition', 'care', 'allergy'])
  })

  it('recognises a stored kind this build can name, and refuses one it cannot', () => {
    expect(ALERT_KINDS.every((kind) => isAlertKind(kind))).toBe(true)
    expect(isAlertKind('behaviour')).toBe(false)
    expect(isAlertKind('')).toBe(false)
  })
})

describe('the order the three surfaces agree on', () => {
  it('puts a prohibition first, then care, then an allergy', () => {
    const ordered = [alert('allergy', 3), alert('care', 2), alert('prohibition', 1)]
      .sort(compareAlerts)
      .map((entry) => entry.kind)
    expect(ordered).toEqual(['prohibition', 'care', 'allergy'])
  })

  it('puts the older of two same-kind Alerts first, so the wall does not reshuffle', () => {
    const ordered = [alert('care', 200), alert('care', 100)].sort(compareAlerts).map((e) => e.id)
    expect(ordered).toEqual(['100', '200'])
  })

  it('falls back to the id when two were raised in the same millisecond', () => {
    const ordered = [alert('care', 100, 'b'), alert('care', 100, 'a')]
      .sort(compareAlerts)
      .map((e) => e.id)
    expect(ordered).toEqual(['a', 'b'])
  })
})
