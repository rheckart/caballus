/**
 * A volunteer's own Shifts, on the phone (`CONTEXT.md`'s Shift, Cover, Drop).
 *
 * Two lists and no scrolling past what matters: **mine**, with the one action
 * that is a volunteer's own — Drop — and **open to sign-up**, where anybody
 * oriented may Cover with no approval step.
 *
 * **Neither queues.** ADR 0011's carve-out from ADR 0005, restated by ADR 0018
 * as *the app queues when it is the ledger and not when it is the medium*: a
 * Cover is not true until it arrives, and two volunteers each looking at their
 * own phone and each seeing Thursday covered is a Thursday with nobody on it.
 * So a failed Cover says so plainly and the commitment does not exist — which
 * this screen says in as many words rather than leaving a spinner to imply it.
 *
 * **A Cover is never refused for what somebody lacks.** A Shift that needs
 * medication still takes a volunteer who cannot give it, and says what it still
 * needs (ADR 0011).
 *
 * **What a Shift is missing is shown as the fact itself.** *No Lead*, *nobody
 * who can give medication*, *1 of 3 wanted* — never the phrase *staffing gap*,
 * which ADR 0011 keeps as an internal term precisely because a category name is
 * not something anybody can act on. And Short, where a person declared it, is
 * named as somebody's judgement rather than as another thing the app worked out.
 *
 * **Acting Lead is claimed, never assigned.** A Shift with nobody leading it
 * offers the claim to whoever is rostered on it, with the suggested person's
 * button saying so — a suggestion and not a restriction, because restricting it
 * leaves a Shift leaderless exactly when the suggested person did not show
 * (ADR 0010).
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { Empty, Loading } from '../components/forms'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { client } from '../shared/api-client'
import { rosteredAbsent } from '../shared/attendance'
import { refusalText } from '../shared/refusals'
import type { AssignablePosition } from '../shared/shifts'
import { carriesShiftAuthority } from '../shared/shifts'
import { staffingFacts } from '../shared/staffing'
import { daysBetween } from '../shared/time'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/shifts')({
  component: MyShifts,
})

type Schedule = Answers<typeof contract, '/shifts'>
type Shift = Schedule['shifts'][number]
type Me = Answers<typeof contract, '/me'>

const SHIFT_TYPE_LABEL: Record<Shift['shiftType'], string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
  pop_up: 'Pop-up',
}

const POSITION_LABEL: Record<AssignablePosition | 'acting_lead', string> = {
  lead: 'Lead',
  co_lead: 'Co-Lead',
  acting_lead: 'Acting Lead',
  volunteer: 'Volunteer',
}

/**
 * How far out a volunteer sees what a Shift is missing.
 *
 * ADR 0011: the gaps are computed across the whole horizon **for holders of
 * `roster`**, and are "prominent to everyone else only inside roughly the next
 * 48 hours". A fortnight of *no Lead* on a phone is a wall of red about Shifts
 * nobody can do anything about yet, and a screen that shouts every day is a
 * screen people stop reading — the same argument the four-gap list is shaped
 * by, pointed at distance instead of at count. Beyond the window the Shift is
 * still listed and still coverable; the headcount beside it still says how
 * thin it is.
 */
const PROMINENT_DAYS = 2

/**
 * What this Shift is missing, in words. `staffingFacts` is the one place those
 * sentences live, so the phone, the desk and the digest cannot describe
 * Thursday differently.
 */
function WhatIsMissing({ shift, within }: { shift: Shift; within: boolean }) {
  const facts = within ? staffingFacts(shift) : []

  if (facts.length === 0 && shift.short === null) return null

  return (
    <>
      {facts.length > 0 && <strong> — needs: {facts.join(', ')}</strong>}
      {/* Shown at any distance, because it is not arithmetic: somebody decided
          this, and the app neither declares Short nor withdraws it (ADR 0011). */}
      {shift.short !== null && <strong> — somebody has called this shift short</strong>}
    </>
  )
}

/**
 * The sign-in sheet, replaced (ADR 0012): a button that says which of the
 * three states this Shift is in for `volunteerId` — never arrived, signed in,
 * or signed out — and does the one action that moves it forward. `for` names
 * whose Attendance this is; it is `me`'s own row on the common path and
 * anybody else's when a Lead is signing somebody in who arrived without a
 * phone in hand, which is allowed in both directions and always attributed to
 * whoever taps the button.
 */
function AttendanceControl({
  shiftId,
  forVolunteer,
  busy,
  act,
}: {
  shiftId: string
  forVolunteer: {
    volunteerId: string
    name?: string
    entry: Shift['attendance'][number] | undefined
  }
  busy: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { volunteerId, name, entry } = forVolunteer

  if (entry === undefined) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => {
          void act(() => client.post('/attendance/sign-in', { volunteerId, shiftId }))
        }}
      >
        Sign in{name !== undefined ? ` — ${name}` : ''}
      </Button>
    )
  }

  if (entry.departedAt === null) {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => {
          void act(() => client.post('/attendance/sign-out', { volunteerId, shiftId }))
        }}
      >
        Sign out{name !== undefined ? ` — ${name}` : ''}
      </Button>
    )
  }

  return <span className="text-sm text-muted-foreground">— signed out</span>
}

/**
 * The fourth roster fact ADR 0012 names: **rostered, absent, no Drop** —
 * displayed, and nothing more. The app does not count it, does not flag a
 * pattern in it, and never turns it into a label on a person; it is what a
 * Lead already knows standing in the barn, said out loud on the screen they
 * are already looking at.
 */
function RosteredAbsent({ shift }: { shift: Shift }) {
  const absent = rosteredAbsent(shift.roster, shift.attendance)
  if (absent.length === 0) return null

  const names = absent.map(
    (volunteerId) => shift.roster.find((member) => member.volunteerId === volunteerId)?.name,
  )

  return (
    <p className="m-0 mt-1 text-sm text-muted-foreground">
      Rostered, not yet signed in: {names.filter((name) => name !== undefined).join(', ')}
    </p>
  )
}

function MyShifts() {
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // What stops a double tap becoming two writes. The idempotency key does not:
  // the client mints a fresh one per call, so a second tap is a second write
  // that lands on a 409 and tells a volunteer their Cover failed when it
  // worked (ADR 0005 is about a retry of *one* attempt, not about two taps).
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [listed, who] = await Promise.all([client.get('/shifts'), client.get('/me')])
    setSchedule(listed)
    setMe(who)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      setBusy(true)
      try {
        await work()
        await load()
      } catch (error: unknown) {
        // Online-only, so a failure is the commitment not existing — said
        // plainly rather than left to a volunteer to guess at (ADR 0011).
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  if (schedule === null || me === null) {
    return (
      <main>
        <h1>My shifts</h1>
        {problem === null ? (
          <Loading what="shifts" />
        ) : (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{problem}</AlertTitle>
          </Alert>
        )}
      </main>
    )
  }

  const standing = (shift: Shift) =>
    shift.roster.find((member) => member.volunteerId === me.volunteerId && member.endedAs === null)

  // `daysBetween` counts days between two `DayString`s the server already
  // resolved in the barn's zone, so nothing here derives a day boundary of its
  // own — which is the ADR 0007 rule, and why this is the shared clock rather
  // than the browser's.
  const soon = (shift: Shift) => daysBetween(schedule.today, shift.day) <= PROMINENT_DAYS

  const mine = schedule.shifts.filter((shift) => standing(shift) !== undefined)
  const open = schedule.shifts.filter(
    (shift) => standing(shift) === undefined && shift.staffingMode === 'sign_up',
  )

  return (
    <main>
      <h1>My shifts</h1>
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      <section className="mb-6">
        <h2>Mine</h2>
        {mine.length === 0 ? (
          <Empty>You are not on any Shift in the next fortnight.</Empty>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4 sm:p-6">
            <ul className="m-0 list-none p-0">
              {mine.map((shift) => {
                const member = standing(shift)
                return (
                  <li
                    key={shift.id}
                    className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <p className="m-0">
                      <strong>{shift.day}</strong> — {SHIFT_TYPE_LABEL[shift.shiftType]} at{' '}
                      {shift.startTime}
                      {member !== undefined && <> — {POSITION_LABEL[member.position]}</>}
                      {shift.purpose !== null && <> — {shift.purpose}</>}
                      {shift.state === 'in_progress' && <em> — under way</em>}
                      <WhatIsMissing shift={shift} within={soon(shift)} />
                    </p>
                    {/* Who a Lead can see is standing and rostered but has not
                        signed in — a displayed fact, never a label the app
                        applies to a person (ADR 0012). */}
                    {member !== undefined &&
                      carriesShiftAuthority(member.position) &&
                      shift.state === 'in_progress' && <RosteredAbsent shift={shift} />}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* A Pop-up materializes no checklist — it authors its own
                          list, and this ticket does not build that screen
                          (ADR 0013) — so the link is offered only where one
                          might exist. */}
                      {shift.shiftType !== 'pop_up' && (
                        <Button asChild variant="outline" size="sm">
                          <Link to="/shifts/$shiftId" params={{ shiftId: shift.id }}>
                            Checklist
                          </Link>
                        </Button>
                      )}
                      <AttendanceControl
                        shiftId={shift.id}
                        forVolunteer={{
                          volunteerId: me.volunteerId,
                          entry: shift.attendance.find(
                            (entry) => entry.volunteerId === me.volunteerId,
                          ),
                        }}
                        busy={busy}
                        act={act}
                      />
                      {/* Short is declared and cleared by whoever carries Shift
                          Authority here, which is what the Lead needs at 5am on
                          the screen they are already looking at (ADR 0011). The
                          server refuses anybody else, and the button is shown only
                          to somebody it will take. */}
                      {member !== undefined && carriesShiftAuthority(member.position) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            void act(() =>
                              client.post('/shifts/short', {
                                shiftId: shift.id,
                                short: shift.short === null,
                              }),
                            )
                          }}
                        >
                          {shift.short === null ? 'Call it short' : 'Clear short'}
                        </Button>
                      )}
                      {/* Offered to anybody rostered on a leaderless Shift, and to
                          the suggested person with the suggestion said out loud —
                          a claim nobody made silently is the point (ADR 0010). */}
                      {shift.staffing.gaps.includes('no_lead') && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            void act(() =>
                              client.post('/shifts/acting-lead', { shiftId: shift.id }),
                            )
                          }}
                        >
                          {shift.staffing.suggestedActingLead === me.volunteerId
                            ? 'Take charge as acting lead (suggested)'
                            : 'Take charge as acting lead'}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            'Anything you want to say about why? (optional)',
                            '',
                          )
                          // A cancelled prompt is a cancelled Drop; an empty one is
                          // a Drop with no reason, which is allowed and normal — a
                          // required reason collects the word "personal" sixty
                          // times (ADR 0011).
                          if (reason === null) return
                          void act(() =>
                            client.post('/shifts/drop', {
                              shiftId: shift.id,
                              reason: reason === '' ? null : reason,
                            }),
                          )
                        }}
                      >
                        Drop
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2>Open to sign-up</h2>
        {open.length === 0 ? (
          <Empty>Nothing is open for cover.</Empty>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4 sm:p-6">
            <ul className="m-0 list-none p-0">
              {open.map((shift) => (
                <li
                  key={shift.id}
                  className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <p className="m-0">
                    <strong>{shift.day}</strong> — {SHIFT_TYPE_LABEL[shift.shiftType]} at{' '}
                    {shift.startTime}
                    {shift.purpose !== null && <> — {shift.purpose}</>}
                    <span>
                      {' '}
                      {shift.roster.filter((member) => member.endedAs === null).length} of{' '}
                      {shift.targetHeadcount} so far
                    </span>
                    {/* What it still needs, beside the button that takes you
                        anyway. A Shift needing medication takes somebody who
                        cannot give it — turning away a volunteer who is offering
                        to come is the worst thing this surface could do
                        (ADR 0011). */}
                    <WhatIsMissing shift={shift} within={soon(shift)} />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        void act(() => client.post('/shifts/cover', { shiftId: shift.id }))
                      }}
                    >
                      Cover this
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  )
}
