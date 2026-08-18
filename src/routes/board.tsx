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
 * **It polls, and it says how old it is.** A fetch that fails leaves the last
 * grid on the wall with its age against it, rather than blanking a screen
 * people across a barn are reading.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { client } from '../shared/api-client'
import { BOARD_TOKEN_HEADER } from '../shared/board'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'
import { elapsed, now, type Instant } from '../shared/time'

export const Route = createFileRoute('/board')({
  component: Board,
})

type BoardGrid = Answers<typeof contract, '/board'>
type BoardHorse = NonNullable<BoardGrid['sections'][number]['rows'][number]['horse']>
type Feeding = BoardHorse['feedings'][number]

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

const SHIFT_TYPE_LABEL: Record<Feeding['shiftType'], string> = {
  feed_am: 'Feed AM',
  lunch: 'Lunch',
  feed_pm: 'Feed PM',
}

const ROUTE_LABEL: Record<Feeding['lines'][number]['route'], string> = {
  in_feed: 'in feed',
  oral_syringe: 'oral syringe',
  topical: 'topical',
  other: 'other',
}

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

export function Board() {
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
        if (current) setProblem(refusalText(error))
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
      <main className="board">
        <style>{STYLE}</style>
        <h1>Feed board</h1>
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  return (
    <main className="board">
      <style>{STYLE}</style>
      <header className="board-head">
        <h1>Feed board</h1>
        <p className="board-day">{grid.today}</p>
        <p
          className={stale ? 'board-age board-stale' : 'board-age'}
          role={stale ? 'alert' : 'status'}
        >
          {freshness(age, problem)}
        </p>
      </header>

      {grid.sections.map((section) => (
        <section key={section.heading}>
          <table className="board-grid">
            <caption>{section.heading}</caption>
            <thead>
              <tr>
                <th scope="col">Stall</th>
                <th scope="col">Horse</th>
                <th scope="col">Field</th>
                {COLUMNS.map((shiftType) => (
                  <th key={shiftType} scope="col">
                    {SHIFT_TYPE_LABEL[shiftType]}
                  </th>
                ))}
                <th scope="col">Alerts</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.stall?.id ?? row.horse?.id ?? section.heading}>
                  <th scope="row">
                    {row.stall === null ? <Blank>no stall</Blank> : row.stall.name}
                  </th>
                  {row.horse === null ? (
                    // The stall that stands OPEN keeps its row, because an
                    // empty stall is information (ADR 0002).
                    <td className="board-open" colSpan={COLUMNS.length + 3}>
                      OPEN
                    </td>
                  ) : (
                    <HorseRow horse={row.horse} linked={token === null} />
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

/** The cells of a row with a horse in it. */
function HorseRow({ horse, linked }: { horse: BoardHorse; linked: boolean }) {
  const feedings = new Map(horse.feedings.map((feeding) => [feeding.shiftType, feeding]))

  return (
    <>
      <td>
        <span className="board-name">
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
          <span className="board-halter">{horse.halterColour}</span>
        )}
      </td>
      <td>{horse.field === null ? <Blank>no field</Blank> : horse.field.name}</td>
      {COLUMNS.map((shiftType) => (
        <td key={shiftType} className="board-feed">
          <Feed feeding={feedings.get(shiftType) ?? null} shiftType={shiftType} />
        </td>
      ))}
      {/* Alerts is a column with nothing under it yet: nothing writes one, and
          the Board holds the place rather than the schema inventing a field
          nobody populates (#35). */}
      <td>
        <Blank>no alerts</Blank>
      </td>
    </>
  )
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
    <ul className="board-lines">
      {feeding.isNew && (
        <li className="board-new" data-new="">
          New
        </li>
      )}
      {feeding.lines.map((line) => (
        <li key={line.productId} data-kind={line.productKind}>
          {line.amount} {line.productName}
          {line.route !== 'in_feed' && (
            <span className="board-route"> — {ROUTE_LABEL[line.route]}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** A blank, rendered visibly as one. */
function Blank({ children }: { children: string }) {
  return <span className="board-blank">{children}</span>
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

/**
 * The tablet's own styling, and the only styling in the application so far.
 *
 * It is here rather than in a stylesheet because this is the first screen
 * whose legibility is the feature: it is read across a barn, in daylight, by
 * somebody carrying a hay net. The colours are keyed to `data-kind`, which is
 * the whole of *semantic by construction* — nothing here decides what a colour
 * means, the field does.
 */
const STYLE = `
.board { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; }
.board-head { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
.board-head h1 { font-size: 1.6rem; margin: 0; }
.board-day { font-size: 1.1rem; margin: 0; }
.board-age { font-size: 0.95rem; margin: 0; color: #555; }
.board-stale { color: #8a3b00; font-weight: 700; }
.board-grid { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; font-size: 1.05rem; }
.board-grid caption { text-align: left; font-size: 1.2rem; font-weight: 700; padding: 0.4rem 0; }
.board-grid th, .board-grid td { border: 1px solid #b9c3d0; padding: 0.5rem; vertical-align: top; text-align: left; }
.board-grid thead th { background: #eef2f7; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; }
.board-name { font-weight: 700; font-size: 1.15rem; display: block; }
.board-halter { display: inline-block; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
.board-open { font-style: italic; letter-spacing: 0.1em; }
.board-blank { color: #6b7480; font-style: italic; }
.board-lines { list-style: none; margin: 0; padding: 0; }
.board-lines li { padding: 0.1rem 0; }
.board-lines li[data-kind='feed'] { color: #0f5d55; }
.board-lines li[data-kind='supplement'] { color: #1b3f8f; }
.board-lines li[data-kind='medication'] { color: #a3122a; font-weight: 700; }
.board-route { font-style: italic; }
.board-new { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1b57c4; }
@media (prefers-color-scheme: dark) {
  .board { background: #14171b; color: #e8ecf2; }
  .board-grid th, .board-grid td { border-color: #39424e; }
  .board-grid thead th { background: #1f242b; }
  .board-age { color: #a2adbc; }
  .board-stale { color: #e5a63f; }
  .board-blank { color: #8d97a4; }
  .board-lines li[data-kind='feed'] { color: #45d6c2; }
  .board-lines li[data-kind='supplement'] { color: #86adff; }
  .board-lines li[data-kind='medication'] { color: #ff7385; }
  .board-new { color: #86adff; }
}
`
