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

import { Actions, Field, Fields, Loading, WideField } from '../components/forms'
import { Refusal } from '../components/refusal'
import { Alert, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select'
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

/** Radix's Select cannot carry an empty-string item, so *no horse* is a word. */
const NO_HORSE = 'none'

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
  const [scope, setScope] = useState<DomainScope>(scopesHeld[0] ?? 'horse_care')

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
    [observation.id, onDispositioned, scope],
  )

  if (observation.dispositionedAt !== null) {
    return (
      <li className="border-b border-border py-3 text-sm text-muted-foreground first:pt-0 last:border-b-0 last:pb-0">
        {observation.text} —{' '}
        {observation.disposition === 'escalated' ? 'Escalated' : 'Noted, no action'}
      </li>
    )
  }

  return (
    <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="m-0 mb-2">
        {observation.text}
        {observation.subjectLabel !== null && ` (${observation.subjectLabel})`}
      </p>
      {problem !== null && (
        <Alert variant="destructive" className="mb-2">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <Button type="button" variant="outline" onClick={() => void noteNoAction()} disabled={busy}>
        Note, no action
      </Button>

      {scopesHeld.length > 0 && (
        <form onSubmit={(event) => void escalate(event)} className="mt-3">
          <Fields>
            <Field label="Escalate to" htmlFor={`escalate-scope-${observation.id}`}>
              <Select
                value={scope}
                onValueChange={(value) => {
                  setScope(value as DomainScope)
                }}
              >
                <SelectTrigger id={`escalate-scope-${observation.id}`} aria-label="Escalate to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopesHeld.map((held) => (
                    <SelectItem key={held} value={held}>
                      {held}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="In your own words" htmlFor={`escalate-framing-${observation.id}`}>
              <Input
                id={`escalate-framing-${observation.id}`}
                name="framing"
                required
                maxLength={2000}
              />
            </Field>
          </Fields>
          <div className="mt-3">
            <Button type="submit" disabled={busy}>
              Escalate
            </Button>
          </div>
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

  // The pickers' own state, since a Radix Select posts nothing to FormData:
  // null means the volunteer looking at the phone, the picker's default.
  const [signInWho, setSignInWho] = useState<string | null>(null)
  const [signInCategory, setSignInCategory] = useState<AttendanceCategory>('other')
  const [signOutWho, setSignOutWho] = useState<string | null>(null)
  const [subjectId, setSubjectId] = useState<string>(NO_HORSE)

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
        {problem === null ? (
          <Loading what="the sheet" />
        ) : (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>
              <Refusal>{problem}</Refusal>
            </AlertTitle>
          </Alert>
        )}
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
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}
      {confirmed !== null && (
        <p
          role="status"
          className="mb-3 rounded-md border border-border bg-secondary px-4 py-3 text-sm"
        >
          {confirmed}
        </p>
      )}

      <form
        className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const volunteerId = signInWho ?? me.volunteerId
          const description = String(data.get('description') ?? '')
          const category = signInCategory
          void act(async () => {
            const answered = await client.post('/attendance/sign-in', {
              volunteerId,
              description,
              category,
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
            setSignInWho(null)
            setSignInCategory('other')
          })
        }}
      >
        <h2 className="mt-0">Sign in</h2>
        <Fields>
          <WideField label="What are you here to do?" htmlFor="sign-in-description">
            <Input id="sign-in-description" name="description" required maxLength={1000} />
          </WideField>
          <Field label="Who" htmlFor="sign-in-who">
            <Select value={signInWho ?? me.volunteerId} onValueChange={setSignInWho}>
              <SelectTrigger id="sign-in-who" aria-label="Who">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={me.volunteerId}>Me — {me.name}</SelectItem>
                {everyone
                  .filter((person) => person.id !== me.volunteerId)
                  .map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category" htmlFor="sign-in-category">
            <Select
              value={signInCategory}
              onValueChange={(value) => {
                setSignInCategory(value as AttendanceCategory)
              }}
            >
              <SelectTrigger id="sign-in-category" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIT_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {CATEGORY_LABEL[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Fields>
        <Actions>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </Actions>
      </form>

      {attendanceId !== null && (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <h2 className="mt-0">Record an Observation</h2>
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const data = new FormData(form)
              const text = String(data.get('text') ?? '')
              const subject = subjectId === NO_HORSE ? null : subjectId
              void act(async () => {
                await client.post('/observations', {
                  text,
                  subjectKind: subject === null ? null : 'horse',
                  subjectId: subject,
                })
                reloadObservations(attendanceId)
              }, 'Recorded.').then(() => {
                form.reset()
                setSubjectId(NO_HORSE)
              })
            }}
          >
            <Fields>
              <WideField label="What did you see?" htmlFor="observation-text">
                <Input id="observation-text" name="text" required maxLength={2000} />
              </WideField>
              <Field label="About a horse (optional)" htmlFor="observation-subject">
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger id="observation-subject" aria-label="About a horse (optional)">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_HORSE}>No horse in particular</SelectItem>
                    {horses.horses.map((horse) => (
                      <SelectItem key={horse.id} value={horse.id}>
                        {horse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </Fields>
            <Actions>
              <Button type="submit" disabled={busy}>
                Record
              </Button>
            </Actions>
          </form>

          {undispositioned.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="mt-0">Before you sign out</h3>
              <ul className="m-0 list-none p-0">
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
        className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const volunteerId = signOutWho ?? me.volunteerId
          void act(() => client.post('/attendance/sign-out', { volunteerId }), 'Signed out.').then(
            () => {
              form.reset()
              setSignOutWho(null)
              if (volunteerId === me.volunteerId) {
                setAttendanceId(null)
                setObservations(null)
              }
            },
          )
        }}
      >
        <h2 className="mt-0">Sign out</h2>
        <Fields>
          <Field label="Who" htmlFor="sign-out-who">
            <Select value={signOutWho ?? me.volunteerId} onValueChange={setSignOutWho}>
              <SelectTrigger id="sign-out-who" aria-label="Who">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={me.volunteerId}>Me — {me.name}</SelectItem>
                {everyone
                  .filter((person) => person.id !== me.volunteerId)
                  .map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        </Fields>
        <Actions>
          <Button type="submit" disabled={busy}>
            Sign out
          </Button>
        </Actions>
      </form>
    </main>
  )
}
