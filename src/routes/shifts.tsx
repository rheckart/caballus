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
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import { client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import type { AssignablePosition } from '../shared/shifts'
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
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  const standing = (shift: Shift) =>
    shift.roster.find((member) => member.volunteerId === me.volunteerId && member.endedAs === null)

  const mine = schedule.shifts.filter((shift) => standing(shift) !== undefined)
  const open = schedule.shifts.filter(
    (shift) => standing(shift) === undefined && shift.staffingMode === 'sign_up',
  )

  return (
    <main>
      <h1>My shifts</h1>
      {problem !== null && <p role="alert">{problem}</p>}

      <section>
        <h2>Mine</h2>
        {mine.length === 0 ? (
          <p>You are not on any Shift in the next fortnight.</p>
        ) : (
          <ul>
            {mine.map((shift) => {
              const member = standing(shift)
              return (
                <li key={shift.id}>
                  <strong>{shift.day}</strong> — {SHIFT_TYPE_LABEL[shift.shiftType]} at{' '}
                  {shift.startTime}
                  {member !== undefined && <> — {POSITION_LABEL[member.position]}</>}
                  {shift.purpose !== null && <> — {shift.purpose}</>}
                  {shift.state === 'in_progress' && <em> — under way</em>}
                  <button
                    type="button"
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
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Open to sign-up</h2>
        {open.length === 0 ? (
          <p>Nothing is open for cover.</p>
        ) : (
          <ul>
            {open.map((shift) => (
              <li key={shift.id}>
                <strong>{shift.day}</strong> — {SHIFT_TYPE_LABEL[shift.shiftType]} at{' '}
                {shift.startTime}
                {shift.purpose !== null && <> — {shift.purpose}</>}
                <span>
                  {' '}
                  {shift.roster.filter((member) => member.endedAs === null).length} of{' '}
                  {shift.targetHeadcount} so far
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void act(() => client.post('/shifts/cover', { shiftId: shift.id }))
                  }}
                >
                  Cover this
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
