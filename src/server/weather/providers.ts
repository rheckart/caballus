/**
 * Where the weather comes from, and **the only module in this application that
 * knows a URL** (#38's acceptance criterion, ADR 0015).
 *
 * Two providers, in order. **Open-Meteo is primary**: hourly apparent
 * temperature in one request, no key, no registration, and the metric ADR 0015
 * calibrates the heat rule against. **api.weather.gov is the fallback**, and it
 * is a genuinely different answer rather than a second copy of the same one —
 * it carries air temperature and no apparent temperature at all, so a Reading
 * taken from it resolves the cold rules and leaves the heat rule *unresolved*
 * rather than answering it on a scale nobody calibrated against.
 *
 * That asymmetry is the point of ADR 0015's stamp. Measured divergence between
 * the two providers' apparent temperature at the same coordinates was mean
 * +1.8 °F over a range of −11.5 to +9.6 °F (#6), so a threshold is calibrated
 * to one provider's scale and is **not portable**. Every Reading records who
 * answered and every Threshold records who it was set against, and a fallback
 * says loudly that it is one.
 *
 * **ADR 0015 says no NWS fallback in v1 and this ticket asks for one.** The
 * ticket is the later instruction and it is followed; what the ADR was
 * protecting against — a second scale silently re-calibrating the barn's
 * numbers — is handled by the fallback carrying no apparent temperature and by
 * `fellBackFrom` being on the Reading and on the Board.
 */
import { instant, now, type Instant } from '../../shared/time'
import type { WeatherProvider } from '../../shared/weather'
import { log } from '../observability'
import { instantOfIso } from '../time'

/** Where the barn is. Not a URL, and not a secret; it is in configuration because nothing edits it. */
export interface Coordinates {
  readonly latitude: number
  readonly longitude: number
}

/** One hour as a provider gave it, before the organisation's clock is applied to it. */
export interface ProviderHour {
  readonly at: Instant
  readonly airTempF: number | null
  readonly apparentTempF: number | null
  /** Null where the provider said nothing about rain — never assumed dry. */
  readonly precipitation: boolean | null
}

export interface ProviderForecast {
  readonly provider: WeatherProvider
  readonly fetchedAt: Instant
  readonly hours: readonly ProviderHour[]
}

/** A forecast, and whether getting it took the fallback. */
export interface FetchedForecast {
  readonly forecast: ProviderForecast
  readonly fellBackFrom: WeatherProvider | null
  readonly fellBackBecause: string | null
}

/** Nobody answered. The caller reuses the day's last Reading, marked stale (ADR 0015). */
export class NoForecast extends Error {
  constructor(readonly attempts: readonly { provider: WeatherProvider; because: string }[]) {
    super(
      `No weather provider answered: ${attempts
        .map((attempt) => `${attempt.provider} (${attempt.because})`)
        .join('; ')}`,
    )
    this.name = 'NoForecast'
  }
}

/**
 * How long a provider gets. A materialization that must run at 4am cannot wait
 * on a third party indefinitely, and the fallback is only reachable if the
 * primary is allowed to give up.
 *
 * Five seconds rather than a comfortable ten, because of where this call
 * happens: `mutation` opens the transaction before the handler runs (ADR 0020),
 * so a slow provider holds a pooled connection for as long as it is allowed to
 * be slow. Two providers at five seconds is a ten-second worst case on one
 * connection, on a box that has one Postgres (ADR 0006). `readings.ts` says the
 * same thing from the other end.
 */
const TIMEOUT_MILLIS = 5_000

/** Two days of hours: tonight's window runs past midnight into tomorrow (ADR 0015). */
const FORECAST_DAYS = 2

/**
 * Who we are, for a provider that asks. api.weather.gov requires a
 * User-Agent identifying the application and a contact; sending one is their
 * documented condition of use rather than a nicety.
 */
const USER_AGENT = 'caballus (horse rescue operations; caballus@heckart.me)'

/**
 * The barn's coordinates, from configuration.
 *
 * Configuration rather than a column: nothing in the application edits where
 * the barn is, there is no organisation-settings screen to put it on, and a
 * column nothing writes is the *URL pointing at nothing* #34 and #35 both
 * refused. Unset means no forecast — the same fail-closed shape the kiosk
 * token has, and a development box has neither.
 */
export function barnCoordinates(): Coordinates | null {
  const latitude = Number(process.env.BARN_LATITUDE ?? '')
  const longitude = Number(process.env.BARN_LONGITUDE ?? '')
  if ((process.env.BARN_LATITUDE ?? '') === '' || (process.env.BARN_LONGITUDE ?? '') === '') {
    return null
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude }
}

/**
 * The forecast, from the first provider that answers.
 *
 * The fallback is *tried*, not preferred: a primary that answers is always the
 * one used, so a Reading only ever changes scale when Open-Meteo is actually
 * unreachable and the Reading says so.
 */
export async function fetchForecast(at: Coordinates): Promise<FetchedForecast> {
  const attempts: { provider: WeatherProvider; because: string }[] = []

  for (const provider of PROVIDERS) {
    try {
      const forecast = await provider.fetch(at)
      if (forecast.hours.length === 0) {
        throw new Error('answered with no hours')
      }
      const [failed] = attempts
      return {
        forecast,
        fellBackFrom: failed?.provider ?? null,
        fellBackBecause: failed?.because ?? null,
      }
    } catch (error: unknown) {
      const because = error instanceof Error ? error.message : 'unknown failure'
      attempts.push({ provider: provider.name, because })
      // A provider that did not answer is a fact about the morning, and the
      // only place it is ever written down (ADR 0007's log question).
      log('warn', 'weather_provider_failed', { provider: provider.name, because })
    }
  }

  throw new NoForecast(attempts)
}

interface Provider {
  readonly name: WeatherProvider
  fetch(at: Coordinates): Promise<ProviderForecast>
}

/**
 * Open-Meteo, primary.
 *
 * `timeformat=unixtime` rather than ISO strings, and no `timezone` parameter:
 * the timestamps come back as plain epoch seconds in GMT, and which day and
 * hour that is in the barn's timezone is a question for `src/server/time.ts`
 * (ADR 0007). Fahrenheit is asked for at the source, because the barn's
 * numbers are in Fahrenheit and a conversion here is a rounding nobody
 * calibrated against.
 */
const openMeteo: Provider = {
  name: 'open_meteo',
  async fetch(at) {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(at.latitude))
    url.searchParams.set('longitude', String(at.longitude))
    url.searchParams.set('hourly', 'temperature_2m,apparent_temperature,precipitation')
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('precipitation_unit', 'inch')
    url.searchParams.set('timeformat', 'unixtime')
    url.searchParams.set('forecast_days', String(FORECAST_DAYS))

    const body = await readJson(url)
    const hourly = (body as { hourly?: Record<string, unknown> }).hourly
    const times = numbers(hourly?.time).filter((each): each is number => each !== null)
    const air = numbers(hourly?.temperature_2m)
    const apparent = numbers(hourly?.apparent_temperature)
    const precipitation = numbers(hourly?.precipitation)

    return {
      provider: 'open_meteo',
      fetchedAt: now(),
      hours: times.map((seconds, index) => ({
        // Epoch seconds in GMT, which is what `timeformat=unixtime` answers
        // with when no timezone is asked for.
        at: instant(seconds * 1000),
        airTempF: air[index] ?? null,
        apparentTempF: apparent[index] ?? null,
        // Any measurable precipitation in the hour is precipitation. There is
        // no amount anywhere in ADR 0015's rules — the fly sheet comes off
        // because it rained, not because it rained enough.
        precipitation: precipitationAt(precipitation[index]),
      })),
    }
  },
}

/**
 * api.weather.gov, the fallback.
 *
 * Two requests: the gridpoint lookup, then the hourly forecast it names. This
 * is the friendly endpoint rather than the raw gridpoint ADR 0015 described —
 * no run-length-encoded `validTime` to unpack and temperatures already in
 * Fahrenheit — and the price is that it carries **no apparent temperature**.
 * That is not a gap to paper over: the heat rule stays unresolved on a
 * fallback Reading rather than being answered against a scale the barn's 85
 * was never set against (#6).
 *
 * Rain is a probability rather than an amount, so a coin-flip is the line —
 * stated here because it is a judgement, and it is the only one in this module.
 */
const PRECIPITATION_LIKELY_PERCENT = 50

/** The only host the fallback ever talks to, in either of its two requests. */
const WEATHER_GOV_HOST = 'api.weather.gov'

const weatherGov: Provider = {
  name: 'nws',
  async fetch(at) {
    const point = await readJson(
      new URL(`https://api.weather.gov/points/${String(at.latitude)},${String(at.longitude)}`),
    )
    const hourlyUrl = (point as { properties?: { forecastHourly?: unknown } }).properties
      ?.forecastHourly
    if (typeof hourlyUrl !== 'string' || hourlyUrl === '') {
      throw new Error('named no hourly forecast for these coordinates')
    }

    // The second request's address comes out of the first request's body, so
    // it is pinned: this module's claim is that it is the only place that
    // knows a URL, and a URL a response chose is not one this module knows.
    const named = new URL(hourlyUrl)
    if (named.protocol !== 'https:' || named.host !== WEATHER_GOV_HOST) {
      throw new Error(`named an hourly forecast somewhere else: ${named.host}`)
    }

    const forecast = await readJson(named)
    const periods = (forecast as { properties?: { periods?: unknown } }).properties?.periods
    if (!Array.isArray(periods)) throw new Error('answered with no periods')

    return {
      provider: 'nws',
      fetchedAt: now(),
      hours: periods.flatMap((period: unknown): ProviderHour[] => {
        const each = period as {
          startTime?: unknown
          temperature?: unknown
          temperatureUnit?: unknown
          probabilityOfPrecipitation?: { value?: unknown }
        }
        if (typeof each.startTime !== 'string') return []

        const temperature =
          typeof each.temperature === 'number' && each.temperatureUnit === 'F'
            ? each.temperature
            : null
        const chance = each.probabilityOfPrecipitation?.value
        return [
          {
            at: instantOfIso(each.startTime),
            airTempF: temperature,
            // The whole reason a fallback Reading says so on the Board.
            apparentTempF: null,
            precipitation:
              typeof chance === 'number' ? chance >= PRECIPITATION_LIKELY_PERCENT : null,
          },
        ]
      }),
    }
  },
}

/** In order: the primary, then the fallback. */
const PROVIDERS: readonly Provider[] = [openMeteo, weatherGov]

async function readJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MILLIS),
  })
  if (!response.ok) {
    throw new Error(`answered ${String(response.status)}`)
  }
  return (await response.json()) as unknown
}

/** Whether an hour's precipitation figure means it rained. */
function precipitationAt(inches: number | null | undefined): boolean | null {
  return inches === undefined || inches === null ? null : inches > 0
}

/**
 * A numeric series off a provider's answer, or nothing at all. A gap in a
 * series comes back as `null` rather than as a zero, because zero is a
 * temperature.
 */
function numbers(value: unknown): readonly (number | null)[] {
  if (!Array.isArray(value)) return []
  return value.map((each: unknown) =>
    typeof each === 'number' && Number.isFinite(each) ? each : null,
  )
}
