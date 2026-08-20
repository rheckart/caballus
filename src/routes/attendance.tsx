/**
 * A Visit, on the phone: the bottom section of the sign-in sheet, replaced
 * (ADR 0012). A volunteer at the rescue doing its work on no Shift — mowing,
 * a fundraiser table, an hour of paperwork — signs in with a job in their own
 * words and a coarse category, and signs out the same way a Shift sign-in
 * does: by naming who, not by naming a row.
 *
 * **Recording for somebody else works both directions.** The picker defaults
 * to the volunteer looking at the phone, and anybody may change it to
 * somebody else — attributed to whoever taps the button, never to the person
 * named (ADR 0012).
 *
 * A Shift sign-in stays on `/shifts`, beside the roster it belongs to; this
 * screen is the one case Attendance exists for that has no Shift to be beside.
 *
 * **Observations, and a Visit's own disposition (ADR 0014).** Once you have
 * signed yourself in this session, this screen knows your open Attendance and
 * lets you record an Observation against it — free text with an optional
 * horse. "On a Visit there is no Lead, so the volunteer dispositions their
 * own Observations at sign-out": every undispositioned one is listed here
 * with its two exits, Escalate (into a Scope you hold) or noted with no
 * action, because the server refuses to close a Visit that still has one
 * undecided.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Field, Fields, Loading } from '../components/forms'
import { client } from '../shared/api-client'
import { VISIT_CATEGORIES, type AttendanceCategory } from '../shared/attendance'
import type { DomainScope } from '../shared/domain-scopes'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/attendance')({
  component: VisitAttendance,
})

type People = Answers<typeof contract, '/volunteers'>
type Me = Answers<typeof contract, '/me'>
type Horses = Answers<typeof contract, '/horses'>
type Observations = Answers<typeof contract, '/observations/:attendanceId'>
type ObservationRow = Observations['observations'][number]

const CATEGORY_LABEL: Record<AttendanceCategory, string> = {
  shift: 'Feed shift',
  maintenance: 'Maintenance and grounds',
  event: 'Event',
  fundraising: 'Fundraising',
  administrative: 'Administrative',
  other: 'Other',
}

function ObservationRowView({
  observation,
  scopesHeld,
  onDispositioned,
}: {
  observation: ObservationRow
  scopesHeld: readonly DomainScope[]
  onDispositioned: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const noteNoAction = useCallback(async () => {
    setProblem(null)
    setBusy(true)
    try {
      await client.post('/observations/note', { observationId: observation.id })
      onDispositioned()
    } catch (error: unknown) {
      setProblem(refusalText(error))
    } finally {
      setBusy(false)
    }
  }, [observation.id, onDispositioned])

  const escalate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = event.currentTarget
      const data = new FormData(form)
      const scope = String(data.get('scope') ?? '') as DomainScope
      const framing = String(data.get('framing') ?? '')
      setProblem(null)
      setBusy(true)
      try {
        await client.post('/escalations', { observationId: observation.id, scope, framing })
        onDispositioned()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [observation.id, onDispositioned],
  )

  if (observation.dispositionedAt !== null) {
    return (
      <li>
        {observation.text} —{' '}
        {observation.disposition === 'escalated' ? 'Escalated' : 'Noted, no action'}
      </li>
    )
  }

  return (
    <li>
      <p>
        {observation.text}
        {observation.subjectLabel !== null && ` (${observation.subjectLabel})`}
      </p>
      {problem !== null && <p role="alert">{problem}</p>}

      <button type="button" onClick={() => void noteNoAction()} disabled={busy}>
        Note, no action
      </button>

      {scopesHeld.length > 0 && (
        <form onSubmit={(event) => void escalate(event)}>
          <label htmlFor={`escalate-scope-${observation.id}`}>Escalate to</label>
          <select id={`escalate-scope-${observation.id}`} name="scope" defaultValue={scopesHeld[0]}>
            {scopesHeld.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
          <label htmlFor={`escalate-framing-${observation.id}`}>In your own words</label>
          <input
            id={`escalate-framing-${observation.id}`}
            name="framing"
            required
            maxLength={2000}
          />
          <button type="submit" disabled={busy}>
            Escalate
          </button>
        </form>
      )}
    </li>
  )
}

function VisitAttendance() {
  const [people, setPeople] = useState<People | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [horses, setHorses] = useState<Horses | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Known only once this session has signed the actor in themselves — the
  // Attendance a recorded Observation attaches to, and a Visit's disposition
  // gate has nothing older to look at (ADR 0014).
  const [attendanceId, setAttendanceId] = useState<string | null>(null)
  const [observations, setObservations] = useState<Observations | null>(null)

  useEffect(() => {
    let current = true
    Promise.all([client.get('/volunteers'), client.get('/me'), client.get('/horses')])
      .then(([listed, who, horseList]) => {
        if (current) {
          setPeople(listed)
          setMe(who)
          setHorses(horseList)
        }
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
  }, [])

  const reloadObservations = useCallback((id: string) => {
    client
      .get('/observations/:attendanceId', { attendanceId: id })
      .then((listed) => setObservations(listed))
      .catch((error: unknown) => setProblem(refusalText(error)))
  }, [])

  const act = useCallback(async (work: () => Promise<unknown>, said: string) => {
    setProblem(null)
    setConfirmed(null)
    setBusy(true)
    try {
      await work()
      setConfirmed(said)
    } catch (error: unknown) {
      setProblem(refusalText(error))
    } finally {
      setBusy(false)
    }
  }, [])

  if (people === null || me === null || horses === null) {
    return (
      <main>
        <h1>Visit</h1>
        {problem === null ? <Loading what="the sheet" /> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  // Present, not just rostered: a Visit is for anybody at the rescue today,
  // and every Volunteer is on the floor's own list (ADR 0010).
  const everyone = people.people.filter((person) => person.state === 'volunteer')
  const undispositioned =
    observations?.observations.filter((row) => row.dispositionedAt === null) ?? []

  return (
    <main>
      <h1>Visit</h1>
      {problem !== null && <p role="alert">{problem}</p>}
      {confirmed !== null && <p role="status">{confirmed}</p>}

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const volunteerId = String(data.get('volunteerId') ?? me.volunteerId)
          const description = String(data.get('description') ?? '')
          const category = String(data.get('category') ?? 'other')
          void act(async () => {
            const answered = await client.post('/attendance/sign-in', {
              volunteerId,
              description,
              category: category as AttendanceCategory,
            })
            // Only the actor's own sign-in gives this screen an Attendance to
            // attach an Observation to — recording on somebody else's behalf
            // is Shift Authority's own act and needs a Shift (ADR 0014).
            if (volunteerId === me.volunteerId) {
              setAttendanceId(answered.attendanceId)
              setObservations(null)
            }
          }, 'Signed in.').then(() => {
            form.reset()
          })
        }}
      >
        <h2>Sign in</h2>
        <Fields>
          <div className="field-wide">
            <Field label="What are you here to do?" htmlFor="sign-in-description">
              <input id="sign-in-description" name="description" required maxLength={1000} />
            </Field>
          </div>
          <Field label="Who" htmlFor="sign-in-who">
            <select id="sign-in-who" name="volunteerId" defaultValue={me.volunteerId}>
              <option value={me.volunteerId}>Me &mdash; {me.name}</option>
              {everyone
                .filter((person) => person.id !== me.volunteerId)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Category" htmlFor="sign-in-category">
            <select id="sign-in-category" name="category" defaultValue="other">
              {VISIT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </Field>
        </Fields>
        <Actions>
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </Actions>
      </form>

      {attendanceId !== null && (
        <section>
          <h2>Record an Observation</h2>
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const data = new FormData(form)
              const text = String(data.get('text') ?? '')
              const subjectId = String(data.get('subjectId') ?? '')
              void act(async () => {
                await client.post('/observations', {
                  text,
                  subjectKind: subjectId === '' ? null : 'horse',
                  subjectId: subjectId === '' ? null : subjectId,
                })
                reloadObservations(attendanceId)
              }, 'Recorded.').then(() => {
                form.reset()
              })
            }}
          >
            <label htmlFor="observation-text">What did you see?</label>
            <input id="observation-text" name="text" required maxLength={2000} />
            <label htmlFor="observation-subject">About a horse (optional)</label>
            <select id="observation-subject" name="subjectId" defaultValue="">
              <option value="">No horse in particular</option>
              {horses.horses.map((horse) => (
                <option key={horse.id} value={horse.id}>
                  {horse.name}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy}>
              Record
            </button>
          </form>

          {undispositioned.length > 0 && (
            <div>
              <h3>Before you sign out</h3>
              <ul>
                {undispositioned.map((observation) => (
                  <ObservationRowView
                    key={observation.id}
                    observation={observation}
                    scopesHeld={me.domainScopes}
                    onDispositioned={() => reloadObservations(attendanceId)}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const volunteerId = String(data.get('volunteerId') ?? me.volunteerId)
          void act(() => client.post('/attendance/sign-out', { volunteerId }), 'Signed out.').then(
            () => {
              form.reset()
              if (volunteerId === me.volunteerId) {
                setAttendanceId(null)
                setObservations(null)
              }
            },
          )
        }}
      >
        <h2>Sign out</h2>
        <label htmlFor="sign-out-who">Who</label>
        <select id="sign-out-who" name="volunteerId" defaultValue={me.volunteerId}>
          <option value={me.volunteerId}>Me — {me.name}</option>
          {everyone
            .filter((person) => person.id !== me.volunteerId)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
        </select>
        <button type="submit" disabled={busy}>
          Sign out
        </button>
      </form>
    </main>
  )
}
