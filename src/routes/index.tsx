/**
 * Home: what is happening today (#67, ADR 0011, ADR 0014, ADR 0018).
 *
 * Until #66 this screen's whole job was to list the other nineteen. Navigation
 * carries every Destination now, so a grid of tiles here would be a second copy
 * of the sidebar — and the thing a volunteer standing in a field actually wants
 * is not a map of the app.
 *
 * **Four sections, and every one of them vanishes when it is empty.** Not an
 * empty state — gone. ADR 0018's existing rule about Announcements, applied to
 * all four: a heading that is usually blank teaches people to stop reading
 * under it, which is the argument this file already made about a tab. All four
 * empty is a real morning and gets one sentence rather than four blank
 * headings.
 *
 * **One request.** `/home` is composed by the server (#67), on `/board`'s own
 * precedent: everything here is derivable from floor reads the phone already
 * has, and composing it on the client would need no server work at all — which
 * is exactly the half-loaded screen #60 refused on the Board. Four requests is
 * four ways to be partly wrong on barn signal.
 *
 * **The one thing not on the wire is a sentence.** What a Shift is missing is
 * spelled by `staffingFact` from the gaps the read carries, so this screen, the
 * Shifts screen and the evening digest cannot describe Thursday differently —
 * and the internal phrase *staffing gap* reaches none of them (ADR 0011).
 *
 * Sign out moved to the sidebar's footer with #66, so nothing is orphaned by
 * this screen having almost nothing on it some mornings.
 *
 * **And the navy hero band went with #88.** It said *Caballus* over *Signed in
 * as …*, both of which the sidebar has said on every screen since #66 — the
 * application's name twice on the one screen where nobody is wondering which
 * app they opened, spending the first inch of a phone screen the next-Shift
 * card should have. The heading is the **rescue's own name** now, which is the
 * one thing this screen can say that the sidebar cannot, in the room the band
 * was using. It rides on the same composed read as everything else: a heading
 * arriving after the cards is the half-loaded screen #60 refused, and
 * `clockHere` already had the name off the row it reads the timezone from.
 *
 * **A visitor with no session gets a different screen entirely** (#75): the
 * public page in `src/components/landing.tsx`, which describes the application
 * and what it sends by text — a requirement of 10DLC campaign vetting (ADR
 * 0028) rather than decoration. It is the `signed-out` branch and nothing else
 * changes; the shell is already off for that reader (#66).
 *
 * **And that branch is decided on the server, because the reader who matters
 * runs no JavaScript.** The campaign vetting bot fetches `/` once and reads
 * what the HTML says; while `signed-out` was reached only through `/home`'s
 * 401 in an effect, what it read was the skeleton's *One moment…* — and the
 * campaign was rejected (30886) for an opt-in page it could not see. The
 * loader below answers one hint — did the request carry a session cookie at
 * all — so a cookie-less request gets the public page in the server's own
 * HTML. It is a hint and never the truth: a stale cookie still renders the
 * skeleton and `/home`'s answer still decides, exactly as before.
 */
import { Link, createFileRoute, useLoaderData } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getStartContext } from '@tanstack/start-storage-context'
import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Field, Fields, WideField } from '../components/forms'
import { Landing } from '../components/landing'
import { Refusal } from '../components/refusal'
import { UrgentSend } from '../components/urgent-send'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import { ApiError, client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import { staffingFact } from '../shared/staffing'
import { dayString, daysBetween } from '../shared/time'
import type { Answers, contract } from '../shared/api-contract'
import { SHIFT_TYPE_LABEL } from '../shared/shifts'

/**
 * Whether the request carried a session cookie — presence, never validity.
 *
 * The server side reads the request out of the framework's own per-request
 * storage. `@tanstack/start-storage-context` is Start's internal package,
 * imported deliberately: this version exports no public accessor for the
 * request outside a server function, and a server function here is the thing
 * ADR 0016 bans. Owned the way `storeOTP`'s shape is owned in
 * `src/server/auth/email-change.ts` — revisit on the next Start upgrade,
 * which may offer the public door. Outside a request (the test harness), the
 * answer is `true`: unknowable behaves exactly as this screen always has.
 *
 * The client side answers `true` for the same reason: a volunteer navigating
 * here mid-session must get the skeleton, and `/home` remains the one thing
 * that decides.
 */
const requestCarriesSession = createIsomorphicFn()
  .client(() => true)
  .server(() => {
    const start = getStartContext({ throwIfNotFound: false })
    if (start === undefined) return true
    // Better Auth's cookie in both spellings: `better-auth.session_token`,
    // and `__Secure-`-prefixed in production.
    return (start.request.headers.get('cookie') ?? '').includes('session_token')
  })

export const Route = createFileRoute('/')({
  loader: () => ({ carriesSession: requestCarriesSession() }),
  component: Home,
})

type HomePage = Answers<typeof contract, '/home'>
type Announcement = HomePage['announcements'][number]
type NextShift = NonNullable<HomePage['nextShift']>
type CoverableShift = HomePage['cover'][number]
type OpenEscalation = HomePage['escalations'][number]

/**
 * What the one read answered, or why it did not.
 *
 * *Signed out* is `/home`'s explicit 401 read back — a signed-out request and a
 * broken server are different facts and get different screens, which is the
 * whole reason a refusal is a status and a shape rather than an empty answer
 * (ADR 0010).
 */
type State =
  | { readonly state: 'asking' }
  | { readonly state: 'ready'; readonly page: HomePage }
  | { readonly state: 'signed-out' }
  | { readonly state: 'broken'; readonly because: string }

/**
 * Field Signal's section heading is a **mono label** rather than a heading in
 * the text face: the dashboard is a stack of four unrelated lists, and what
 * separates them has to read as furniture rather than as something to read.
 */
const SECTION_HEADING =
  'mb-3 mt-6 font-mono text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground'
const PANEL = 'mb-4 rounded-lg border border-border bg-background p-4 sm:p-6'
const ROW =
  'flex items-center justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0'

/**
 * **The one thing to do now.** First on the screen, because everything below it
 * answers *what else is there*.
 *
 * It is the volunteer's own Shift and nobody else's: a roster row naming them
 * that has not ended, which the server resolves with the same test `/shifts`
 * renders *mine* from, so this card and the Shifts screen cannot disagree about
 * whether Thursday is theirs.
 */
function NextShiftCard({ shift, today }: { shift: NextShift; today: string }) {
  const started = shift.state === 'in_progress'

  return (
    <section
      className="mb-5 rounded-lg bg-brand-navy p-5 text-on-dark"
      aria-label="Your next shift"
    >
      <p className="m-0 mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-on-dark-muted">
        <span className="rounded-full bg-primary px-2.5 py-0.5 text-primary-foreground">
          {when(today, shift.day)}
        </span>
        {started && (
          <span className="rounded-full border border-brand-navy-mid px-2.5 py-0.5">Underway</span>
        )}
      </p>
      <h2 className="m-0 text-[28px] font-bold leading-tight tracking-tight text-on-dark">
        {SHIFT_TYPE_LABEL[shift.shiftType]} at {shift.startTime}
      </h2>
      {shift.purpose !== null && (
        <p className="m-0 mt-1 text-sm text-on-dark-muted">{shift.purpose}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link to="/shifts/$shiftId" params={{ shiftId: shift.id }}>
            {started ? 'Open the checklist' : 'Open the Shift'}
          </Link>
        </Button>
        {shift.more > 0 && (
          <Link to="/shifts" className="text-sm text-on-dark-muted">
            {shift.more} more after this
          </Link>
        )}
      </div>
    </section>
  )
}

/**
 * The Shifts short of people that this volunteer could Cover — the server has
 * already dropped the ones a Cover from them would be refused on, and the ones
 * too far out to be worth shouting about (ADR 0011).
 */
function NeedsCover({ shifts, today }: { shifts: readonly CoverableShift[]; today: string }) {
  return (
    <section>
      <h2 className={SECTION_HEADING}>Shifts needing cover</h2>
      <div className={PANEL}>
        <ul className="m-0 list-none p-0">
          {shifts.map((shift) => (
            <li key={shift.id} className={ROW}>
              <span>
                <Link to="/shifts">
                  {when(today, shift.day)} — {SHIFT_TYPE_LABEL[shift.shiftType]} at{' '}
                  {shift.startTime}
                </Link>{' '}
                <strong>
                  — needs:{' '}
                  {shift.gaps
                    .map((gap) =>
                      staffingFact(gap, {
                        standing: shift.standing,
                        targetHeadcount: shift.targetHeadcount,
                      }),
                    )
                    .join(', ')}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * The Escalations addressed to a Domain Scope this person holds that nobody
 * has closed. The thread is not here — it is on `/escalations`, one tap away —
 * because carrying every comment on every open report onto the first screen of
 * the morning is the cost the composed read exists to avoid.
 */
function MyEscalations({ escalations }: { escalations: readonly OpenEscalation[] }) {
  return (
    <section>
      <h2 className={SECTION_HEADING}>Your open escalations</h2>
      <div className={PANEL}>
        <ul className="m-0 list-none p-0">
          {escalations.map((escalation) => (
            <li key={escalation.id} className={ROW}>
              <span>
                <Link to="/escalations">{escalation.framing}</Link>
                {escalation.observationSubjectLabel !== null && (
                  <> — about {escalation.observationSubjectLabel}</>
                )}
                <span className="block text-sm text-muted-foreground">
                  {escalation.observationText}
                  {escalation.comments > 0 && ` — ${String(escalation.comments)} in the thread`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** *Today*, *Tomorrow*, or the date — the same words the next-shift card uses. */
function when(today: string, day: string): string {
  const away = daysBetween(dayString(today), dayString(day))
  return away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : day
}

function Home() {
  // `strict: false`, the way `shifts.$shiftId.tsx` reads its param: the test
  // harness mounts this component on a route of its own, which has no loader
  // and answers `undefined` — and undefined means *asking*, as it always did.
  const loaded = useLoaderData({ strict: false }) as { carriesSession?: boolean } | undefined
  const [state, setState] = useState<State>(
    loaded?.carriesSession === false ? { state: 'signed-out' } : { state: 'asking' },
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Through the typed client, so the answer is parsed against the same
    // contract the server registered against rather than asserted (ADR 0021).
    setState({ state: 'ready', page: await client.get('/home') })
  }, [])

  useEffect(() => {
    let current = true
    void load().catch((error: unknown) => {
      if (!current) return
      if (error instanceof ApiError && error.status === 401) {
        setState({ state: 'signed-out' })
        return
      }
      setState({ state: 'broken', because: error instanceof Error ? error.message : 'unknown' })
    })
    return () => {
      current = false
    }
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await load()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [load],
  )

  const page = state.state === 'ready' ? state.page : null
  const quiet =
    page !== null &&
    page.nextShift === null &&
    page.announcements.length === 0 &&
    page.cover.length === 0 &&
    page.escalations.length === 0

  // The public page, and the whole of what a visitor with no session sees
  // (#75, ADR 0028). Not a variation on the dashboard — a different screen,
  // because the reader is a carrier's vetting reviewer as often as it is
  // somebody the rescue has just told about the app, and neither of them has
  // any use for four empty sections.
  if (state.state === 'signed-out') return <Landing />

  return (
    <main>
      {/* The rescue's own name, with the room the navy band used to spend on
          the application's (#88). *Caballus* is the sidebar's wordmark on
          every screen; a volunteer standing in a barn already knows which app
          they opened, and what this screen can say that the sidebar cannot is
          whose barn it is. */}
      {page !== null && (
        <div className="mb-6 mt-2 min-[600px]:mb-8 min-[600px]:mt-4">
          {/* The day, in the mono face, above the name. It is the one fact on
              this screen that everything else is relative to — *tomorrow*,
              *Thu 4 Sep*, *in a fortnight* are all read against it — and the
              server already resolved it in the organisation's own timezone
              (ADR 0007, ADR 0016), so putting it here costs nothing and stops
              a volunteer working out which *today* the page means. */}
          <p className="m-0 mb-1 font-mono text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {page.today}
          </p>
          <h1 className="m-0 text-4xl leading-tight tracking-tight text-foreground min-[600px]:text-5xl">
            {page.organisation}
          </h1>
        </div>
      )}

      {state.state === 'broken' && (
        <p role="alert" className="mb-6 mt-2 text-base text-foreground">
          Something is wrong: {state.because}
        </p>
      )}

      {/* Grey blocks rather than the word *Loading* on a blank screen: this is
          opened cold on barn signal, and a page with nothing on it reads as an
          app that did not start. The heading is one of them — the name arrives
          with the rest of the read, and a placeholder is honester than a flash
          of the wrong barn. */}
      {state.state === 'asking' && (
        <>
          <p className="sr-only">One moment…</p>
          <div aria-hidden="true">
            <Skeleton className="mb-6 mt-2 h-10 w-3/4 min-[600px]:mb-8 min-[600px]:mt-4 min-[600px]:h-12" />
            <Skeleton className="mb-5 h-36 w-full" />
            <Skeleton className="mb-4 h-24 w-full" />
          </div>
        </>
      )}

      {page !== null && (
        <>
          {problem !== null && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>
                <Refusal>{problem}</Refusal>
              </AlertTitle>
            </Alert>
          )}

          {quiet && (
            <p className="text-base text-muted-foreground">
              Nothing needs you right now — no shift coming up, nothing posted, nothing short and
              nothing open.
            </p>
          )}

          {page.nextShift !== null && <NextShiftCard shift={page.nextShift} today={page.today} />}

          {page.announcements.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING}>Announcements</h2>
              <div className={PANEL}>
                <ul className="m-0 list-none p-0">
                  {page.announcements.map((announcement) =>
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
                      <li key={announcement.id} className={ROW}>
                        <span>
                          {announcement.text} — expires {announcement.expiresOn}, posted by{' '}
                          {announcement.authoredByName}
                          {announcement.lastEditedByName !== null &&
                            ` (last edited by ${announcement.lastEditedByName})`}
                        </span>
                        {page.me.domainScopes.length > 0 && (
                          <span className="flex flex-none flex-wrap items-center gap-2">
                            {/* The Urgent Send (#77), which amends ADR 0018:
                                posting still sends nothing, and a second
                                deliberate act may put one in front of people.
                                Once — an Announcement is posted once, an edit
                                does not re-open it, and the control is gone
                                after rather than offering a send the server
                                would refuse. */}
                            {announcement.urgentSentAt === null && (
                              <UrgentSend
                                audience={{ kind: 'everyone' }}
                                label="Text everyone"
                                onSend={() =>
                                  client.post('/announcements/text', {
                                    announcementId: announcement.id,
                                  })
                                }
                              />
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditing(announcement.id)
                              }}
                            >
                              <Pencil aria-hidden="true" />
                              Edit
                            </Button>
                          </span>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </section>
          )}

          {page.cover.length > 0 && <NeedsCover shifts={page.cover} today={page.today} />}

          {page.escalations.length > 0 && <MyEscalations escalations={page.escalations} />}

          {/* Posting takes any single Domain Scope, not the enumerated pair
              other forms in this application check (ADR 0018). The barn's wall
              is exactly where a volunteer already is when the water goes off in
              the tack room, which is why the form is here and not on a desk. */}
          {page.me.domainScopes.length > 0 && (
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
