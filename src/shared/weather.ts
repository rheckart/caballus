/**
 * The weather vocabulary (ADR 0015; `CONTEXT.md`'s Threshold, Condition and
 * Reading).
 *
 * Lives here rather than beside the checks, for the reason `DOMAIN_SCOPES` and
 * `PRODUCT_KINDS` do: a Condition's name, a Threshold's kind and the metric a
 * number was calibrated in all cross the wire — to the admin screen that edits
 * them and to the Board that shows what they resolved to — and a second copy
 * of them in the contract is exactly the drift ADR 0021 exists to remove.
 *
 * **The vocabulary is closed.** A Condition's kind is code and its numbers are
 * data (ADR 0015): the rescue edits the numbers, the metrics and which horses,
 * and a fourth kind is a deploy. That fence is the same one ADR 0013 put
 * around the Task catalogue, and for the same reason — a rule builder in a barn
 * app is a feature nobody will use correctly and everybody can break.
 */

/**
 * What a number is measured in (ADR 0015). **Cold is air temperature and heat
 * is apparent temperature**, and the two are not interchangeable: Open-Meteo's
 * apparent temperature subtracts a wind term at all temperatures and runs
 * 8.5–11.7 °F below air temperature on a cold morning, so reading *under 50*
 * as apparent starts the sheet rule firing on a breezy 58 °F afternoon.
 *
 * `temp_plus_humidity_sum` and `wbgt` are carried from the first migration and
 * used by nothing. That is not speculative generality: USEF and the FEI
 * disagree in print about which heat index is valid for a horse, and the enum
 * is the cheapest accommodation of a disagreement that may yet be settled
 * against us — adding one becomes a data change rather than a migration.
 */
export const METRICS = ['air_temp', 'apparent_temp', 'temp_plus_humidity_sum', 'wbgt'] as const

export type Metric = (typeof METRICS)[number]

export function isMetric(stored: string): stored is Metric {
  return (METRICS as readonly string[]).includes(stored)
}

/**
 * Who said what the weather was.
 *
 * Stored beside every Threshold as well as on every Reading, because a
 * threshold is calibrated to one provider's scale and **is not portable**:
 * measured divergence between Open-Meteo and NWS apparent temperature at the
 * same coordinates was mean +1.8 °F over a range of −11.5 to +9.6 °F (#6). A
 * provider swap without the stamp re-calibrates every horse in the barn and
 * nobody notices.
 */
export const WEATHER_PROVIDERS = ['open_meteo', 'nws'] as const

export type WeatherProvider = (typeof WEATHER_PROVIDERS)[number]

export function isWeatherProvider(stored: string): stored is WeatherProvider {
  return (WEATHER_PROVIDERS as readonly string[]).includes(stored)
}

/** What a Threshold is a number for (ADR 0015's set, in full). */
export const THRESHOLD_KINDS = [
  'sheet',
  'blanket',
  'staying_in',
  'fly_sheet_max',
  'cold_and_wet',
] as const

export type ThresholdKind = (typeof THRESHOLD_KINDS)[number]

export function isThresholdKind(stored: string): stored is ThresholdKind {
  return (THRESHOLD_KINDS as readonly string[]).includes(stored)
}

export interface ThresholdSpec {
  /** What it is measured in — the metric a number of this kind is calibrated against. */
  readonly metric: Metric
  /**
   * Whether a horse may hold its own. The board names three horses and puts
   * everyone else under *Rest of Horses*; the rescue-wide numbers — the heat
   * hour, the fly sheet ceiling, the cold-and-wet temperature — are one number
   * for the barn and a per-horse override of one would be a number nobody set.
   */
  readonly perHorse: boolean
  readonly label: string
}

/**
 * Every number the rescue owns, and what each is measured in.
 *
 * The garments are per-horse because the literature says so without meaning
 * to: this rescue's sheets-under-50 sits far above every published lower
 * critical temperature, which is not the barn being wrong — LCT describes a
 * healthy acclimated horse, and a rescue blankets the thin, the senior, the
 * unacclimated and the wet (ADR 0015).
 */
export const THRESHOLD_SPECS: Readonly<Record<ThresholdKind, ThresholdSpec>> = {
  sheet: { metric: 'air_temp', perHorse: true, label: 'Sheet under' },
  blanket: { metric: 'air_temp', perHorse: true, label: 'Blanket under' },
  staying_in: { metric: 'apparent_temp', perHorse: false, label: 'Staying in at' },
  fly_sheet_max: { metric: 'apparent_temp', perHorse: false, label: 'Fly sheet up to' },
  cold_and_wet: { metric: 'air_temp', perHorse: false, label: 'Cold and wet under' },
}

/** The kinds a horse may hold its own number for, derived rather than listed twice. */
export const PER_HORSE_THRESHOLD_KINDS: readonly ThresholdKind[] = THRESHOLD_KINDS.filter(
  (kind) => THRESHOLD_SPECS[kind].perHorse,
)

/**
 * What a horse's Threshold record *says*, where there is one.
 *
 * Two stored stances and a third state that is the **absence of a row**:
 * overridden, deliberately the same as the default, or not yet decided
 * (ADR 0015, ADR 0013's Task Assignment). The third is load-bearing — a new
 * intake with no thresholds set is an unanswered question, not a horse that
 * follows the default, and rendering one as the other converts a gap into a
 * rule nobody made.
 */
export const STANCES = ['overridden', 'follows_default'] as const

export type Stance = (typeof STANCES)[number]

export function isStance(stored: string): stored is Stance {
  return (STANCES as readonly string[]).includes(stored)
}

/**
 * Where the number that decided a Condition came from, as the answer carries
 * it. `undecided` is the horse with no record of its own: it **still gets its
 * sheet**, using the rescue default, and the card says the thresholds are not
 * set (ADR 0015).
 */
export const THRESHOLD_SOURCES = ['override', 'default', 'undecided'] as const

export type ThresholdSource = (typeof THRESHOLD_SOURCES)[number]

/** The three kinds of predicate, and there is no fourth without a deploy (ADR 0015). */
export const CONDITION_KINDS = [
  'threshold_crossing',
  'time_of_crossing',
  'precipitation_presence',
] as const

export type ConditionKind = (typeof CONDITION_KINDS)[number]

/** ADR 0015's five Conditions, in full. */
export const CONDITIONS = [
  'blanket_weather',
  'sheet_weather',
  'staying_in',
  'fly_sheet_weather',
  'cold_and_wet',
] as const

export type ConditionName = (typeof CONDITIONS)[number]

export function isConditionName(stored: string): stored is ConditionName {
  return (CONDITIONS as readonly string[]).includes(stored)
}

/**
 * The window a Condition is read over, which is a property of the **Condition**
 * and not of the Shift (ADR 0015, amending ADR 0013).
 *
 * `day` ones are evaluated once when the day materializes and every Shift that
 * day shares the answer, because *Staying In* changes the hay plan and an AM
 * and a PM that disagreed about it would feed an alternate regime to horses
 * that went out this morning. `shift` ones read from a Shift's start **until
 * the next Shift begins** — a blanket put on at evening feed is worn all night,
 * and the hours the volunteers are present are not the hours the horse is
 * wearing it.
 */
export const CONDITION_SCOPES = ['day', 'shift'] as const

export type ConditionScope = (typeof CONDITION_SCOPES)[number]

/**
 * How a window of hours reduces to one boolean.
 *
 * `coldest` and `warmest` are the deciding hour rather than *any hour*, and
 * that is what makes Sheet and Blanket **mutually exclusive by construction**
 * (ADR 0015): a night that touches 25 ° and 45 ° dresses the horse for 25 °,
 * so it generates one blanket item and not a blanket and a sheet for a
 * volunteer to choose between.
 */
export const REDUCERS = ['coldest', 'warmest', 'any_hour', 'every_hour'] as const

export type Reducer = (typeof REDUCERS)[number]

export interface ConditionSpec {
  readonly kind: ConditionKind
  readonly scope: ConditionScope
  /** Whose answer it is: one for the barn, or one per horse (ADR 0015). */
  readonly subject: 'rescue' | 'horse'
  readonly metric: Metric
  /** The Threshold whose number this predicate compares against. */
  readonly threshold: ThresholdKind
  readonly reducer: Reducer
  /** Which side of the number holds. */
  readonly direction: 'below' | 'at_or_above' | 'at_or_below'
  /**
   * A second Threshold the deciding hour must stay at or above — the whole of
   * *below the sheet threshold **and at or above the blanket threshold***.
   */
  readonly notBelow?: ThresholdKind
  /** Whether the hour must be wet or dry for the predicate to hold. */
  readonly precipitation?: 'present' | 'absent'
  /** For a time-of-crossing: the hour of the day the crossing must happen at or before. */
  readonly byHour?: number
  readonly label: string
  /** What the Board says when it holds, in the barn's words. */
  readonly holdsText: string
}

/** Noon, the only hour the barn has ever written down (ADR 0015's *85 at or before noon*). */
export const NOON = 12

/**
 * The five, exactly as the whiteboard's panels state them.
 *
 * Nothing here is a rule the app invented: *Staying In* rides the heat rule
 * because 85-at-noon is the only heat number the barn has, there is no fans
 * threshold and no freezing Condition, and the hedge — *especially if
 * windy/Rainy* — stays instruction text rather than becoming a wind speed
 * nobody stated (ADR 0015).
 */
export const CONDITION_SPECS: Readonly<Record<ConditionName, ConditionSpec>> = {
  blanket_weather: {
    kind: 'threshold_crossing',
    scope: 'shift',
    subject: 'horse',
    metric: 'air_temp',
    threshold: 'blanket',
    reducer: 'coldest',
    direction: 'below',
    label: 'Blanket weather',
    holdsText: 'blanket',
  },
  sheet_weather: {
    kind: 'threshold_crossing',
    scope: 'shift',
    subject: 'horse',
    metric: 'air_temp',
    threshold: 'sheet',
    reducer: 'coldest',
    direction: 'below',
    // The construction, not a convention: one garment per horse per window.
    notBelow: 'blanket',
    label: 'Sheet weather',
    holdsText: 'sheet',
  },
  staying_in: {
    kind: 'time_of_crossing',
    scope: 'day',
    subject: 'rescue',
    metric: 'apparent_temp',
    threshold: 'staying_in',
    reducer: 'any_hour',
    direction: 'at_or_above',
    byHour: NOON,
    label: 'Staying in',
    holdsText: 'staying in',
  },
  fly_sheet_weather: {
    kind: 'precipitation_presence',
    scope: 'shift',
    subject: 'rescue',
    metric: 'apparent_temp',
    threshold: 'fly_sheet_max',
    // Every hour, because a fly sheet is worn across the window and one wet
    // hour in it is the reason the rule says no precipitation.
    reducer: 'every_hour',
    direction: 'at_or_below',
    precipitation: 'absent',
    label: 'Fly sheet weather',
    holdsText: 'fly sheets',
  },
  cold_and_wet: {
    kind: 'precipitation_presence',
    scope: 'shift',
    subject: 'rescue',
    metric: 'air_temp',
    threshold: 'cold_and_wet',
    reducer: 'any_hour',
    direction: 'below',
    precipitation: 'present',
    label: 'Cold and wet',
    holdsText: 'cold and wet',
  },
}

/** The Conditions of one scope, for a caller evaluating a day or a Shift. */
export function conditionsScoped(scope: ConditionScope): readonly ConditionName[] {
  return CONDITIONS.filter((name) => CONDITION_SPECS[name].scope === scope)
}

/**
 * Why a Condition has no answer, where it has none.
 *
 * A Condition that could not be resolved is **not false**: defaulting to false
 * on a 90 ° day is horses going out and getting the normal hay, which is the
 * failure ADR 0015 wrote the degraded path against.
 */
export const UNRESOLVED_REASONS = ['no_hours', 'no_metric', 'no_threshold'] as const

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number]
