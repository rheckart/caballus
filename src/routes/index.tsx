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
import { ChevronDown, Pencil } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Field, Fields, WideField } from '../components/forms'
import { Refusal } from '../components/refusal'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
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

type Tint = 'lavender' | 'peach' | 'sky' | 'mint' | 'yellow' | 'rose' | 'cream' | 'gray'

interface Destination {
  readonly to: string
  readonly glyph: string
  readonly name: string
  readonly what: string
  readonly tint: Tint
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
    what: 'Stalls, pastures, paddocks and barns',
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
    to: '/admin/whiteboard-read',
    glyph: '\u{1F4F7}',
    name: 'Read the whiteboard',
    what: 'Photograph a panel of the paper board',
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

/**
 * In Light the tint is the tile's fill; in Dark it becomes a left accent on
 * the ordinary card surface, because the pastel family is single-valued and a
 * pastel fill under Dark's foreground is unreadable (ADR 0025).
 */
const TILE_TINT: Record<Tint, string> = {
  lavender:
    'border-transparent bg-card-tint-lavender dark:border-l-4 dark:border-border dark:border-l-card-tint-lavender dark:bg-background',
  peach:
    'border-transparent bg-card-tint-peach dark:border-l-4 dark:border-border dark:border-l-card-tint-peach dark:bg-background',
  sky: 'border-transparent bg-card-tint-sky dark:border-l-4 dark:border-border dark:border-l-card-tint-sky dark:bg-background',
  mint: 'border-transparent bg-card-tint-mint dark:border-l-4 dark:border-border dark:border-l-card-tint-mint dark:bg-background',
  yellow:
    'border-transparent bg-card-tint-yellow dark:border-l-4 dark:border-border dark:border-l-card-tint-yellow dark:bg-background',
  rose: 'border-transparent bg-card-tint-rose dark:border-l-4 dark:border-border dark:border-l-card-tint-rose dark:bg-background',
  cream:
    'border-transparent bg-card-tint-cream dark:border-l-4 dark:border-border dark:border-l-card-tint-cream dark:bg-background',
  gray: 'border-transparent bg-card-tint-gray dark:border-l-4 dark:border-border dark:border-l-card-tint-gray dark:bg-background',
}

function Tiles({ destinations }: { destinations: readonly Destination[] }) {
  return (
    <ul className="m-0 mb-4 grid list-none grid-cols-2 gap-3 p-0 min-[600px]:grid-cols-3 min-[900px]:grid-cols-4">
      {destinations.map((destination) => (
        <li key={destination.to} className="m-0 p-0">
          <Link
            to={destination.to}
            className={`flex h-full min-h-[104px] flex-col gap-1 rounded-lg border p-4 text-secondary-foreground transition hover:-translate-y-0.5 hover:no-underline hover:shadow-md ${TILE_TINT[destination.tint]}`}
          >
            <span className="text-[22px] leading-none" aria-hidden="true">
              {destination.glyph}
            </span>
            <span className="text-base font-semibold text-foreground">{destination.name}</span>
            <span className="text-[13px] leading-snug text-muted-foreground">
              {destination.what}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** The quiet variant of the *now* card: grey where the real one is lavender. */
const NOW_QUIET_CARD =
  'mb-5 rounded-lg border-0 bg-secondary p-5 dark:border dark:border-border dark:bg-transparent'
const NOW_QUIET_WHEN = 'm-0 mb-1 text-base font-medium text-muted-foreground'
const NOW_ACTIONS = 'mt-4 flex flex-wrap items-center gap-3'

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
      <section className={NOW_QUIET_CARD} aria-label="Your next shift">
        <p className={NOW_QUIET_WHEN}>Looking up your shifts…</p>
      </section>
    )
  }

  if (schedule === 'unreadable') {
    return (
      <section className={NOW_QUIET_CARD} aria-label="Your next shift">
        <p className={NOW_QUIET_WHEN}>Your shifts could not be read just now.</p>
        <div className={NOW_ACTIONS}>
          <Button asChild size="lg">
            <Link to="/shifts">Open Shifts</Link>
          </Button>
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
      <section className={NOW_QUIET_CARD} aria-label="Your next shift">
        <p className={NOW_QUIET_WHEN}>You are not rostered on anything yet.</p>
        <p className="m-0 max-w-[58ch] text-sm text-muted-foreground">
          Anybody with an Orientation may Cover a Shift that needs people. No approval step, and no
          waiting to be asked.
        </p>
        <div className={NOW_ACTIONS}>
          <Button asChild size="lg">
            <Link to="/shifts">Find a Shift to cover</Link>
          </Button>
        </div>
      </section>
    )
  }

  const away = daysBetween(schedule.today, next.day)
  const when = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : next.day
  const started = away === 0 && next.state === 'in_progress'

  return (
    <section
      className="mb-5 rounded-lg border-0 bg-card-tint-lavender p-5 dark:border dark:border-card-tint-lavender/40 dark:bg-transparent"
      aria-label="Your next shift"
    >
      <p className="m-0 mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand-purple-800 dark:text-card-tint-lavender">
        {when}
        {started && (
          <span className="rounded-full bg-success px-2 py-0.5 text-[11px] tracking-widest text-primary-foreground">
            Underway
          </span>
        )}
      </p>
      <h2 className="m-0 text-[26px] leading-tight tracking-tight text-foreground">
        {SHIFT_TYPE_LABEL[next.shiftType]} at {next.startTime}
      </h2>
      {next.purpose !== null && (
        <p className="m-0 mt-1 text-sm text-muted-foreground">{next.purpose}</p>
      )}
      <div className={NOW_ACTIONS}>
        <Button asChild size="lg">
          <Link to="/shifts/$shiftId" params={{ shiftId: next.id }}>
            {started ? 'Open the checklist' : 'Open the Shift'}
          </Link>
        </Button>
        {mine.length > 1 && (
          <Link to="/shifts" className="text-sm text-muted-foreground">
            {mine.length - 1} more after this
          </Link>
        )}
      </div>
    </section>
  )
}

const HERO_LINE = 'm-0 max-w-[46ch] text-base text-on-dark-muted'

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
      <div className="mb-5 rounded-lg bg-brand-navy px-5 py-8 min-[600px]:px-8 min-[600px]:py-12">
        <h1 className="mb-2 text-4xl text-on-dark min-[600px]:text-5xl">Caballus</h1>
        {who.state === 'asking' && <p className={HERO_LINE}>One moment…</p>}
        {who.state === 'signed-out' && (
          <p className={HERO_LINE}>
            <Link to="/login" className="text-on-dark underline">
              Sign in
            </Link>{' '}
            to get started.
          </p>
        )}
        {who.state === 'broken' && (
          <p role="alert" className="m-0 max-w-[46ch] text-base text-on-dark">
            Something is wrong: {who.because}
          </p>
        )}
        {who.state === 'signed-in' && (
          <>
            <p className={HERO_LINE}>Signed in as {who.me.name}.</p>
            {who.me.domainScopes.length === 0 ? (
              <p className={HERO_LINE}>You hold no domain scopes.</p>
            ) : (
              <p className="m-0 mt-4 flex flex-wrap gap-2">
                {who.me.domainScopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full bg-brand-navy-mid px-2.5 py-1 text-[13px] font-semibold text-on-dark"
                  >
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
          {problem !== null && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>
                <Refusal>{problem}</Refusal>
              </AlertTitle>
            </Alert>
          )}

          {/* First on the screen, because it is the answer to *what do I do
              now* and everything below it is the answer to *what else is
              there*. */}
          <RightNow schedule={schedule} me={who.me} />

          {/* Shown only when there is something to show — a heading that is
              usually blank teaches people not to look under it (ADR 0011). */}
          {announcements !== null && announcements.announcements.length > 0 && (
            <section>
              <h2 className="mb-3 mt-6 text-foreground">Announcements</h2>
              <div className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
                <ul className="m-0 list-none p-0">
                  {announcements.announcements.map((announcement) =>
                    editing === announcement.id ? (
                      <li
                        key={announcement.id}
                        className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                      >
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
                      <li
                        key={announcement.id}
                        className="flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                      >
                        <span>
                          {announcement.text} — expires {announcement.expiresOn}, posted by{' '}
                          {announcement.authoredByName}
                          {announcement.lastEditedByName !== null &&
                            ` (last edited by ${announcement.lastEditedByName})`}
                        </span>
                        {who.me.domainScopes.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-none"
                            onClick={() => {
                              setEditing(announcement.id)
                            }}
                          >
                            <Pencil aria-hidden="true" />
                            Edit
                          </Button>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </section>
          )}

          <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            The barn
          </p>
          <Tiles destinations={barn} />

          {/* The desk is folded away rather than removed. Eleven admin screens
              sitting open under seven barn ones is what made this page read as
              a site map: an officer opens them from a desk, deliberately, and a
              volunteer on a phone never opens them at all. Every one of them
              stays present and one tap away, because a link that is not there
              is indistinguishable from a broken app (ADR 0011). */}
          <details className="group relative mb-4 mt-5 rounded-lg border border-border bg-background">
            <summary className="flex min-h-14 cursor-pointer list-none flex-col justify-center gap-0.5 rounded-lg px-4 py-3 hover:bg-card [&::-webkit-details-marker]:hidden">
              <span className="text-base font-semibold text-foreground">The desk</span>
              <span className="text-[13px] text-muted-foreground">
                Setup, records and reports. {desk.length} screens.
              </span>
              <ChevronDown
                aria-hidden="true"
                className="absolute right-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="px-4 pb-4">
              <Tiles destinations={desk} />
            </div>
          </details>

          {/* Posting takes any single Domain Scope, not the enumerated pair
              other forms in this application check (ADR 0018). */}
          {who.me.domainScopes.length > 0 && (
            <section className="mb-4 mt-6 rounded-lg border border-border bg-background p-4 sm:p-6">
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
                <h3 className="m-0">Post an announcement</h3>
                <Fields>
                  <WideField label="Text" htmlFor="new-announcement-text">
                    <Textarea id="new-announcement-text" name="text" required maxLength={2000} />
                  </WideField>
                  <Field label="Expires on" htmlFor="new-announcement-expires">
                    <Input id="new-announcement-expires" name="expiresOn" type="date" required />
                  </Field>
                </Fields>
                <Actions>
                  <Button type="submit">Post</Button>
                </Actions>
              </form>
            </section>
          )}
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
      <Fields>
        <WideField label="Text" htmlFor={`edit-announcement-text-${announcement.id}`}>
          <Textarea
            id={`edit-announcement-text-${announcement.id}`}
            name="text"
            required
            maxLength={2000}
            defaultValue={announcement.text}
          />
        </WideField>
        <Field label="Expires on" htmlFor={`edit-announcement-expires-${announcement.id}`}>
          <Input
            id={`edit-announcement-expires-${announcement.id}`}
            name="expiresOn"
            type="date"
            required
            defaultValue={announcement.expiresOn}
          />
        </Field>
      </Fields>
      <Actions>
        <Button type="submit">Save</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </Actions>
    </form>
  )
}
