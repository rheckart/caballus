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
 * **A visitor with no session gets a different screen entirely** (#75): the
 * public page in `src/components/landing.tsx`, which describes the application
 * and what it sends by text — a requirement of 10DLC campaign vetting (ADR
 * 0028) rather than decoration. It is the `signed-out` branch and nothing else
 * changes; the shell is already off for that reader (#66).
 */
import { Link, createFileRoute } from '@tanstack/react-router'
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

export const Route = createFileRoute('/')({
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

const HERO_LINE = 'm-0 max-w-[46ch] text-base text-on-dark-muted'
const SECTION_HEADING = 'mb-3 mt-6 text-foreground'
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
      className="mb-5 rounded-lg border-0 bg-card-tint-lavender p-5 dark:border dark:border-card-tint-lavender/40 dark:bg-transparent"
      aria-label="Your next shift"
    >
      <p className="m-0 mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-brand-purple-800 dark:text-card-tint-lavender">
        {when(today, shift.day)}
        {started && (
          <span className="rounded-full bg-success px-2 py-0.5 text-[11px] tracking-widest text-primary-foreground">
            Underway
          </span>
        )}
      </p>
      <h2 className="m-0 text-[26px] leading-tight tracking-tight text-foreground">
        {SHIFT_TYPE_LABEL[shift.shiftType]} at {shift.startTime}
      </h2>
      {shift.purpose !== null && (
        <p className="m-0 mt-1 text-sm text-muted-foreground">{shift.purpose}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link to="/shifts/$shiftId" params={{ shiftId: shift.id }}>
            {started ? 'Open the checklist' : 'Open the Shift'}
          </Link>
        </Button>
        {shift.more > 0 && (
          <Link to="/shifts" className="text-sm text-muted-foreground">
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
  const [state, setState] = useState<State>({ state: 'asking' })
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
      {/* The hero band: navy, one line of who you are, and nothing to press
          that is not the one thing this state is for (DESIGN.md). */}
      <div className="mb-5 rounded-lg bg-brand-navy px-5 py-8 min-[600px]:px-8 min-[600px]:py-12">
        <h1 className="mb-2 text-4xl text-on-dark min-[600px]:text-5xl">Caballus</h1>
        {state.state === 'asking' && <p className={HERO_LINE}>One moment…</p>}
        {state.state === 'broken' && (
          <p role="alert" className="m-0 max-w-[46ch] text-base text-on-dark">
            Something is wrong: {state.because}
          </p>
        )}
        {page !== null && <p className={HERO_LINE}>Signed in as {page.me.name}.</p>}
      </div>

      {/* Grey blocks rather than the word *Loading* on a blank screen: this is
          opened cold on barn signal, and a page with nothing on it reads as an
          app that did not start. */}
      {state.state === 'asking' && (
        <div aria-hidden="true">
          <Skeleton className="mb-5 h-36 w-full" />
          <Skeleton className="mb-4 h-24 w-full" />
        </div>
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
