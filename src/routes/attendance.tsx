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
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../shared/api-client'
import { VISIT_CATEGORIES, type AttendanceCategory } from '../shared/attendance'
import { refusalText } from '../shared/refusals'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/attendance')({
  component: VisitAttendance,
})

type People = Answers<typeof contract, '/volunteers'>
type Me = Answers<typeof contract, '/me'>

const CATEGORY_LABEL: Record<AttendanceCategory, string> = {
  shift: 'Feed shift',
  maintenance: 'Maintenance and grounds',
  event: 'Event',
  fundraising: 'Fundraising',
  administrative: 'Administrative',
  other: 'Other',
}

function VisitAttendance() {
  const [people, setPeople] = useState<People | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    Promise.all([client.get('/volunteers'), client.get('/me')])
      .then(([listed, who]) => {
        if (current) {
          setPeople(listed)
          setMe(who)
        }
      })
      .catch((error: unknown) => {
        if (current) setProblem(refusalText(error))
      })
    return () => {
      current = false
    }
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

  if (people === null || me === null) {
    return (
      <main>
        <h1>Visit</h1>
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  // Present, not just rostered: a Visit is for anybody at the rescue today,
  // and every Volunteer is on the floor's own list (ADR 0010).
  const everyone = people.people.filter((person) => person.state === 'volunteer')

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
          void act(
            () =>
              client.post('/attendance/sign-in', {
                volunteerId,
                description,
                category: category as AttendanceCategory,
              }),
            'Signed in.',
          ).then(() => {
            form.reset()
          })
        }}
      >
        <h2>Sign in</h2>
        <label htmlFor="sign-in-who">Who</label>
        <select id="sign-in-who" name="volunteerId" defaultValue={me.volunteerId}>
          <option value={me.volunteerId}>Me — {me.name}</option>
          {everyone
            .filter((person) => person.id !== me.volunteerId)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
        </select>
        <label htmlFor="sign-in-description">What are you here to do?</label>
        <input id="sign-in-description" name="description" required maxLength={1000} />
        <label htmlFor="sign-in-category">Category</label>
        <select id="sign-in-category" name="category" defaultValue="other">
          {VISIT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const volunteerId = String(data.get('volunteerId') ?? me.volunteerId)
          void act(
            () => client.post('/attendance/sign-out', { volunteerId }),
            'Signed out.',
          ).then(() => {
            form.reset()
          })
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
