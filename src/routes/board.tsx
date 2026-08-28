/**
 * The Board: the read-only feed board on the barn tablet, doing the
 * whiteboard's glance-at job (`CONTEXT.md`'s Board; #37).
 *
 * **Nothing here acts.** There is no button, no form and no write — the Board
 * records nothing and credits nobody, and the tablet it runs on authenticates
 * as the barn rather than as a person (ADR 0022). The one affordance is the
 * drill-down to a horse's profile, and it is rendered only for a signed-in
 * person: the tablet's token authorizes this read and nothing else, so a link
 * on the kiosk would lead to a refusal.
 *
 * **Colour is semantic by construction.** On the whiteboard, ink colour is a
 * convention that drifted — nobody agreed red means medical, it just mostly
 * does. Here the colour comes from the field: a line is painted from its
 * Product's kind, so a medication is red because it is a medication and not
 * because somebody picked up the red pen (#2's prototype, #37).
 *
 * **A blank renders as a blank.** A horse with no Lunch feeding says so in
 * words; a stall with no horse says OPEN. An unanswered question must never
 * look answered (#32).
 *
 * **The weather is on the wall, in words.** Today's Reading rides in with the
 * grid: what it resolved to — *staying in*, and which horses are in sheets or
 * blankets — with the provider named, because the rescue has no single
 * authoritative source today and a Board saying 96 while a volunteer's phone
 * says 89 has to be able to say whose number it is showing (ADR 0015). A
 * Condition the forecast could not answer says so rather than reading as *no*.
 *
 * **It polls, and it says how old it is.** A fetch that fails leaves the last
 * grid on the wall with its age against it, rather than blanking a screen
 * people across a barn are reading.
 *
 * **It is pinned light, in every combination** (#61, #63, ADR 0022). The app's
 * own theme never applies here — the inline head script and `resolveDark` both
 * skip `/board` — and the `prefers-color-scheme` reading this screen once
 * carried left with the migration, for the same reason: a wall display must
 * not change at dusk because a tablet's OS decided. One look, always.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { ALERT_KIND_LABEL } from '../shared/alerts'
import type { ProductKind } from '../shared/products'
import { ApiError, client } from '../shared/api-client'
import { BOARD_TOKEN_HEADER } from '../shared/board'
import { BOARD_NOT_LINKED, refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'
import { elapsed, now, type Instant } from '../shared/time'
import { SHIFT_TYPE_LABEL } from '../shared/shifts'

export const Route = createFileRoute('/board')({
  component: Board,
})

type BoardGrid = Answers<typeof contract, '/board'>
type BoardHorse = NonNullable<BoardGrid['sections'][number]['rows'][number]['horse']>
type Feeding = BoardHorse['feedings'][number]
type Reading = NonNullable<BoardGrid['weather']>
type Resolution = Reading['conditions'][number]

/**
 * How often the wall repaints. #37 asks for 30–60 seconds: often enough that a
 * feed change made at the desk is on the wall before the shift reaches it, and
 * rare enough that eleven rows are not a load on the box (ADR 0006).
 */
const POLL_MILLIS = 45_000

/** Two missed polls. One late answer is the network; two is worth saying out loud. */
const STALE_AFTER_MILLIS = POLL_MILLIS * 2 + POLL_MILLIS / 2

const MILLIS_PER_MINUTE = 60_000

/** Where the tablet keeps the token it was enrolled with (ADR 0022). */
const TOKEN_KEY = 'caballus.board-token'

/**
 * The Shift Types across the grid, in the order the day happens in rather than
 * the order the vocabulary is declared in.
 */
const COLUMNS: readonly Feeding['shiftType'][] = ['feed_am', 'lunch', 'feed_pm']

/** What the barn calls each Condition when it holds. */
const CONDITION_HOLDS: Record<Resolution['condition'], string> = {
  staying_in: 'Staying in',
  fly_sheet_weather: 'Fly sheets',
  cold_and_wet: 'Cold and wet',
  sheet_weather: 'Sheet',
  blanket_weather: 'Blanket',
}

/** Why a Condition has no answer, in the words a volunteer can act on. */
const UNRESOLVED_TEXT: Record<NonNullable<Resolution['unresolved']>, string> = {
  no_hours: 'no forecast for the hours it covers',
  no_metric: 'the forecast carried no such reading',
  no_threshold: 'the rescue has not set the number',
}

const PROVIDER_NAME: Record<Reading['provider'], string> = {
  open_meteo: 'Open-Meteo',
  nws: 'the National Weather Service',
}

const ROUTE_LABEL: Record<Feeding['lines'][number]['route'], string> = {
  in_feed: 'in feed',
  oral_syringe: 'oral syringe',
  topical: 'topical',
  other: 'other',
}

/**
 * Colour is the Product's kind, never a pen somebody picked up (ADR 0022).
 * A **total** Record, so a fifth kind does not compile until somebody decides
 * its colour — the same fence `ITEM_FOR_PRODUCT_KIND` holds (#58) — where the
 * old stylesheet would have let it ship colourless, reading as "we forgot".
 */
export const KIND_TEXT_CLASS: Record<ProductKind, string> = {
  feed: 'text-brand-teal',
  supplement: 'text-link-blue',
  medication: 'font-semibold text-error',
  topical: 'text-brand-purple',
}

/** Every cell of the grid: ruled on two sides, the last column unruled. */
const CELL = 'border-b border-r border-border px-4 py-3 text-left align-top last:border-r-0'
const HEAD_CELL =
  'whitespace-nowrap bg-secondary text-[11px] font-semibold uppercase tracking-widest text-muted-foreground'

/**
 * The token this tablet holds: the one it was just handed in the URL, or the
 * one it was enrolled with before.
 *
 * A read and nothing else — enrolling it is `enrol` below, in an effect, so
 * that rendering this screen writes nothing anywhere.
 */
function heldToken(): string | null {
  if (typeof window === 'undefined') return null
  const offered = new URL(window.location.href).searchParams.get('token')
  return offered !== null && offered !== '' ? offered : kept()
}

/**
 * Keeps the token the URL offered, and takes it back out of the address bar.
 *
 * `/board?token=…` is typed once, by hand, on the tablet (ADR 0022). The secret
 * does not stay in a history entry on a screen anybody can walk up to.
 */
function enrol(): void {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const offered = url.searchParams.get('token')
  if (offered === null || offered === '') return

  remember(offered)
  url.searchParams.delete('token')
  window.history.replaceState(null, '', url.toString())
}

/**
 * Storage, if this browser has any to offer.
 *
 * Guarded rather than assumed: a browser in private mode throws on the
 * property itself, and a tablet that cannot remember its token should still
 * show the board for the session it was enrolled in rather than crash on the
 * way to the first request.
 */
function storage(): Storage | null {
  try {
    return (window.localStorage as Storage | undefined) ?? null
  } catch {
    return null
  }
}

function remember(token: string): void {
  try {
    storage()?.setItem(TOKEN_KEY, token)
  } catch {
    // A tablet that cannot keep its token is enrolled again from the URL.
  }
}

function kept(): string | null {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null
  } catch {
    return null
  }
}

function Board() {
  // Read once, at first render: the token decides how every poll below is
  // made, and re-reading storage on each one would buy nothing.
  const [token] = useState(heldToken)
  const [grid, setGrid] = useState<BoardGrid | null>(null)
  const [freshAt, setFreshAt] = useState<Instant | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // What makes the age on screen advance while nothing else changes. A poll
  // that answers the same grid is still a poll, and the wall has to be able to
  // say so.
  const [, setPolls] = useState(0)

  const load = useCallback(async () => {
    const answered = await client.get(
      '/board',
      token === null ? undefined : { headers: { [BOARD_TOKEN_HEADER]: token } },
    )
    setGrid(answered)
    setFreshAt(now())
    setProblem(null)
  }, [token])

  useEffect(enrol, [])

  useEffect(() => {
    let current = true

    const poll = () => {
      load().catch((error: unknown) => {
        // The last grid stays on the wall. A screen that empties itself
        // because one request failed is worse than a screen that is ten
        // minutes old and says so.
        // A 401 here is the kiosk token, not a session: the Board resolves to
        // no `Actor` at all (ADR 0022), so the ordinary *sign in again* would
        // be an instruction nobody standing at the wall can follow.
        if (!current) return
        setProblem(
          error instanceof ApiError && error.status === 401 ? BOARD_NOT_LINKED : refusalText(error),
        )
      })
      if (current) setPolls((count) => count + 1)
    }

    poll()
    const timer = setInterval(poll, POLL_MILLIS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [load])

  const age = freshAt === null ? null : elapsed(freshAt, now())
  // A poll that failed is staleness whatever the clock says: the grid stopped
  // being live the moment the app stopped being able to ask (#37).
  const stale = age === null || age > STALE_AFTER_MILLIS || problem !== null

  if (grid === null) {
    return (
      <main className="max-w-none p-4 text-foreground">
        <h1 className="text-[32px]">Feed board</h1>
        {problem === null ? (
          <p>One moment…</p>
        ) : (
          <p role="alert" className="font-medium text-destructive">
            {problem}
          </p>
        )}
      </main>
    )
  }

  return (
    <main className="max-w-none p-4 pb-5 text-foreground">
      <header className="mb-4 flex flex-wrap items-baseline gap-4">
        <h1 className="m-0 text-[32px] tracking-tight">Feed board</h1>
        <p className="m-0 text-lg text-secondary-foreground">{grid.today}</p>
        <p
          className={
            stale ? 'm-0 text-sm font-semibold text-warning' : 'm-0 text-sm text-muted-foreground'
          }
          role={stale ? 'alert' : 'status'}
        >
          {freshness(age, problem)}
        </p>
      </header>

      <Weather reading={grid.weather} today={grid.today} />

      <Announcements announcements={grid.announcements} />

      {grid.sections.map((section) => (
        <section key={section.heading}>
          <table className="mb-6 w-full border-separate border-spacing-0 overflow-hidden rounded-lg border border-border bg-background text-base">
            <caption className="py-3 text-left text-[22px] font-semibold text-foreground">
              {section.heading}
            </caption>
            <thead>
              <tr>
                {[
                  'Stall',
                  'Horse',
                  'Pasture',
                  ...COLUMNS.map((c) => SHIFT_TYPE_LABEL[c]),
                  'Alerts',
                ].map((heading) => (
                  <th key={heading} scope="col" className={`${CELL} ${HEAD_CELL}`}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr
                  key={row.stall?.id ?? row.horse?.id ?? section.heading}
                  className="[&:last-child>*]:border-b-0"
                >
                  <th scope="row" className={`${CELL} font-semibold`}>
                    {row.stall === null ? <Blank>no stall</Blank> : row.stall.name}
                  </th>
                  {row.horse === null ? (
                    // The stall that stands OPEN keeps its row, because an
                    // empty stall is information (ADR 0002).
                    <td
                      className={`${CELL} bg-card font-semibold tracking-[2px] text-stone`}
                      colSpan={COLUMNS.length + 3}
                    >
                      OPEN
                    </td>
                  ) : (
                    <HorseRow
                      horse={row.horse}
                      linked={token === null}
                      wearing={garmentFor(grid.weather, row.horse.id)}
                      garmentUnknown={garmentUnknown(grid.weather, row.horse.id)}
                    />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {grid.sections.length === 0 && <p>No horses on the board yet.</p>}
    </main>
  )
}

/**
 * The wall's own panel: unexpired Announcements, exactly as the home screen
 * carries them (#46, ADR 0018).
 *
 * Rendered only when there is something to show, the same rule the home
 * screen follows — permanent furniture for something empty most of the time
 * teaches people not to look (ADR 0011). No action anywhere on it: the Board
 * records nothing and credits nobody (ADR 0022), and posting or editing one
 * happens on the home screen, by a signed-in person.
 */
function Announcements({ announcements }: { announcements: BoardGrid['announcements'] }) {
  if (announcements.length === 0) return null

  return (
    <section
      className="mb-4 rounded-lg bg-card-tint-yellow-bold px-4 py-3 text-secondary-foreground"
      aria-label="Announcements"
    >
      <ul className="m-0 pl-5">
        {announcements.map((announcement) => (
          <li key={announcement.id} className="m-0 py-0.5">
            {announcement.text}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The day's weather, as the barn reads it across the room.
 *
 * The Conditions that hold come first and in words — *Staying in* changes the
 * hay plan and the turnout, so it is the sentence this panel exists for. What
 * could not be resolved is stated too, because an unanswered question must
 * never look like a no (ADR 0015).
 */
function Weather({ reading, today }: { reading: BoardGrid['weather']; today: BoardGrid['today'] }) {
  if (reading === null) {
    return (
      <p className="mb-4 rounded-lg bg-card-tint-sky px-4 py-3">
        <Blank>no weather read for today yet</Blank>
      </p>
    )
  }

  const rescueWide = reading.conditions.filter((resolution) => resolution.horseId === null)
  const holding = rescueWide.filter((resolution) => resolution.holds === true)
  // Every Condition with no answer, per-horse ones included and counted rather
  // than listed twelve times: a per-horse Condition nobody could resolve would
  // otherwise render exactly like a horse that needs nothing, which is the one
  // thing this screen may never do (ADR 0015, #32).
  const unresolved = unansweredOf(reading)
  // **Today's** hours, not the whole series. A Reading stores tomorrow's early
  // hours too, because a night window runs past midnight — and a panel headed
  // *today* that quietly included tomorrow's 99 ° would be the Board wrong in
  // the direction people act on.
  const hoursToday = reading.hours.filter((hour) => hour.day === today)
  const air = hoursToday.map((hour) => hour.airTempF).filter((value) => value !== null)
  const apparent = hoursToday.map((hour) => hour.apparentTempF).filter((value) => value !== null)

  return (
    <section className="mb-4 rounded-lg bg-card-tint-sky px-4 py-3" aria-label="Today’s weather">
      <p className="my-0.5 text-2xl font-semibold tracking-tight text-foreground">
        {holding.length === 0 ? (
          <Blank>no weather rule in force today</Blank>
        ) : (
          holding.map((resolution) => (
            <span key={resolution.condition} className="mr-4 uppercase text-brand-orange-deep">
              {CONDITION_HOLDS[resolution.condition]}
            </span>
          ))
        )}
      </p>

      <p className="my-0.5 text-sm text-muted-foreground">
        {air.length > 0 && (
          <>
            {Math.min(...air)}–{Math.max(...air)} °F
            {apparent.length > 0 && <> · real feel to {Math.max(...apparent)} °F</>}
            {' · '}
          </>
        )}
        as {PROVIDER_NAME[reading.provider]} read it
        {reading.fellBackFrom !== null && (
          <> — {PROVIDER_NAME[reading.fellBackFrom]} did not answer</>
        )}
        {reading.stale && <> — reused an earlier forecast for today</>}
      </p>

      {unresolved.length > 0 && (
        <p className="my-0.5 text-sm font-semibold text-brand-orange-deep" role="alert">
          {unresolved.map((each) => (
            <span key={each.condition}>
              {CONDITION_HOLDS[each.condition]} could not be answered
              {each.horses > 0 && (
                <>
                  {' '}
                  for {each.horses} horse{each.horses === 1 ? '' : 's'}
                </>
              )}
              : {UNRESOLVED_TEXT[each.because]}.{' '}
            </span>
          ))}
        </p>
      )}
    </section>
  )
}

/** One Condition the Reading could not answer, and how many horses it covers. */
interface Unanswered {
  readonly condition: Resolution['condition']
  readonly because: NonNullable<Resolution['unresolved']>
  /** Zero for a rescue-wide Condition; a count for a per-horse one. */
  readonly horses: number
}

/**
 * Every Condition with no answer, one line each.
 *
 * Grouped by Condition rather than listed per subject: twelve horses with no
 * sheet answer is one problem — usually one number nobody set — and twelve
 * identical sentences across a barn wall is a panel nobody reads.
 */
function unansweredOf(reading: Reading): readonly Unanswered[] {
  const grouped = new Map<string, Unanswered>()
  for (const resolution of reading.conditions) {
    if (resolution.holds !== null || resolution.unresolved === null) continue
    const at = `${resolution.condition}:${resolution.unresolved}`
    const held = grouped.get(at)
    grouped.set(at, {
      condition: resolution.condition,
      because: resolution.unresolved,
      horses: (held?.horses ?? 0) + (resolution.horseId === null ? 0 : 1),
    })
  }
  return [...grouped.values()]
}

/**
 * Whether this horse's garment is an open question — a sheet rule the forecast
 * or the numbers could not answer. It is not *no garment*, and the row says so.
 */
function garmentUnknown(reading: BoardGrid['weather'], horseId: string): boolean {
  if (reading === null) return false
  return reading.conditions.some(
    (resolution) =>
      resolution.horseId === horseId &&
      resolution.holds === null &&
      (resolution.condition === 'sheet_weather' || resolution.condition === 'blanket_weather'),
  )
}

/**
 * What this horse is wearing tonight, if anything — one garment or none, ever,
 * because Sheet and Blanket are mutually exclusive by construction (ADR 0015).
 */
function garmentFor(reading: BoardGrid['weather'], horseId: string): Resolution | null {
  if (reading === null) return null
  return (
    reading.conditions.find(
      (resolution) =>
        resolution.horseId === horseId &&
        resolution.holds === true &&
        (resolution.condition === 'sheet_weather' || resolution.condition === 'blanket_weather'),
    ) ?? null
  )
}

/** The cells of a row with a horse in it. */
function HorseRow({
  horse,
  linked,
  wearing,
  garmentUnknown: unknown,
}: {
  horse: BoardHorse
  linked: boolean
  wearing: Resolution | null
  garmentUnknown: boolean
}) {
  const feedings = new Map(horse.feedings.map((feeding) => [feeding.shiftType, feeding]))

  return (
    <>
      <td className={CELL}>
        <span className="block text-lg font-semibold text-foreground">
          {linked ? (
            // A phone. The tablet gets plain text: its token authorizes the
            // Board and nothing else, so a link there would lead to a refusal
            // (ADR 0022).
            <Link to="/horses/$horseId" params={{ horseId: horse.id }}>
              {horse.name}
            </Link>
          ) : (
            horse.name
          )}
        </span>
        {horse.halterColour === null ? (
          <Blank>no halter colour</Blank>
        ) : (
          <span className="inline-block text-[13px] font-semibold uppercase tracking-widest text-muted-foreground">
            {horse.halterColour}
          </span>
        )}
        {wearing === null && unknown && (
          // An unanswered question, never a blank row: a horse whose sheet
          // rule could not be resolved must not look like a horse that needs
          // nothing (ADR 0015).
          <Blank>sheet or blanket not known</Blank>
        )}
        {wearing !== null && (
          // The number that decided it rides with it, so the tag explains
          // itself instead of looking arbitrary — *38 °F, sheets under 50°*.
          <span
            className={`ml-1 inline-block rounded-sm px-2 py-0.5 text-[13px] font-semibold uppercase tracking-widest ${
              wearing.condition === 'blanket_weather'
                ? 'bg-card-tint-lavender text-brand-purple-800'
                : 'bg-card-tint-mint text-brand-green'
            }`}
            data-garment={wearing.condition}
          >
            {CONDITION_HOLDS[wearing.condition]}
            {wearing.readingValue !== null && wearing.thresholdValue !== null && (
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                {' '}
                {wearing.readingValue}°, under {wearing.thresholdValue}°
              </span>
            )}
          </span>
        )}
      </td>
      <td className={CELL}>
        {horse.pasture === null ? <Blank>no pasture</Blank> : horse.pasture.name}
      </td>
      {COLUMNS.map((shiftType) => (
        <td key={shiftType} className={CELL}>
          <Feed feeding={feedings.get(shiftType) ?? null} shiftType={shiftType} />
        </td>
      ))}
      {/* The full words, never a count: *2 alerts* on a wall read across a
          barn tells nobody the horse bites, which is the failure ADR 0024
          exists to prevent. The paper board writes the words. */}
      <td className={CELL}>
        <span className="flex flex-col gap-1">
          {horse.alerts.length === 0 ? (
            <Blank>no alerts</Blank>
          ) : (
            horse.alerts.map((alert) => (
              <span
                key={alert.id}
                className={`rounded-sm border-l-4 px-2 py-0.5 ${ALERT_TINT[alert.kind]}`}
                data-kind={alert.kind}
              >
                <strong className="mr-1 text-[13px] uppercase tracking-wide">
                  {ALERT_KIND_LABEL[alert.kind]}
                </strong>
                {alert.text}
              </span>
            ))
          )}
        </span>
      </td>
    </>
  )
}

/** The three Alert kinds, apart by colour and by the word in front (ADR 0024). */
const ALERT_TINT: Record<BoardHorse['alerts'][number]['kind'], string> = {
  prohibition: 'border-l-error bg-card-tint-rose',
  care: 'border-l-warning bg-card-tint-peach',
  allergy: 'border-l-brand-purple bg-card-tint-lavender',
}

function Feed({
  feeding,
  shiftType,
}: {
  feeding: Feeding | null
  shiftType: Feeding['shiftType']
}) {
  if (feeding === null) {
    // In words, never a dash: a horse that is not fed at lunch is a decision,
    // and an empty cell reads as an unanswered question (#32, #36).
    return <Blank>{`no ${SHIFT_TYPE_LABEL[shiftType].toLowerCase()} feeding`}</Blank>
  }

  if (feeding.lines.length === 0) {
    return <Blank>nothing at this feeding</Blank>
  }

  return (
    <ul className="m-0 list-none p-0">
      {feeding.isNew && (
        <li
          className="m-0 py-0.5 text-xs font-semibold uppercase tracking-widest text-primary"
          data-new=""
        >
          New
        </li>
      )}
      {feeding.lines.map((line) => (
        <li
          key={line.productId}
          className={`m-0 py-0.5 ${KIND_TEXT_CLASS[line.productKind]}`}
          data-kind={line.productKind}
        >
          {line.amount} {line.productName}
          {line.route !== 'in_feed' && <span className="italic"> — {ROUTE_LABEL[line.route]}</span>}
        </li>
      ))}
    </ul>
  )
}

/** A blank, rendered visibly as one. */
function Blank({ children }: { children: string }) {
  return <span className="italic text-stone">{children}</span>
}

/** How old the grid on the wall is, and whether anything is wrong with it. */
function freshness(age: number | null, problem: string | null): string {
  if (age === null) {
    return problem === null ? 'Waiting for the first answer.' : `Not updated: ${problem}`
  }

  const minutes = Math.floor(age / MILLIS_PER_MINUTE)
  const when =
    minutes === 0
      ? 'Updated just now'
      : `Updated ${String(minutes)} minute${minutes === 1 ? '' : 's'} ago`

  return problem === null ? `${when}.` : `${when}. Not updating: ${problem}`
}

export default Board
