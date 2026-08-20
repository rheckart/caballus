/**
 * Home, which for now is the answer to *am I signed in* plus the one thing
 * everybody reads whether or not there is anything else to do here: the
 * unexpired Announcements (`CONTEXT.md`'s Announcement; ADR 0018, #46) — and,
 * since the redesign, the way to every other screen.
 *
 * The barn comes next. What this exists for today is that a session is not a
 * thing you can see: the login screen hands the browser a cookie, and without
 * somewhere that reads it back, "and is signed in" is a claim nobody in the
 * barn can check.
 *
 * **The Announcements section exists only when there are any** — ADR 0011's
 * rule about a tab that is empty most of the time, applied to a section: a
 * heading that is usually blank teaches people to stop reading under it. A
 * holder of any Domain Scope may post one, from this screen, because the
 * barn's wall is exactly where a volunteer already is when the water goes off
 * in the tack room.
 *
 * **The destinations are cards in a grid, in two named groups** — the barn and
 * the desk — rather than one bulleted list of fourteen links. The list was
 * complete and unreadable: on a phone it was a column of identical blue text a
 * volunteer had to read word by word to find *Supplies*. Two up on the
 * smallest phone, three on a tablet, four on the desk; the tint is what makes
 * a group legible at arm's length, which is `DESIGN.md`'s own use for the
 * pastel card family. Every tile is shown to everybody still — the server is
 * what refuses, and a link that is not there is indistinguishable from a
 * broken app (ADR 0011's argument for the disabled-and-explained action,
 * applied to navigation).
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { signOutHere } from '../server/auth/login'
import { ApiError, client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import { dayString, daysBetween } from '../shared/time'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/')({
  component: Home,
})

type Me = Answers<typeof contract, '/me'>
type AnnouncementList = Answers<typeof contract, '/announcements'>
type Announcement = AnnouncementList['announcements'][number]
type Schedule = Answers<typeof contract, '/shifts'>
type Shift = Schedule['shifts'][number]

const SHIFT_TYPE_LABEL: Record<Shift['shiftType'], string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
  pop_up: 'Pop-up',
}

type Who =
  | { readonly state: 'asking' }
  | { readonly state: 'signed-in'; readonly me: Me }
  | { readonly state: 'signed-out' }
  | { readonly state: 'broken'; readonly because: string }

interface Destination {
  readonly to: string
  readonly glyph: string
  readonly name: string
  readonly what: string
  readonly tint: string
}

/** What a volunteer standing in the barn came here to open. */
const barn: readonly Destination[] = [
  {
    to: '/shifts',
    glyph: '\u{1F5D3}',
    name: 'My shifts',
    what: 'Cover, drop and open the work surface',
    tint: 'lavender',
  },
  {
    to: '/horses',
    glyph: '\u{1F434}',
    name: 'Horses',
    what: 'Every horse, departed ones included',
    tint: 'peach',
  },
  {
    to: '/board',
    glyph: '\u{1F4CB}',
    name: 'Feed board',
    what: 'The whiteboard, stall by stall',
    tint: 'sky',
  },
  {
    to: '/supplies',
    glyph: '\u{1F4E6}',
    name: 'Supplies',
    what: 'Days of supply, and what to reorder',
    tint: 'mint',
  },
  {
    to: '/contacts',
    glyph: '\u{260E}',
    name: 'Contacts',
    what: 'Numbers, hours and the standing rules',
    tint: 'yellow',
  },
  {
    to: '/attendance',
    glyph: '\u{23F1}',
    name: 'Attendance',
    what: 'Who signed in, and for how long',
    tint: 'rose',
  },
  {
    to: '/escalations',
    glyph: '\u{1F4E3}',
    name: 'Escalations',
    what: 'What was reported, and where it went',
    tint: 'cream',
  },
]

/** The desk: the screens an officer opens sitting down. */
const desk: readonly Destination[] = [
  {
    to: '/admin/volunteers',
    glyph: '\u{1F465}',
    name: 'Volunteers',
    what: 'People, roles and rostering gates',
    tint: 'gray',
  },
  {
    to: '/admin/horses',
    glyph: '\u{1F411}',
    name: 'Horses',
    what: 'Create and edit the horse record',
    tint: 'gray',
  },
  {
    to: '/admin/spaces',
    glyph: '\u{1F3E1}',
    name: 'Spaces',
    what: 'Stalls, fields and barns',
    tint: 'gray',
  },
  {
    to: '/admin/products',
    glyph: '\u{1F33E}',
    name: 'Products',
    what: 'Feed, medication and suppliers',
    tint: 'gray',
  },
  {
    to: '/admin/shift-patterns',
    glyph: '\u{1F501}',
    name: 'Shift patterns',
    what: 'Standing rosters and generation',
    tint: 'gray',
  },
  {
    to: '/admin/tasks',
    glyph: '\u{2705}',
    name: 'Tasks',
    what: 'The checklist catalogue and assignments',
    tint: 'gray',
  },
  {
    to: '/admin/thresholds',
    glyph: '\u{1F321}',
    name: 'Thresholds',
    what: 'Weather, per horse and by default',
    tint: 'gray',
  },
  {
    to: '/admin/attendance',
    glyph: '\u{1F4CA}',
    name: 'Hours',
    what: 'The per-county attendance report',
    tint: 'gray',
  },
  {
    to: '/admin/release-versions',
    glyph: '\u{1F4C4}',
    name: 'Release versions',
    what: 'What every volunteer signed',
    tint: 'gray',
  },
  {
    to: '/admin/contacts',
    glyph: '\u{1F4DE}',
    name: 'Contacts',
    what: 'Maintain the posted numbers',
    tint: 'gray',
  },
  {
    to: '/admin/audit',
    glyph: '\u{1F50D}',
    name: 'Audit log',
    what: 'Who changed what, and why',
    tint: 'gray',
  },
]

function Tiles({ destinations }: { destinations: readonly Destination[] }) {
  return (
    <ul className="tiles">
      {destinations.map((destination) => (
        <li key={destination.to}>
          <Link to={destination.to} className="tile" data-tint={destination.tint}>
            <span className="tile-glyph" aria-hidden="true">
              {destination.glyph}
            </span>
            <span className="tile-name">{destination.name}</span>
            <span className="tile-what">{destination.what}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * **The one thing to do now**, which is the question this screen did not
 * answer.
 *
 * Signing in used to land on eighteen equal tiles, and *which of these is my
 * job this morning* was left to the volunteer to work out from a list sorted
 * by nothing in particular. So the first card on the screen is the Shift the
 * person reading it is actually rostered on, with the way into it as the one
 * purple button on the page.
 *
 * It is the volunteer's **own** Shifts and no one else's: a roster row naming
 * them that has not ended, which is the same test `/shifts` itself renders
 * *mine* from, so the home screen and the Shifts screen cannot disagree about
 * whether Thursday is theirs. A Drop marks the row rather than removing it
 * (ADR 0011), and a dropped row is not a commitment, so `endedAs` decides it.
 *
 * Nobody rostered on anything is a real state and gets a real card: the way to
 * Cover something, rather than an empty box or a hidden section.
 */
function RightNow({ schedule, me }: { schedule: Schedule | 'unreadable' | null; me: Me }) {
  if (schedule === null) {
    return (
      <section className="now now-quiet" aria-label="Your next shift">
        <p className="now-when">Looking up your shifts…</p>
      </section>
    )
  }

  if (schedule === 'unreadable') {
    return (
      <section className="now now-quiet" aria-label="Your next shift">
        <p className="now-when">Your shifts could not be read just now.</p>
        <div className="now-actions">
          <Link to="/shifts" className="now-go">
            Open Shifts
          </Link>
        </div>
      </section>
    )
  }

  const mine = schedule.shifts
    .filter((shift) =>
      shift.roster.some(
        (member) => member.volunteerId === me.volunteerId && member.endedAs === null,
      ),
    )
    .filter((shift) => daysBetween(schedule.today, shift.day) >= 0)
    .sort((a, b) =>
      a.day === b.day ? a.startTime.localeCompare(b.startTime) : a.day < b.day ? -1 : 1,
    )

  const next = mine[0]

  if (next === undefined) {
    return (
      <section className="now now-quiet" aria-label="Your next shift">
        <p className="now-when">You are not rostered on anything yet.</p>
        <p className="now-what">
          Anybody with an Orientation may Cover a Shift that needs people. No approval step, and no
          waiting to be asked.
        </p>
        <div className="now-actions">
          <Link to="/shifts" className="now-go">
            Find a Shift to cover
          </Link>
        </div>
      </section>
    )
  }

  const away = daysBetween(schedule.today, next.day)
  const when = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : next.day
  const started = away === 0 && next.state === 'in_progress'

  return (
    <section className="now" aria-label="Your next shift">
      <p className="now-when">
        {when}
        {started && <span className="now-live">Underway</span>}
      </p>
      <h2 className="now-what">
        {SHIFT_TYPE_LABEL[next.shiftType]} at {next.startTime}
      </h2>
      {next.purpose !== null && <p className="now-why">{next.purpose}</p>}
      <div className="now-actions">
        <Link to="/shifts/$shiftId" params={{ shiftId: next.id }} className="now-go">
          {started ? 'Open the checklist' : 'Open the Shift'}
        </Link>
        {mine.length > 1 && (
          <Link to="/shifts" className="now-more">
            {mine.length - 1} more after this
          </Link>
        )}
      </div>
    </section>
  )
}

function Home() {
  const [who, setWho] = useState<Who>({ state: 'asking' })
  const [announcements, setAnnouncements] = useState<AnnouncementList | null>(null)
  // Null while it is on its way, `'unreadable'` when the read refused: an
  // empty list and a failed read are different facts and the card says which.
  const [schedule, setSchedule] = useState<Schedule | 'unreadable' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    // Through the typed client, so the answer is parsed against the same
    // contract the server registered against rather than asserted (ADR 0021).
    client
      .get('/me')
      .then((me) => {
        if (current) setWho({ state: 'signed-in', me })
      })
      .catch((error: unknown) => {
        if (!current) return
        // The explicit denial, read as what it is. A signed-out request and a
        // broken server are different facts and get different screens — which
        // is the whole reason the refusal is a status and a shape rather than
        // an empty answer (ADR 0010).
        if (error instanceof ApiError && error.status === 401) {
          setWho({ state: 'signed-out' })
          return
        }
        setWho({ state: 'broken', because: error instanceof Error ? error.message : 'unknown' })
      })
    return () => {
      current = false
    }
  }, [])

  const loadAnnouncements = useCallback(async () => {
    setAnnouncements(await client.get('/announcements'))
  }, [])

  useEffect(() => {
    if (who.state !== 'signed-in') return
    void loadAnnouncements().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [who.state, loadAnnouncements])

  // The schedule, for the one card at the top of the screen. Its own read and
  // its own failure: a Shifts read that refuses must not take the wall of
  // Announcements down with it, so this one keeps its own state and the card
  // says what it knows.
  useEffect(() => {
    if (who.state !== 'signed-in') return
    let current = true
    client
      .get('/shifts')
      .then((listed) => {
        if (current) setSchedule(listed)
      })
      .catch(() => {
        if (current) setSchedule('unreadable')
      })
    return () => {
      current = false
    }
  }, [who.state])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await loadAnnouncements()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [loadAnnouncements],
  )

  return (
    <main>
      {/* The hero band: navy, one line of who you are, and nothing to press
          that is not the one thing this state is for (DESIGN.md). */}
      <div className="hero">
        <h1>Caballus</h1>
        {who.state === 'asking' && <p>One moment…</p>}
        {who.state === 'signed-out' && (
          <p>
            <Link to="/login">Sign in</Link> to get started.
          </p>
        )}
        {who.state === 'broken' && <p role="alert">Something is wrong: {who.because}</p>}
        {who.state === 'signed-in' && (
          <>
            <p>Signed in as {who.me.name}.</p>
            {who.me.domainScopes.length === 0 ? (
              <p>You hold no domain scopes.</p>
            ) : (
              <p className="hero-scopes">
                {who.me.domainScopes.map((scope) => (
                  <span key={scope} className="hero-scope">
                    {scope}
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>

      {who.state === 'signed-in' && (
        <>
          {problem !== null && <p role="alert">{problem}</p>}

          {/* First on the screen, because it is the answer to *what do I do
              now* and everything below it is the answer to *what else is
              there*. */}
          <RightNow schedule={schedule} me={who.me} />

          {/* Shown only when there is something to show — a heading that is
              usually blank teaches people not to look under it (ADR 0011). */}
          {announcements !== null && announcements.announcements.length > 0 && (
            <section>
              <h2>Announcements</h2>
              <ul>
                {announcements.announcements.map((announcement) =>
                  editing === announcement.id ? (
                    <li key={announcement.id}>
                      <EditAnnouncement
                        announcement={announcement}
                        onCancel={() => {
                          setEditing(null)
                        }}
                        act={async (work) => {
                          await act(work)
                          setEditing(null)
                        }}
                      />
                    </li>
                  ) : (
                    <li key={announcement.id}>
                      {announcement.text} — expires {announcement.expiresOn}, posted by{' '}
                      {announcement.authoredByName}
                      {announcement.lastEditedByName !== null &&
                        ` (last edited by ${announcement.lastEditedByName})`}
                      {who.me.domainScopes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(announcement.id)
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          <p className="section-label">The barn</p>
          <Tiles destinations={barn} />

          {/* The desk is folded away rather than removed. Eleven admin screens
              sitting open under seven barn ones is what made this page read as
              a site map: an officer opens them from a desk, deliberately, and a
              volunteer on a phone never opens them at all. Every one of them
              stays present and one tap away, because a link that is not there
              is indistinguishable from a broken app (ADR 0011). */}
          <details className="desk">
            <summary>
              <span className="desk-name">The desk</span>
              <span className="desk-what">Setup, records and reports. {desk.length} screens.</span>
            </summary>
            <Tiles destinations={desk} />
          </details>

          {/* Posting takes any single Domain Scope, not the enumerated pair
              other forms in this application check (ADR 0018). */}
          {who.me.domainScopes.length > 0 && (
            <section>
              <form
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  const form = event.currentTarget
                  const data = new FormData(form)
                  void act(() =>
                    client.post('/announcements', {
                      text: String(data.get('text') ?? ''),
                      expiresOn: dayString(String(data.get('expiresOn') ?? '')),
                    }),
                  ).then(() => {
                    form.reset()
                  })
                }}
              >
                <h3>Post an announcement</h3>
                <label htmlFor="new-announcement-text">Text</label>
                <textarea id="new-announcement-text" name="text" required maxLength={2000} />
                <label htmlFor="new-announcement-expires">Expires on</label>
                <input id="new-announcement-expires" name="expiresOn" type="date" required />
                <button type="submit">Post</button>
              </form>
            </section>
          )}

          {/* Reachable, because a session lasts until somebody ends it and the
              barn has a shared tablet on it. This ends *this* session only —
              revoking every session an Account holds is an officer's act. */}
          <div className="quiet-actions">
            <button
              type="button"
              onClick={() => {
                void signOutHere().then(() => {
                  window.location.assign('/login')
                })
              }}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </main>
  )
}

/**
 * Editing an Announcement in place — by the author or any Domain Scope
 * holder, since that is the check `mutation` runs on `/announcements/edit`
 * (ADR 0018). No confirmation step beyond the form itself: this is the same
 * *edit and save* discipline `EditProduct` on the admin screens follows.
 */
function EditAnnouncement({
  announcement,
  onCancel,
  act,
}: {
  announcement: Announcement
  onCancel: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/announcements/edit', {
            announcementId: announcement.id,
            text: String(data.get('text') ?? ''),
            expiresOn: dayString(String(data.get('expiresOn') ?? '')),
          }),
        )
      }}
    >
      <label htmlFor={`edit-announcement-text-${announcement.id}`}>Text</label>
      <textarea
        id={`edit-announcement-text-${announcement.id}`}
        name="text"
        required
        maxLength={2000}
        defaultValue={announcement.text}
      />
      <label htmlFor={`edit-announcement-expires-${announcement.id}`}>Expires on</label>
      <input
        id={`edit-announcement-expires-${announcement.id}`}
        name="expiresOn"
        type="date"
        required
        defaultValue={announcement.expiresOn}
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
