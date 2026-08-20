/**
 * The schedule, from the desk: the recurring commitments, who is normally on
 * them, and the fortnight they have generated (`CONTEXT.md`'s Shift Pattern;
 * ADR 0001).
 *
 * **The apply-to-upcoming prompt is a real question, asked every time.** ADR
 * 0001 is explicit that it is not optional polish: a Coordinator who moves
 * somebody to Tuesdays and is never asked will find next Tuesday still showing
 * the old roster. So every edit here carries the answer, and the screen says
 * which way it went.
 *
 * **Generation is a button.** It must never run at boot and there is no
 * scheduler yet, so the hand that fills the horizon is the Coordinator's, and
 * pressing it twice is safe by construction.
 *
 * **A gate is shown, never enforced by hiding.** Somebody who cannot be
 * assigned still appears in the list with the reason against their name — the
 * server refuses, and a person can see why rather than wondering where a name
 * went (ADR 0017).
 *
 * **The fortnight is where a Coordinator sees what is missing**, across the
 * whole generation horizon rather than the next 48 hours, because #7 needs
 * *will this Shift have Medication Authority present* answerable while a roster
 * is being built a fortnight out (ADR 0011). Each Shift says the concrete fact —
 * *no Lead*, *nobody who can give medication* — and never the phrase *staffing
 * gap*, which is an internal term.
 *
 * **Short is one button and it is a person's**, declared and cleared from here
 * or from the Shift itself. The arithmetic beside it never sets it and never
 * takes it away: a Shift can sit marked Short after enough people have Covered,
 * because the human who declared it already weighed who might turn up.
 *
 * **The digest is a button for the same reason generation is.** It must never be
 * an in-process interval pretending to be durable, and until there is a
 * scheduler the hand that sends it is a person's.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Choice, Empty, Field, Fields, Loading } from '../../components/forms'
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import {
  ASSIGNABLE_POSITIONS,
  WEEKDAYS,
  type AssignablePosition,
  type Weekday,
} from '../../shared/shifts'
import { SHIFT_TYPES, type ShiftType } from '../../shared/feed-schedule'
import type { RosterGap } from '../../shared/rostering'
import { staffingFacts } from '../../shared/staffing'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/shift-patterns')({
  component: ShiftPatterns,
})

type PatternList = Answers<typeof contract, '/shift-patterns'>
type Pattern = PatternList['patterns'][number]
type ScheduleList = Answers<typeof contract, '/shifts'>
type Shift = ScheduleList['shifts'][number]
type People = Answers<typeof contract, '/volunteers'>

const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

const SHIFT_TYPE_LABEL: Record<ShiftType | 'pop_up', string> = {
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

const GAP_LABEL: Record<RosterGap, string> = {
  no_orientation: 'no orientation',
  no_current_release: 'no current release',
  no_consent: 'no parental consent',
}

function ShiftPatterns() {
  const [patterns, setPatterns] = useState<PatternList | null>(null)
  const [schedule, setSchedule] = useState<ScheduleList | null>(null)
  const [people, setPeople] = useState<People | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [listedPatterns, listedShifts, listedPeople] = await Promise.all([
      client.get('/shift-patterns'),
      client.get('/shifts'),
      client.get('/volunteers'),
    ])
    setPatterns(listedPatterns)
    setSchedule(listedShifts)
    setPeople(listedPeople)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  const act = useCallback(
    async (
      work: () => Promise<unknown>,
      saying?: (answer: unknown) => string,
    ): Promise<boolean> => {
      setProblem(null)
      setSaid(null)
      setBusy(true)
      try {
        const answer = await work()
        if (saying !== undefined) setSaid(saying(answer))
        await load()
        return true
      } catch (error: unknown) {
        setProblem(refusalText(error))
        return false
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  if (patterns === null || schedule === null) {
    return (
      <main>
        <h1>Shifts</h1>
        {problem === null ? <Loading what="the fortnight" /> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  return (
    <main>
      <h1>Shifts</h1>

      {problem !== null && <p role="alert">{problem}</p>}
      {said !== null && <p role="status">{said}</p>}

      <section>
        <h2>The fortnight</h2>
        <p>
          Shifts are generated two weeks ahead, copying each Pattern’s roster and start time as they
          stand at that moment. Running this twice creates nothing twice.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void act(
              () => client.post('/shifts/generation', {}),
              (answer) => {
                const { created, through } = answer as { created: number; through: string }
                return created === 0
                  ? `Nothing to generate; the horizon is full through ${through}.`
                  : `Generated ${String(created)} Shift${created === 1 ? '' : 's'} through ${through}.`
              },
            )
          }}
        >
          Generate the horizon
        </button>

        {/* The one thing the app sends about staffing, on a deliberate press.
            The counts come back so a send that failed is visible rather than
            assumed — with email as the only channel, a swallowed failure is a
            Coordinator who thinks the roster was told (ADR 0009, ADR 0011). */}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void act(
              () => client.post('/shifts/digest', {}),
              (answer) => {
                const { recipients, sent, shifts } = answer as {
                  recipients: number
                  sent: number
                  shifts: number
                }
                return `Sent to ${String(sent)} of ${String(recipients)}, covering ${String(shifts)} shift${shifts === 1 ? '' : 's'}.`
              },
            )
          }}
        >
          Send the evening digest
        </button>

        {schedule.shifts.length === 0 ? (
          <p>No Shifts yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Shift</th>
                <th scope="col">Starts</th>
                <th scope="col">On it</th>
                <th scope="col">Missing</th>
              </tr>
            </thead>
            <tbody>
              {schedule.shifts.map((shift) => (
                <tr key={shift.id}>
                  <th scope="row">{shift.day}</th>
                  <td>
                    {SHIFT_TYPE_LABEL[shift.shiftType]}
                    {shift.staffingMode === 'sign_up' && <em> — open to sign-up</em>}
                    {shift.purpose !== null && <span> — {shift.purpose}</span>}
                  </td>
                  <td>{shift.startTime}</td>
                  <td>
                    {shift.roster.filter((member) => member.endedAs === null).length === 0 ? (
                      // Nobody at all, said out loud: a Shift nobody can staff
                      // is still a Shift and still needs doing (ADR 0001).
                      <em>nobody yet</em>
                    ) : (
                      <ul>
                        {shift.roster.map((member) => (
                          <li key={member.volunteerId}>
                            {member.name} — {POSITION_LABEL[member.position]}
                            {member.origin === 'cover' && <span> (covering)</span>}
                            {member.endedAs !== null && (
                              <em>
                                {' '}
                                — {member.endedAs}
                                {member.endedReason !== null && `: ${member.endedReason}`}
                              </em>
                            )}
                            {member.endedAs === null && member.gaps.length > 0 && (
                              <strong>
                                {' '}
                                — {member.gaps.map((gap) => GAP_LABEL[gap]).join(', ')}
                              </strong>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    <WhatIsMissing shift={shift} />
                    {/* Declaring and clearing are the same judgement pointed
                        two ways, so one button whose label changes. Never
                        disabled by the arithmetic beside it: Short is fewer
                        people than the Essential Work needs, and the app does
                        not know what that is (ADR 0011). */}
                    <button
                      type="button"
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
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>A Pop-up</h2>
        <p>An ad-hoc Shift, staffed by sign-up: hosing horses down in heat, a welfare check.</p>
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/shifts', {
                day: data.get('day') as PatternList['today'],
                startTime: String(data.get('startTime') ?? ''),
                targetHeadcount: Number(data.get('targetHeadcount') ?? ''),
                purpose: String(data.get('purpose') ?? ''),
              }),
            ).then((landed) => {
              if (landed) form.reset()
            })
          }}
        >
          <Fields>
            <Field label="Day" htmlFor="popup-day">
              <input id="popup-day" name="day" type="date" required defaultValue={patterns.today} />
            </Field>
            <Field label="Starts" htmlFor="popup-start">
              <input id="popup-start" name="startTime" type="time" required defaultValue="13:00" />
            </Field>
            <Field label="People wanted" htmlFor="popup-headcount">
              <input
                id="popup-headcount"
                name="targetHeadcount"
                type="number"
                inputMode="numeric"
                min="1"
                required
                defaultValue="2"
              />
            </Field>
            <div className="field-wide">
              <Field
                label="What it is for"
                htmlFor="popup-purpose"
                hint="This is what a volunteer reads when deciding to sign up."
              >
                <input
                  id="popup-purpose"
                  name="purpose"
                  required
                  maxLength={500}
                  aria-describedby="popup-purpose-hint"
                />
              </Field>
            </div>
          </Fields>
          <Actions>
            <button type="submit">Call a Pop-up</button>
          </Actions>
        </form>
      </section>

      <section>
        <h2>The Patterns</h2>
        {patterns.patterns.length === 0 && (
          <Empty>
            No Patterns yet. A Pattern is the recurring commitment the fortnight is filled from.
          </Empty>
        )}
        {patterns.patterns.map((pattern) => (
          <PatternCard key={pattern.id} pattern={pattern} people={people} act={act} />
        ))}

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/shift-patterns', {
                weekday: data.get('weekday') as Weekday,
                shiftType: data.get('shiftType') as ShiftType,
                startTime: String(data.get('startTime') ?? ''),
                targetHeadcount: Number(data.get('targetHeadcount') ?? ''),
              }),
            ).then((landed) => {
              if (landed) form.reset()
            })
          }}
        >
          <h3>Add a Pattern</h3>
          <Fields>
            <Field label="Day of the week" htmlFor="new-weekday">
              <select id="new-weekday" name="weekday" defaultValue="monday">
                {WEEKDAYS.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {WEEKDAY_LABEL[weekday]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts" htmlFor="new-start">
              <input id="new-start" name="startTime" type="time" required defaultValue="06:30" />
            </Field>
            <div className="field-wide">
              <Choice
                legend="Shift"
                name="shiftType"
                defaultValue="feed_am"
                options={SHIFT_TYPES.map((shiftType) => ({
                  value: shiftType,
                  label: SHIFT_TYPE_LABEL[shiftType],
                }))}
              />
            </div>
            <Field label="People wanted" htmlFor="new-headcount">
              <input
                id="new-headcount"
                name="targetHeadcount"
                type="number"
                inputMode="numeric"
                min="1"
                required
                defaultValue="3"
              />
            </Field>
          </Fields>
          <Actions>
            <button type="submit">Add</button>
          </Actions>
        </form>
      </section>
    </main>
  )
}

/**
 * What a Shift is missing, in words — `staffingFacts`, the same derivation the
 * phone and the digest read, so the desk and the barn cannot describe Thursday
 * differently.
 *
 * The desk sees the whole fortnight, with no proximity rule: ADR 0011 computes
 * the gaps "across the full two-week generation horizon for holders of
 * `roster`", because #7 needs *will this Shift have Medication Authority
 * present* answerable while a roster is being built a fortnight out. The
 * phone's 48-hour window is the other half of that same sentence.
 */
function WhatIsMissing({ shift }: { shift: Shift }) {
  const facts = staffingFacts(shift)

  return (
    <>
      {facts.length === 0 ? <span>nothing</span> : <strong>{facts.join(', ')}</strong>}
      {/* A person's call, said as one. The app neither declares Short nor
          withdraws it, and a Coordinator reading this row needs to know which
          of the two things on it a human decided (ADR 0011). */}
      {shift.short !== null && <em> — called short by a person</em>}
    </>
  )
}

function PatternCard({
  pattern,
  people,
  act,
}: {
  pattern: Pattern
  people: People | null
  act: (work: () => Promise<unknown>, saying?: (answer: unknown) => string) => Promise<boolean>
}) {
  const scheduled = (answer: unknown) => {
    const { scheduledTouched, leadHeldOn = 0 } = answer as {
      scheduledTouched: number
      leadHeldOn?: number
    }
    const changed =
      scheduledTouched === 0
        ? 'Changed the Pattern. The Shifts already scheduled keep what they were generated with.'
        : `Changed the Pattern, and ${String(scheduledTouched)} scheduled Shift${
            scheduledTouched === 1 ? '' : 's'
          }.`
    // At most one Lead per Shift (ADR 0010), so this is the case where a
    // Pattern change deliberately did not reach a Shift — said out loud rather
    // than left as a number that quietly did not add up.
    return leadHeldOn === 0
      ? changed
      : `${changed} ${String(leadHeldOn)} already ${
          leadHeldOn === 1 ? 'has' : 'have'
        } a Lead and were left alone.`
  }

  const onIt = new Set(pattern.roster.map((member) => member.volunteerId))

  return (
    <article>
      <h3>
        {WEEKDAY_LABEL[pattern.weekday]} {SHIFT_TYPE_LABEL[pattern.shiftType]} at{' '}
        {pattern.startTime}
        {pattern.retired && <em> — retired</em>}
      </h3>
      <p>
        {pattern.targetHeadcount} people wanted.{' '}
        <button
          type="button"
          onClick={() => {
            void act(() =>
              client.post('/shift-patterns/retirement', {
                shiftPatternId: pattern.id,
                retired: !pattern.retired,
              }),
            )
          }}
        >
          {pattern.retired ? 'Bring it back' : 'Retire it'}
        </button>
      </p>
      {pattern.retired && (
        <p>
          <em>
            Generating nothing from here on. The Shifts it already made still stand — take them one
            at a time if they should not happen.
          </em>
        </p>
      )}

      <ul className="grants">
        {pattern.roster.length === 0 && (
          <li>
            <em>Nobody on the standing roster.</em>
          </li>
        )}
        {pattern.roster.map((member) => (
          <li key={member.volunteerId} className="row">
            <span>
              {member.name} &mdash; {POSITION_LABEL[member.position]}
              {member.gaps.map((gap) => (
                <span key={gap} className="badge badge-orange">
                  {GAP_LABEL[gap]}
                </span>
              ))}
            </span>
            <button
              type="button"
              onClick={() => {
                void act(
                  () =>
                    client.post('/shift-patterns/roster-removal', {
                      shiftPatternId: pattern.id,
                      volunteerId: member.volunteerId,
                      applyToScheduled: window.confirm(
                        `Take ${member.name} off the Shifts already scheduled too?`,
                      ),
                    }),
                  scheduled,
                )
              }}
            >
              Take off
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          void act(
            () =>
              client.post('/shift-patterns/roster', {
                shiftPatternId: pattern.id,
                volunteerId: String(data.get('volunteerId') ?? ''),
                position: data.get('position') as AssignablePosition,
                // ADR 0001's prompt, asked rather than assumed. A default
                // either way would be the app deciding what the Coordinator
                // meant about next Tuesday.
                applyToScheduled: data.get('applyToScheduled') === 'on',
              }),
            scheduled,
          ).then((landed) => {
            if (landed) form.reset()
          })
        }}
      >
        <h4>Put somebody on</h4>
        <Fields>
          <Field label="Volunteer" htmlFor={`who-${pattern.id}`}>
            <select id={`who-${pattern.id}`} name="volunteerId" required defaultValue="">
              <option value="" disabled>
                Choose somebody
              </option>
              {(people?.people ?? [])
                .filter((person) => !onIt.has(person.id))
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.rosterable
                      ? ''
                      : ` — ${person.gaps.map((gap) => GAP_LABEL[gap]).join(', ')}`}
                  </option>
                ))}
            </select>
          </Field>
          <div className="field">
            <Choice
              legend="Position"
              name="position"
              defaultValue="volunteer"
              options={ASSIGNABLE_POSITIONS.map((position) => ({
                value: position,
                label: POSITION_LABEL[position],
              }))}
            />
          </div>
          <div className="field-wide">
            <label htmlFor={`apply-${pattern.id}`}>
              <input id={`apply-${pattern.id}`} name="applyToScheduled" type="checkbox" />
              Also put them on the Shifts already scheduled
            </label>
          </div>
        </Fields>
        <Actions>
          <button type="submit">Put on the standing roster</button>
        </Actions>
      </form>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          void act(
            () =>
              client.post('/shift-patterns/edit', {
                shiftPatternId: pattern.id,
                startTime: String(data.get('startTime') ?? ''),
                targetHeadcount: Number(data.get('targetHeadcount') ?? ''),
                applyToScheduled: data.get('applyToScheduled') === 'on',
              }),
            scheduled,
          )
        }}
      >
        <h4>Change it</h4>
        <Fields>
          <Field label="Starts" htmlFor={`start-${pattern.id}`}>
            <input
              id={`start-${pattern.id}`}
              name="startTime"
              type="time"
              required
              defaultValue={pattern.startTime}
            />
          </Field>
          <Field label="People wanted" htmlFor={`headcount-${pattern.id}`}>
            <input
              id={`headcount-${pattern.id}`}
              name="targetHeadcount"
              type="number"
              inputMode="numeric"
              min="1"
              required
              defaultValue={pattern.targetHeadcount}
            />
          </Field>
          {/* ADR 0001's prompt, asked rather than assumed: without it the app
              is quietly wrong in the most common editing case. */}
          <div className="field-wide">
            <label htmlFor={`apply-edit-${pattern.id}`}>
              <input id={`apply-edit-${pattern.id}`} name="applyToScheduled" type="checkbox" />
              Also change the Shifts already scheduled
            </label>
          </div>
        </Fields>
        <Actions>
          <button type="submit">Change the Pattern</button>
        </Actions>
      </form>
    </article>
  )
}
