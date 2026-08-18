/**
 * Materialization, as a table (ADR 0013).
 *
 * The claims under test are the ones the ticket names by name: **pure and
 * deterministic — same inputs, same Items; run twice, nothing doubles**;
 * feeding Items derive from Feed Schedules and split on medication; a
 * weather-conditional Item exists only where its Condition resolved true, and
 * only one of an alternate pair (Sheet, Blanket) is ever made; a Prep Item
 * names the Shift Type it is owed to; and "not yet decided" renders as an
 * unanswered question rather than as no work.
 *
 * Pure throughout: no database, no clock, no Reading fetch. What the catalogue
 * says, what the rescue decided and what a Reading resolved are the caller's
 * problem; everything past that point is arithmetic this table exercises
 * directly.
 */
import { describe, expect, it } from 'vitest'

import {
  materializeDay,
  type FeedLine,
  type MaterializeInput,
  type ShiftOccurrence,
  type TaskAssignmentRecord,
  type TaskCatalog,
} from './materialization'
import { dayString } from './time'

const DAY = dayString('2026-01-14')

const AM: ShiftOccurrence = { id: 'shift-am', shiftType: 'feed_am' }
const PM: ShiftOccurrence = { id: 'shift-pm', shiftType: 'feed_pm' }

const BASE: MaterializeInput = {
  day: DAY,
  shifts: [AM, PM],
  tasks: [],
  assignments: [],
  horses: [{ id: 'apollo' }, { id: 'dawson' }],
  spaces: [{ id: 'field-c' }],
  feedLines: [],
  conditionAnswers: [],
}

function of(overrides: Partial<MaterializeInput>): MaterializeInput {
  return { ...BASE, ...overrides }
}

describe('feeding Items', () => {
  const APOLLO_GRAIN: FeedLine = { horseId: 'apollo', shiftType: 'feed_am', productKind: 'feed' }
  const APOLLO_MED: FeedLine = {
    horseId: 'apollo',
    shiftType: 'feed_am',
    productKind: 'medication',
  }

  it('gives a horse with a non-medication line a Feed Item', () => {
    const items = materializeDay(of({ feedLines: [APOLLO_GRAIN] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'feed',
      horseId: 'apollo',
      shiftId: 'shift-am',
      requiresMedicationAuthority: false,
    })
  })

  it('gives a horse with a medication line a separate Medicate Item that requires Medication Authority', () => {
    const items = materializeDay(of({ feedLines: [APOLLO_GRAIN, APOLLO_MED] }))
    const kinds = items.map((item) => item.kind).sort()
    expect(kinds).toEqual(['feed', 'medicate'])
    const medicate = items.find((item) => item.kind === 'medicate')
    expect(medicate?.requiresMedicationAuthority).toBe(true)
  })

  it('gives no Feed Item to a horse with no line for that Shift', () => {
    const items = materializeDay(of({ feedLines: [APOLLO_GRAIN] }))
    expect(items.some((item) => item.horseId === 'dawson')).toBe(false)
  })

  it('gives one Feed Item per Shift, not one for the whole day', () => {
    const items = materializeDay(
      of({
        feedLines: [APOLLO_GRAIN, { horseId: 'apollo', shiftType: 'feed_pm', productKind: 'feed' }],
      }),
    )
    expect(items.filter((item) => item.kind === 'feed')).toHaveLength(2)
    expect(items.map((item) => item.shiftId).sort()).toEqual(['shift-am', 'shift-pm'])
  })
})

describe('Task Assignment, generalizing the GROOM column', () => {
  const MUCK: TaskCatalog = {
    id: 'muck',
    subjectKind: 'space',
    priority: 'essential',
    period: 'day',
    requiresMedicationAuthority: false,
    conditionName: null,
    prepForShiftType: null,
    closing: false,
    instructionText: 'Muck the stalls.',
  }

  it('materializes an assigned Task with its Shift Type as a hint', () => {
    const assignment: TaskAssignmentRecord = {
      taskId: 'muck',
      horseId: null,
      spaceId: 'field-c',
      stance: 'assigned',
      shiftType: 'feed_am',
      instructionText: null,
    }
    const items = materializeDay(of({ tasks: [MUCK], assignments: [assignment] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      spaceId: 'field-c',
      shiftId: null,
      assignedShiftType: 'feed_am',
      assignmentUndecided: false,
    })
  })

  it('materializes nothing for a Subject deliberately assigned to none', () => {
    const assignment: TaskAssignmentRecord = {
      taskId: 'muck',
      horseId: null,
      spaceId: 'field-c',
      stance: 'deliberately_none',
      shiftType: null,
      instructionText: null,
    }
    const items = materializeDay(of({ tasks: [MUCK], assignments: [assignment] }))
    expect(items).toHaveLength(0)
  })

  it('still materializes work for a Subject nobody has decided — an unanswered question, never no work', () => {
    const items = materializeDay(of({ tasks: [MUCK], assignments: [] }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ assignedShiftType: null, assignmentUndecided: true })
  })

  it('belongs to the day rather than to one Shift, for a per-Day Task', () => {
    const items = materializeDay(of({ tasks: [MUCK] }))
    expect(items[0]?.shiftId).toBeNull()
  })

  it('materializes once per Shift for a per-Shift Task', () => {
    const perShift: TaskCatalog = { ...MUCK, period: 'shift' }
    const items = materializeDay(of({ tasks: [perShift] }))
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.shiftId).sort()).toEqual(['shift-am', 'shift-pm'])
  })

  it('combines generic and subject-specific instruction text, generic first', () => {
    const assignment: TaskAssignmentRecord = {
      taskId: 'muck',
      horseId: null,
      spaceId: 'field-c',
      stance: 'assigned',
      shiftType: 'feed_am',
      instructionText: 'Fill D trough to the top.',
    }
    const items = materializeDay(of({ tasks: [MUCK], assignments: [assignment] }))
    expect(items[0]?.instructionText).toBe('Muck the stalls. Fill D trough to the top.')
  })

  it('materializes once per Subject and never doubles a Subject that already has an Item', () => {
    const items = materializeDay(of({ tasks: [MUCK] }))
    const bySpace = items.filter((item) => item.spaceId === 'field-c')
    expect(bySpace).toHaveLength(1)
  })
})

describe('a Task with a Condition gate', () => {
  const BLANKET: TaskCatalog = {
    id: 'blanket',
    subjectKind: 'horse',
    priority: 'essential',
    period: 'shift',
    requiresMedicationAuthority: false,
    conditionName: 'blanket_weather',
    prepForShiftType: null,
    closing: false,
    instructionText: 'Blanket.',
  }
  const SHEET: TaskCatalog = { ...BLANKET, id: 'sheet', conditionName: 'sheet_weather' }

  it('materializes only where the Condition resolved true for that Subject', () => {
    const items = materializeDay(
      of({
        tasks: [BLANKET],
        shifts: [AM],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: true,
            readingId: 'r1',
          },
        ],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.conditionReadingId).toBe('r1')
  })

  it('materializes nothing where the Condition resolved false', () => {
    const items = materializeDay(
      of({
        tasks: [BLANKET],
        shifts: [AM],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: false,
            readingId: 'r1',
          },
        ],
      }),
    )
    expect(items).toHaveLength(0)
  })

  it('materializes nothing where the Condition is unresolved — not a false one', () => {
    const items = materializeDay(
      of({
        tasks: [BLANKET],
        shifts: [AM],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: null,
            readingId: 'r1',
          },
        ],
      }),
    )
    expect(items).toHaveLength(0)
  })

  it('materializes nothing for a Subject the Reading never answered at all', () => {
    const items = materializeDay(of({ tasks: [BLANKET], shifts: [AM], horses: [{ id: 'apollo' }] }))
    expect(items).toHaveLength(0)
  })

  it('reads a shift-scoped Condition against that Shift’s own window, never another Shift’s', () => {
    const items = materializeDay(
      of({
        tasks: [BLANKET],
        shifts: [AM, PM],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: true,
            readingId: 'r1',
          },
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: PM.id,
            holds: false,
            readingId: 'r2',
          },
        ],
      }),
    )
    expect(items.map((item) => item.shiftId)).toEqual(['shift-am'])
  })

  it('makes only one of an alternate pair — Sheet and Blanket never both materialize for the same horse', () => {
    // `resolveConditions` in `conditions.ts` already makes the two mutually
    // exclusive by construction; this asserts materialization respects
    // whatever it decided rather than gating on both independently.
    const items = materializeDay(
      of({
        tasks: [BLANKET, SHEET],
        shifts: [AM],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          {
            condition: 'blanket_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: true,
            readingId: 'r1',
          },
          {
            condition: 'sheet_weather',
            horseId: 'apollo',
            shiftId: AM.id,
            holds: false,
            readingId: 'r1',
          },
        ],
      }),
    )
    expect(items.map((item) => item.taskId)).toEqual(['blanket'])
  })

  it('reads a rescue-scoped Condition against the barn answer regardless of the Item’s own Subject', () => {
    const stayingIn: TaskCatalog = {
      id: 'staying-in-hay',
      subjectKind: 'horse',
      priority: 'essential',
      period: 'day',
      requiresMedicationAuthority: false,
      conditionName: 'staying_in',
      prepForShiftType: null,
      closing: false,
      instructionText: 'Alternate hay plan.',
    }
    const items = materializeDay(
      of({
        tasks: [stayingIn],
        horses: [{ id: 'apollo' }],
        conditionAnswers: [
          { condition: 'staying_in', horseId: null, shiftId: null, holds: true, readingId: 'r1' },
        ],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.horseId).toBe('apollo')
  })
})

describe('Prep', () => {
  const SOAK: TaskCatalog = {
    id: 'soak-lunch',
    subjectKind: 'horse',
    priority: 'essential',
    period: 'shift',
    requiresMedicationAuthority: false,
    conditionName: null,
    prepForShiftType: 'lunch',
    closing: false,
    instructionText: 'Soak for lunch.',
  }

  it('names the Shift Type the Prep is owed to', () => {
    const items = materializeDay(of({ tasks: [SOAK], shifts: [AM], horses: [{ id: 'apollo' }] }))
    expect(items.map((item) => item.prepForShiftType)).toEqual(['lunch'])
  })
})

describe('determinism', () => {
  const MUCK: TaskCatalog = {
    id: 'muck',
    subjectKind: 'space',
    priority: 'essential',
    period: 'day',
    requiresMedicationAuthority: false,
    conditionName: null,
    prepForShiftType: null,
    closing: false,
    instructionText: 'Muck the stalls.',
  }
  const APOLLO_GRAIN: FeedLine = { horseId: 'apollo', shiftType: 'feed_am', productKind: 'feed' }

  it('gives the same Items, key for key, for the same inputs run twice', () => {
    const input = of({ tasks: [MUCK], feedLines: [APOLLO_GRAIN] })
    expect(materializeDay(input)).toEqual(materializeDay(input))
  })

  it('gives every Item a distinct key', () => {
    const items = materializeDay(of({ tasks: [MUCK], feedLines: [APOLLO_GRAIN] }))
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length)
  })
})
