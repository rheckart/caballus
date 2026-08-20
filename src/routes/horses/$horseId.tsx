/**
 * One horse's profile — a phone's read of the record: Alerts before anything
 * else is worked with (#32), then the descriptive attributes, the Space
 * assignments, the current feeding per Shift Type, and the weight and
 * body-condition series (#36).
 *
 * Alerts is a heading with nothing under it yet. Nothing in this ticket
 * writes one — no medical or feed domain exists to source it from — and the
 * section is here so the place is held rather than invented as a field on the
 * horse this ticket has no way to populate.
 *
 * The first parameterised endpoint the typed client calls (ADR 0021).
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Loading } from '../../components/forms'
import { client } from '../../shared/api-client'
import { MEASUREMENT_METHODS, type MeasurementKind } from '../../shared/measurements'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import { dayString } from '../../shared/time'

export const Route = createFileRoute('/horses/$horseId')({
  component: HorseProfile,
})

type Horse = Answers<typeof contract, '/horses/:horseId'>
type FeedSchedule = Horse['feedSchedules'][number]

const SHIFT_TYPE_LABEL: Record<FeedSchedule['shiftType'], string> = {
  feed_am: 'Feed AM',
  feed_pm: 'Feed PM',
  lunch: 'Lunch',
}

const ROUTE_LABEL: Record<FeedSchedule['lines'][number]['route'], string> = {
  in_feed: 'in feed',
  oral_syringe: 'oral syringe',
  topical: 'topical',
  other: 'other',
}

function HorseProfile() {
  // `strict: false` rather than `Route.useParams()`: the route that supplies
  // `horseId` is whichever one matched, and a component test renders this
  // component under a harness route rather than this file's own.
  const { horseId } = useParams({ strict: false })
  const [horse, setHorse] = useState<Horse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (horseId === undefined) return
    setHorse(await client.get('/horses/:horseId', { horseId }))
  }, [horseId])

  useEffect(() => {
    let current = true
    load().catch((error: unknown) => {
      if (current) setProblem(refusalText(error))
    })
    return () => {
      current = false
    }
  }, [load])

  const recordMeasurement = useCallback(
    async (about: {
      kind: MeasurementKind
      value: number
      method: 'tape' | 'scale' | null
      takenOn: string
    }) => {
      if (horseId === undefined) return
      setProblem(null)
      try {
        await client.post('/measurements', {
          horseId,
          kind: about.kind,
          value: about.value,
          method: about.method,
          takenOn: dayString(about.takenOn),
        })
        await load()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [horseId, load],
  )

  if (problem !== null) {
    return (
      <main>
        <p role="alert">{problem}</p>
        <Link to="/horses">Back to horses</Link>
      </main>
    )
  }

  if (horse === null) {
    return (
      <main>
        <Loading what="the horse" />
      </main>
    )
  }

  return (
    <main>
      <Link to="/horses">Back to horses</Link>
      <h1>{horse.name}</h1>
      {horse.departedOn !== null && <p role="status">Departed {horse.departedOn}</p>}

      {horse.photoUrl !== null && <img src={horse.photoUrl} alt={horse.name} width={320} />}

      <h2>Alerts</h2>
      <p>No alerts recorded.</p>

      <h2>Attributes</h2>
      <ul>
        <li>Halter colour: {horse.halterColour ?? 'not recorded'}</li>
        <li>Blanket size: {horse.blanketSize ?? 'not recorded'}</li>
        <li>Height: {horse.height ?? 'not recorded'}</li>
      </ul>

      <h2>Space assignments</h2>
      <ul>
        <li>Stall: {horse.spaces.stall?.name ?? 'not assigned'}</li>
        <li>Pasture: {horse.spaces.pasture?.name ?? 'not assigned'}</li>
        <li>Paddock: {horse.spaces.paddock?.name ?? 'not assigned'}</li>
        <li>Barn: {horse.spaces.barn?.name ?? 'not assigned'}</li>
      </ul>

      <h2>Feeding</h2>
      {horse.feedSchedules.length === 0 ? (
        <p>No feed schedule recorded.</p>
      ) : (
        horse.feedSchedules.map((schedule) => (
          <section key={schedule.shiftType}>
            <h3>
              {SHIFT_TYPE_LABEL[schedule.shiftType]}
              {schedule.isNew && <span role="status"> New</span>}
            </h3>
            {schedule.lines.length === 0 ? (
              <p>No feeding.</p>
            ) : (
              <ul>
                {schedule.lines.map((line) => (
                  <li key={line.productId}>
                    {line.amount} of {line.productName} — {ROUTE_LABEL[line.route]}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}

      <h2>Weight</h2>
      {horse.measurements.weights.length === 0 ? (
        <p>No weight recorded.</p>
      ) : (
        <ul>
          {horse.measurements.weights.map((entry) => (
            <li key={entry.id}>
              {entry.value} lb{entry.method !== null && ` (${entry.method})`} — {entry.takenOn}
            </li>
          ))}
        </ul>
      )}

      <h2>Body condition</h2>
      {horse.measurements.bodyConditions.length === 0 ? (
        <p>No body condition recorded.</p>
      ) : (
        <ul>
          {horse.measurements.bodyConditions.map((entry) => (
            <li key={entry.id}>
              {entry.value} — {entry.takenOn}
            </li>
          ))}
        </ul>
      )}

      <RecordMeasurement onRecord={recordMeasurement} />
    </main>
  )
}

function RecordMeasurement({
  onRecord,
}: {
  onRecord: (about: {
    kind: MeasurementKind
    value: number
    method: 'tape' | 'scale' | null
    takenOn: string
  }) => Promise<void>
}) {
  const [kind, setKind] = useState<MeasurementKind>('weight')

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const method = String(data.get('method') ?? '')
        void onRecord({
          kind,
          value: Number(data.get('value')),
          method: kind === 'weight' && method !== '' ? (method as 'tape' | 'scale') : null,
          takenOn: String(data.get('takenOn') ?? ''),
        }).then(() => {
          form.reset()
        })
      }}
    >
      <h2>Record a measurement</h2>
      <label htmlFor="measurement-kind">Kind</label>
      <select
        id="measurement-kind"
        name="kind"
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as MeasurementKind)
        }}
      >
        <option value="weight">Weight</option>
        <option value="body_condition">Body condition</option>
      </select>
      <label htmlFor="measurement-value">Value</label>
      <input id="measurement-value" name="value" type="number" step="any" required />
      {kind === 'weight' && (
        <>
          <label htmlFor="measurement-method">Method (optional)</label>
          <select id="measurement-method" name="method" defaultValue="">
            <option value="">Not recorded</option>
            {MEASUREMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="measurement-taken-on">Date</label>
      <input id="measurement-taken-on" name="takenOn" type="date" required />
      <button type="submit">Record</button>
    </form>
  )
}

export default HorseProfile
