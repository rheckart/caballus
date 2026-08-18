/**
 * The Sheets and Blankets panel, as a table (ADR 0015).
 *
 * This is the test the ticket asks for by name: *table-driven tests encode the
 * Sheets and Blankets panel, Storm included*. The numbers are the whiteboard's,
 * transcribed in `prototypes/feed-board-prototype.html` from the August photos
 * — default sheet 40 and blanket 30, Dawson and Apollo at 50 and 35, Storm at
 * 35 and 20 — and the claim being made is ADR 0015's opening sentence: at
 * 38 °F, Dawson and Apollo get sheets, the rest of the horses get sheets, and
 * **Storm gets nothing**. One predicate, one hour, three answers.
 *
 * Pure throughout: no database, no clock, no forecast. What a Reading read is
 * the caller's problem; everything past that point is arithmetic a table
 * exercises directly.
 */
import { describe, expect, it } from 'vitest'

import {
  hoursWithin,
  resolveConditions,
  resolveThreshold,
  windowFor,
  type HourReading,
  type Resolution,
  type ThresholdSet,
} from './conditions'
import { dayString, instant, type Instant } from './time'
import { conditionsScoped } from './weather'

const DAY = dayString('2026-01-14')
const NEXT_DAY = dayString('2026-01-15')

/** Midnight of `DAY`, in whatever zone the caller resolved — the tests only ever step by hours. */
const MIDNIGHT = instant(1_768_366_800_000)
const HOUR = 3_600_000

function at(hour: number): Instant {
  return instant(MIDNIGHT + hour * HOUR)
}

/** One hour of a forecast, with only the fields a case cares about set. */
function hour(
  ofDay: number,
  values: {
    air?: number | null
    apparent?: number | null
    wet?: boolean | null
    day?: typeof DAY
  } = {},
): HourReading {
  return {
    at: at(ofDay),
    day: values.day ?? DAY,
    hour: ofDay % 24,
    airTempF: values.air ?? null,
    apparentTempF: values.apparent ?? null,
    precipitation: values.wet ?? null,
  }
}

/** The whole of `DAY`, as a window. */
const WHOLE_DAY = { from: at(0), to: at(24) }

/**
 * The panel's numbers. Blue is on the default **deliberately**, Mystery has
 * never been decided, and the two are different facts (ADR 0015).
 */
const PANEL: ThresholdSet = {
  defaults: {
    sheet: 40,
    blanket: 30,
    staying_in: 85,
    fly_sheet_max: 90,
    cold_and_wet: 45,
  },
  horses: {
    dawson: {
      sheet: { stance: 'overridden', value: 50 },
      blanket: { stance: 'overridden', value: 35 },
    },
    apollo: {
      sheet: { stance: 'overridden', value: 50 },
      blanket: { stance: 'overridden', value: 35 },
    },
    storm: {
      sheet: { stance: 'overridden', value: 35 },
      blanket: { stance: 'overridden', value: 20 },
    },
    blue: { sheet: { stance: 'follows_default' }, blanket: { stance: 'follows_default' } },
    mystery: {},
  },
}

const HORSES = [
  { id: 'dawson' },
  { id: 'apollo' },
  { id: 'storm' },
  { id: 'blue' },
  { id: 'mystery' },
]

function garmentAt(airTempF: number): Map<string, string> {
  const resolved = resolveConditions({
    conditions: ['blanket_weather', 'sheet_weather'],
    hours: [hour(6, { air: airTempF }), hour(7, { air: airTempF + 6 })],
    window: WHOLE_DAY,
    thresholds: PANEL,
    horses: HORSES,
  })

  const worn = new Map<string, string>()
  for (const resolution of resolved) {
    if (resolution.holds !== true || resolution.horseId === null) continue
    const already = worn.get(resolution.horseId)
    // Two garments for one horse is the failure the construction exists to
    // prevent, so the map records it loudly rather than overwriting.
    worn.set(
      resolution.horseId,
      already === undefined ? resolution.condition : `${already}+${resolution.condition}`,
    )
  }
  return worn
}

describe('the Sheets and Blankets panel', () => {
  /**
   * The whiteboard, temperature by temperature. Each row is the coldest hour
   * of the window and what every horse on the panel is wearing at it.
   */
  const table: readonly {
    readonly at: number
    readonly worn: Readonly<Record<string, string>>
  }[] = [
    // ADR 0015's own sentence: sheets for everybody but Storm.
    {
      at: 38,
      worn: {
        dawson: 'sheet_weather',
        apollo: 'sheet_weather',
        blue: 'sheet_weather',
        mystery: 'sheet_weather',
      },
    },
    // A mild afternoon: nobody is dressed, Dawson and Apollo included.
    { at: 55, worn: {} },
    // Between the two overrides: the named horses get sheets and the default
    // horses do not, which is the reason the override exists.
    { at: 45, worn: { dawson: 'sheet_weather', apollo: 'sheet_weather' } },
    // At the default sheet number exactly — *under 40* is not *at 40*.
    { at: 40, worn: { dawson: 'sheet_weather', apollo: 'sheet_weather' } },
    // A cold morning: the two named horses tip into blankets while the rest
    // are still in sheets, and Storm is finally in something.
    {
      at: 32,
      worn: {
        dawson: 'blanket_weather',
        apollo: 'blanket_weather',
        blue: 'sheet_weather',
        mystery: 'sheet_weather',
        storm: 'sheet_weather',
      },
    },
    // A January night. Everybody is in a blanket except Storm, who is in a
    // sheet at 25 because his blanket number is 20.
    {
      at: 25,
      worn: {
        dawson: 'blanket_weather',
        apollo: 'blanket_weather',
        blue: 'blanket_weather',
        mystery: 'blanket_weather',
        storm: 'sheet_weather',
      },
    },
    // Hard cold: every horse on the panel, Storm included.
    {
      at: 15,
      worn: {
        dawson: 'blanket_weather',
        apollo: 'blanket_weather',
        blue: 'blanket_weather',
        mystery: 'blanket_weather',
        storm: 'blanket_weather',
      },
    },
  ]

  for (const row of table) {
    it(`dresses the barn at ${String(row.at)} °F`, () => {
      expect(Object.fromEntries(garmentAt(row.at))).toEqual(row.worn)
    })
  }

  it('never puts a horse in two garments, at any temperature the panel covers', () => {
    for (let temperature = -20; temperature <= 70; temperature += 1) {
      for (const [horseId, garment] of garmentAt(temperature)) {
        // The failure this would catch is a horse wearing `sheet_weather+blanket_weather`
        // at one temperature, which is the volunteer-decides-which outcome the
        // construction exists to remove.
        expect(`${horseId} at ${String(temperature)} °F: ${garment}`).toBe(
          `${horseId} at ${String(temperature)} °F: ${garment.split('+')[0] ?? ''}`,
        )
      }
    }
  })

  it('dresses the horse for the coldest hour of the window, not the last one', () => {
    // A window that touches 25 and 45 is a night the horse spends at 25.
    const resolved = resolveConditions({
      conditions: ['blanket_weather', 'sheet_weather'],
      hours: [hour(18, { air: 45 }), hour(22, { air: 25 }), hour(23, { air: 31 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })

    expect(held(resolved, 'blanket_weather', 'blue')).toMatchObject({
      holds: true,
      readingValue: 25,
      atHour: 22,
    })
    expect(held(resolved, 'sheet_weather', 'blue')?.holds).toBe(false)
  })
})

describe('where the number comes from', () => {
  it('reads an override as an override', () => {
    expect(resolveThreshold(PANEL, 'sheet', 'dawson')).toEqual({ value: 50, source: 'override' })
  })

  it('reads a deliberate agreement with the default as the default', () => {
    expect(resolveThreshold(PANEL, 'sheet', 'blue')).toEqual({ value: 40, source: 'default' })
  })

  /**
   * The third state, and the one that is load-bearing: a horse nobody has
   * decided for **still gets its sheet**, using the rescue default, and the
   * answer says so rather than reporting agreement nobody expressed.
   */
  it('gives an undecided horse the default, and says it is undecided', () => {
    expect(resolveThreshold(PANEL, 'sheet', 'mystery')).toEqual({ value: 40, source: 'undecided' })

    const resolved = resolveConditions({
      conditions: ['sheet_weather'],
      hours: [hour(6, { air: 38 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'mystery' }],
    })
    expect(held(resolved, 'sheet_weather', 'mystery')).toMatchObject({
      holds: true,
      thresholdValue: 40,
      thresholdSource: 'undecided',
    })
  })

  it('gives a horse the app has never heard of the default, undecided', () => {
    expect(resolveThreshold(PANEL, 'sheet', 'a-new-intake')).toEqual({
      value: 40,
      source: 'undecided',
    })
  })

  it('has no answer at all when the rescue has not set the default', () => {
    const nothingSet: ThresholdSet = { defaults: {}, horses: {} }
    expect(resolveThreshold(nothingSet, 'sheet', 'blue')).toEqual({
      value: null,
      source: 'undecided',
    })

    const resolved = resolveConditions({
      conditions: ['sheet_weather'],
      hours: [hour(6, { air: 38 })],
      window: WHOLE_DAY,
      thresholds: nothingSet,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'sheet_weather', 'blue')).toMatchObject({
      holds: null,
      unresolved: 'no_threshold',
    })
  })

  it('answers the sheet rule with no blanket number, because a missing floor is no floor', () => {
    // A rescue that has set a sheet number and not a blanket one has a sheet
    // rule the app can answer; refusing to would leave the barn undressed on a
    // cold morning over a number nobody has needed yet.
    const sheetsOnly: ThresholdSet = { defaults: { sheet: 40 }, horses: {} }
    const resolved = resolveConditions({
      conditions: ['sheet_weather', 'blanket_weather'],
      hours: [hour(6, { air: 20 })],
      window: WHOLE_DAY,
      thresholds: sheetsOnly,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'sheet_weather', 'blue')).toMatchObject({ holds: true, atHour: 6 })
    // And the Blanket Condition, whose own number is the missing one, is
    // unresolved rather than false.
    expect(held(resolved, 'blanket_weather', 'blue')).toMatchObject({
      holds: null,
      unresolved: 'no_threshold',
    })
  })

  it('takes a rescue-wide number from the default even where a horse has an override', () => {
    // `staying_in` is not a per-horse kind, so a row against a horse cannot
    // change it — the answer is one for the barn (ADR 0015).
    const meddled: ThresholdSet = {
      defaults: PANEL.defaults,
      horses: { dawson: { staying_in: { stance: 'overridden', value: 60 } } },
    }
    expect(resolveThreshold(meddled, 'staying_in', 'dawson')).toEqual({
      value: 85,
      source: 'default',
    })
  })
})

describe('staying in', () => {
  /**
   * *Horses should only stay IN during the day if 85 real feel starts at noon
   * or before.* The rule is keyed to the shape of the forecast rather than to
   * a value, which is why it is its own kind of predicate.
   */
  it('holds when 85 real feel arrives before noon', () => {
    const resolved = resolveConditions({
      conditions: ['staying_in'],
      hours: [hour(9, { apparent: 79 }), hour(11, { apparent: 86 }), hour(15, { apparent: 94 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })

    expect(held(resolved, 'staying_in', null)).toMatchObject({
      holds: true,
      readingValue: 86,
      atHour: 11,
      thresholdValue: 85,
      metric: 'apparent_temp',
    })
  })

  it('holds when it arrives exactly at noon', () => {
    const resolved = resolveConditions({
      conditions: ['staying_in'],
      hours: [hour(12, { apparent: 85 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'staying_in', null)?.holds).toBe(true)
  })

  it('does not hold on a hotter day that gets hot after noon', () => {
    // The failure this predicate exists to avoid: 97 ° at four o'clock is a
    // hotter day than the one above and the horses go out on it.
    const resolved = resolveConditions({
      conditions: ['staying_in'],
      hours: [hour(11, { apparent: 84 }), hour(16, { apparent: 97 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'staying_in', null)).toMatchObject({ holds: false, atHour: 16 })
  })

  it('does not hold on a day that never reaches the number', () => {
    const resolved = resolveConditions({
      conditions: ['staying_in'],
      hours: [hour(10, { apparent: 70 }), hour(14, { apparent: 80 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'staying_in', null)).toMatchObject({ holds: false, atHour: null })
  })

  it('is one answer for the barn and not one per horse', () => {
    const resolved = resolveConditions({
      conditions: ['staying_in'],
      hours: [hour(11, { apparent: 90 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.horseId).toBeNull()
  })
})

describe('fly sheet weather', () => {
  it('holds on a dry day under the ceiling', () => {
    const resolved = resolveConditions({
      conditions: ['fly_sheet_weather'],
      hours: [hour(8, { apparent: 72, wet: false }), hour(13, { apparent: 88, wet: false })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'fly_sheet_weather', null)).toMatchObject({
      holds: true,
      readingValue: 88,
    })
  })

  it('does not hold when one hour of the window is wet', () => {
    const resolved = resolveConditions({
      conditions: ['fly_sheet_weather'],
      hours: [hour(8, { apparent: 72, wet: false }), hour(13, { apparent: 74, wet: true })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'fly_sheet_weather', null)?.holds).toBe(false)
  })

  it('does not hold above the ceiling, dry or not', () => {
    const resolved = resolveConditions({
      conditions: ['fly_sheet_weather'],
      hours: [hour(13, { apparent: 91, wet: false })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'fly_sheet_weather', null)?.holds).toBe(false)
  })

  it('holds at the ceiling exactly — *not over 90* is not *under 90*', () => {
    const resolved = resolveConditions({
      conditions: ['fly_sheet_weather'],
      hours: [hour(13, { apparent: 90, wet: false })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'fly_sheet_weather', null)?.holds).toBe(true)
  })
})

describe('cold and wet', () => {
  /**
   * River's cell: *On cold rainy days, if congested, give 5 mL Ventipulmin.*
   * With no predicate it would appear every day and become wallpaper, so the
   * rescue supplies a number once and owns it.
   */
  it('holds on an hour that is both cold and wet', () => {
    const resolved = resolveConditions({
      conditions: ['cold_and_wet'],
      hours: [hour(7, { air: 60, wet: true }), hour(16, { air: 41, wet: true })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'cold_and_wet', null)).toMatchObject({
      holds: true,
      readingValue: 41,
      atHour: 16,
    })
  })

  it('does not hold on a cold dry day', () => {
    const resolved = resolveConditions({
      conditions: ['cold_and_wet'],
      hours: [hour(7, { air: 33, wet: false })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'cold_and_wet', null)?.holds).toBe(false)
  })

  it('does not hold on a warm wet day', () => {
    const resolved = resolveConditions({
      conditions: ['cold_and_wet'],
      hours: [hour(7, { air: 66, wet: true })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(held(resolved, 'cold_and_wet', null)?.holds).toBe(false)
  })
})

describe('what the window is', () => {
  /**
   * ADR 0015 amends ADR 0013 twice here: a day-scoped Condition is read over
   * the whole day and shared, and a shift-scoped one runs from this Shift's
   * start **until the next Shift begins** — a blanket put on at PM feed is
   * worn all night.
   */
  it('reads a day-scoped Condition over the whole day', () => {
    expect(
      windowFor('day', {
        day: WHOLE_DAY,
        shift: { startsAt: at(16), nextStartsAt: at(30) },
      }),
    ).toEqual(WHOLE_DAY)
  })

  it('reads a shift-scoped Condition from this Shift until the next one', () => {
    expect(
      windowFor('shift', {
        day: WHOLE_DAY,
        shift: { startsAt: at(16), nextStartsAt: at(30) },
      }),
    ).toEqual({ from: at(16), to: at(30) })
  })

  it('reads the last Shift of the day to the end of it, where no Shift follows', () => {
    expect(
      windowFor('shift', { day: WHOLE_DAY, shift: { startsAt: at(16), nextStartsAt: null } }),
    ).toEqual({ from: at(16), to: at(24) })
  })

  it('reads the whole day where there is no Shift at all', () => {
    expect(windowFor('shift', { day: WHOLE_DAY })).toEqual(WHOLE_DAY)
  })

  it('takes the hours inside a window, half-open at the end', () => {
    const hours = [hour(15), hour(16), hour(29, { day: NEXT_DAY }), hour(30, { day: NEXT_DAY })]
    const inside = hoursWithin(hours, { from: at(16), to: at(30) })
    expect(inside.map((each) => each.at)).toEqual([at(16), at(29)])
  })

  it('reads a night window across midnight, which is the case the Shift window exists for', () => {
    // PM feed at four, the next Shift at seven tomorrow morning: the coldest
    // hour is at two in the morning and it is the one that dresses the horse.
    const resolved = resolveConditions({
      conditions: ['blanket_weather', 'sheet_weather'],
      hours: [
        hour(16, { air: 44 }),
        hour(26, { air: 28, day: NEXT_DAY }),
        hour(31, { air: 39, day: NEXT_DAY }),
      ],
      window: windowFor('shift', {
        day: WHOLE_DAY,
        shift: { startsAt: at(16), nextStartsAt: at(31) },
      }),
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'blanket_weather', 'blue')).toMatchObject({ holds: true, atHour: 2 })
  })
})

describe('when the forecast does not answer the question', () => {
  it('is unresolved rather than false when the window holds no hours', () => {
    const resolved = resolveConditions({
      conditions: ['sheet_weather', 'staying_in'],
      hours: [],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'sheet_weather', 'blue')).toMatchObject({
      holds: null,
      unresolved: 'no_hours',
    })
    expect(held(resolved, 'staying_in', null)).toMatchObject({
      holds: null,
      unresolved: 'no_hours',
    })
  })

  /**
   * The fallback provider's case: air temperature and nothing else. Cold rules
   * still resolve, and the heat rule says it could not be answered rather than
   * answering *no* on a 95 ° day (ADR 0015).
   */
  it('is unresolved where the provider carried no such metric', () => {
    const resolved = resolveConditions({
      conditions: ['sheet_weather', 'staying_in'],
      hours: [hour(9, { air: 38, apparent: null })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'sheet_weather', 'blue')?.holds).toBe(true)
    expect(held(resolved, 'staying_in', null)).toMatchObject({
      holds: null,
      unresolved: 'no_metric',
    })
  })

  it('is unresolved where the provider said nothing about rain', () => {
    const resolved = resolveConditions({
      conditions: ['fly_sheet_weather', 'cold_and_wet'],
      hours: [hour(9, { air: 38, apparent: 70, wet: null })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'fly_sheet_weather', null)).toMatchObject({
      holds: null,
      unresolved: 'no_metric',
    })
    expect(held(resolved, 'cold_and_wet', null)).toMatchObject({
      holds: null,
      unresolved: 'no_metric',
    })
  })

  it('says how many hours it read, resolved or not', () => {
    const resolved = resolveConditions({
      conditions: ['sheet_weather'],
      hours: [hour(6, { air: 38 }), hour(7, { air: 39 }), hour(30, { air: 20, day: NEXT_DAY })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: [{ id: 'blue' }],
    })
    expect(held(resolved, 'sheet_weather', 'blue')?.hoursRead).toBe(2)
  })
})

describe('the scopes', () => {
  it('names the day-scoped Conditions and the shift-scoped ones separately', () => {
    expect(conditionsScoped('day')).toEqual(['staying_in'])
    expect(conditionsScoped('shift')).toEqual([
      'blanket_weather',
      'sheet_weather',
      'fly_sheet_weather',
      'cold_and_wet',
    ])
  })

  it('answers one resolution per horse for a per-horse Condition', () => {
    const resolved = resolveConditions({
      conditions: ['sheet_weather'],
      hours: [hour(6, { air: 38 })],
      window: WHOLE_DAY,
      thresholds: PANEL,
      horses: HORSES,
    })
    expect(resolved.map((resolution) => resolution.horseId)).toEqual([
      'dawson',
      'apollo',
      'storm',
      'blue',
      'mystery',
    ])
  })
})

function held(
  resolved: readonly Resolution[],
  condition: string,
  horseId: string | null,
): Resolution | undefined {
  return resolved.find(
    (resolution) => resolution.condition === condition && resolution.horseId === horseId,
  )
}
