/**
 * Thresholds: publishing a version, and reading what is currently in force
 * (`CONTEXT.md`'s Threshold; ADR 0015; ADR 0003's versioned tier).
 *
 * **A default with named overrides, and a third state that is neither.** The
 * rescue-wide number is a real record — the board's *Rest of Horses* — and a
 * horse holds a row only where somebody decided one. Three states per horse
 * per kind: overridden, deliberately the same as the default, or **not yet
 * decided**, which is the absence of a row and is an unanswered question rather
 * than agreement with the default.
 *
 * **Editing publishes a version; it never updates a row**, the discipline
 * `publishFeedSchedule` and `publishReleaseVersion` both follow — and, like
 * them, **no audit entry**: a versioned-tier change *is* a version (ADR 0003).
 *
 * The New marker is derived from `validFrom` and ages out on its own, which is
 * why an edit to the **default** lights up every horse that follows it. That is
 * noisy and it is correct: it is exactly the change everybody needs to notice,
 * and marking only the default record is what the whiteboard did until its blue
 * underline went stale (ADR 0015, ADR 0013).
 */
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { OrgId, OrgScopedDatabase } from '../../db/for-org'
import { horses, thresholdVersions } from '../../db/schema'
import type { ThresholdChoice, ThresholdSet } from '../../shared/conditions'
import { isNewVersion } from '../../shared/feed-schedule'
import { dayString, type DayString } from '../../shared/time'
import {
  THRESHOLD_KINDS,
  THRESHOLD_SPECS,
  isMetric,
  isStance,
  isThresholdKind,
  isWeatherProvider,
  type Metric,
  type Stance,
  type ThresholdKind,
  type WeatherProvider,
} from '../../shared/weather'
import { recorded, refused, type Recorded } from './outcome'

export { type Recorded, type Refusal } from './outcome'

export interface NewThreshold {
  /** Null publishes the rescue-wide default — the board's *Rest of Horses*. */
  readonly horseId: string | null
  readonly kind: ThresholdKind
  readonly stance: Stance
  /** Required by `overridden`, and refused by `follows_default`. */
  readonly value: number | null
  readonly metric: Metric
  readonly provider: WeatherProvider
  readonly validFrom: DayString
}

/**
 * Publishes a Threshold version.
 *
 * The two refusals are both *this will not become true by retrying*: a number
 * the stance requires and does not carry, and a per-horse row for a kind that
 * is one answer for the whole barn.
 */
export async function publishThreshold(
  db: OrgScopedDatabase,
  orgId: OrgId,
  actorVolunteerId: string,
  about: NewThreshold,
): Promise<Recorded<{ id: string }>> {
  if (about.horseId !== null) {
    if (!THRESHOLD_SPECS[about.kind].perHorse) return refused('threshold_not_per_horse')

    const [horse] = await db
      .select({ id: horses.id })
      .from(horses)
      .where(eq(horses.id, about.horseId))
      .limit(1)
    if (horse === undefined) return refused('horse_not_found')
  }

  // The rescue default *is* the number, so it can only ever be `overridden`;
  // a default that followed a default would name nothing.
  const stance: Stance = about.horseId === null ? 'overridden' : about.stance
  if (stance === 'overridden' && about.value === null) return refused('threshold_value_required')

  const id = uuidv7()
  await db.insert(thresholdVersions).values({
    id,
    orgId,
    horseId: about.horseId,
    kind: about.kind,
    stance,
    // A horse deliberately on the default carries no number of its own: one
    // copied here is a number that stops moving when the default does.
    valueF: stance === 'follows_default' ? null : about.value,
    metric: about.metric,
    provider: about.provider,
    validFrom: about.validFrom,
    createdBy: actorVolunteerId,
  })

  return recorded({ id })
}

/** One Threshold as a screen shows it — the number, and where it came from. */
export interface ThresholdRecord {
  readonly kind: ThresholdKind
  readonly stance: Stance
  readonly value: number | null
  readonly metric: Metric
  readonly provider: WeatherProvider
  readonly validFrom: DayString
  /** Derived from `validFrom` against today, and ageing out on its own. */
  readonly isNew: boolean
}

/** One horse's numbers, and the decisions still owed on it (ADR 0015). */
export interface HorseThresholds {
  readonly horseId: string
  readonly horseName: string
  readonly records: readonly ThresholdRecord[]
  /** The per-horse kinds nobody has decided for — the unanswered questions. */
  readonly undecided: readonly ThresholdKind[]
}

export interface CurrentThresholds {
  /** What the evaluation reads: the numbers, resolved per horse at read time. */
  readonly set: ThresholdSet
  /** The rescue-wide numbers, one per kind that has one. */
  readonly defaults: readonly ThresholdRecord[]
  readonly horses: readonly HorseThresholds[]
}

interface VersionRow {
  readonly horseId: string | null
  readonly kind: ThresholdKind
  readonly stance: Stance
  readonly value: number | null
  readonly metric: Metric
  readonly provider: WeatherProvider
  readonly validFrom: string
  readonly createdAt: Date
}

/**
 * Every Threshold in force on `today`, for the screen that edits them and the
 * evaluation that reads them.
 *
 * One read for both, because *which version is current* is the same question
 * either way and having it twice is having it drift — the call
 * `currentFeedSchedulesByHorse` already makes for the Board and the profile.
 *
 * Departed horses are left out of the owed-decisions list: a horse that has
 * left the rescue is not a threshold anybody owes (ADR 0002).
 */
export async function currentThresholds(
  db: OrgScopedDatabase,
  today: DayString,
): Promise<CurrentThresholds> {
  const [versionRows, horseRows] = await Promise.all([
    db
      .select({
        horseId: thresholdVersions.horseId,
        kind: thresholdVersions.kind,
        stance: thresholdVersions.stance,
        value: thresholdVersions.valueF,
        metric: thresholdVersions.metric,
        provider: thresholdVersions.provider,
        validFrom: thresholdVersions.validFrom,
        createdAt: thresholdVersions.createdAt,
      })
      .from(thresholdVersions),
    db
      .select({ id: horses.id, name: horses.name, departedOn: horses.departedOn })
      .from(horses)
      .orderBy(horses.name),
  ])

  // The latest version per (horse, kind), by valid-from and then by when it was
  // recorded — resolved here rather than in a window function, the same call
  // `currentFeedSchedulesByHorse` makes.
  const latest = new Map<string, VersionRow>()
  for (const row of versionRows) {
    if (!isThresholdKind(row.kind) || !isStance(row.stance)) continue
    if (!isMetric(row.metric) || !isWeatherProvider(row.provider)) continue
    // A version that takes effect tomorrow is not in force today.
    if (row.validFrom > today) continue

    const at = `${row.horseId ?? 'rescue'}:${row.kind}`
    const held = latest.get(at)
    if (
      held === undefined ||
      row.validFrom > held.validFrom ||
      (row.validFrom === held.validFrom && row.createdAt > held.createdAt)
    ) {
      latest.set(at, {
        horseId: row.horseId,
        kind: row.kind,
        stance: row.stance,
        value: row.value,
        metric: row.metric,
        provider: row.provider,
        validFrom: row.validFrom,
        createdAt: row.createdAt,
      })
    }
  }

  const defaults: ThresholdRecord[] = []
  const byHorse = new Map<string, ThresholdRecord[]>()
  const setDefaults: Partial<Record<ThresholdKind, number>> = {}
  const setHorses: Record<string, Partial<Record<ThresholdKind, ThresholdChoice>>> = {}

  for (const row of [...latest.values()].sort(byKind)) {
    const record: ThresholdRecord = {
      kind: row.kind,
      stance: row.stance,
      value: row.value,
      metric: row.metric,
      provider: row.provider,
      validFrom: dayString(row.validFrom),
      isNew: isNewVersion(dayString(row.validFrom), today),
    }

    if (row.horseId === null) {
      defaults.push(record)
      if (row.value !== null) setDefaults[row.kind] = row.value
      continue
    }

    const held = byHorse.get(row.horseId) ?? []
    held.push(record)
    byHorse.set(row.horseId, held)

    const choices = setHorses[row.horseId] ?? {}
    choices[row.kind] =
      row.stance === 'follows_default' || row.value === null
        ? { stance: 'follows_default' }
        : { stance: 'overridden', value: row.value }
    setHorses[row.horseId] = choices
  }

  const perHorse = THRESHOLD_KINDS.filter((kind) => THRESHOLD_SPECS[kind].perHorse)
  const horsesHere = horseRows.filter((row) => row.departedOn === null)

  return {
    set: { defaults: setDefaults, horses: setHorses },
    defaults,
    horses: horsesHere.map((row) => {
      const records = byHorse.get(row.id) ?? []
      return {
        horseId: row.id,
        horseName: row.name,
        records,
        undecided: perHorse.filter((kind) => !records.some((record) => record.kind === kind)),
      }
    }),
  }
}

function byKind(left: VersionRow, right: VersionRow): number {
  return THRESHOLD_KINDS.indexOf(left.kind) - THRESHOLD_KINDS.indexOf(right.kind)
}
