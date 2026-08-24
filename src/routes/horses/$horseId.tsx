/**
 * One horse's profile — a phone's read of the record: Alerts before anything
 * else is worked with (#32), then the descriptive attributes, the Space
 * assignments, the current feeding per Shift Type, and the weight and
 * body-condition series (#36).
 *
 * Alerts come first and in full text (ADR 0024, #60) — standing ones above
 * everything, and the ended ones at the foot as history, because the record
 * must not lose *it used to bite and we stopped saying so*. A Departed horse
 * keeps its own standing: it is gone rather than cured.
 *
 * This screen reads them and never writes one. Raising, editing and ending are
 * `horse_care`'s own acts, at the desk (`src/routes/admin/horses.tsx`).
 *
 * The first parameterised endpoint the typed client calls (ADR 0021).
 */
import { Link, createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Field, Fields, Loading } from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { ALERT_KIND_LABEL, type AlertKind } from '../../shared/alerts'
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

/**
 * One tint per kind, the same map every surface reads (ADR 0024) — never a
 * kind said by colour alone: the uppercase kind word rides with each.
 */
const KIND_TINT: Record<AlertKind, string> = {
  prohibition: 'border-l-destructive bg-card-tint-rose dark:bg-transparent',
  care: 'border-l-warning bg-card-tint-peach dark:bg-transparent',
  allergy: 'border-l-brand-purple bg-card-tint-lavender dark:bg-transparent',
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
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
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
      <Link to="/horses" className="text-sm">
        Back to horses
      </Link>
      <h1>{horse.name}</h1>
      <h2>Alerts</h2>
      {horse.alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts recorded.</p>
      ) : (
        <ul className="m-0 mb-4 grid list-none gap-2 p-0">
          {horse.alerts.map((alert) => (
            <li
              key={alert.id}
              className={`m-0 rounded-md border border-border border-l-4 px-3 py-2 text-base ${KIND_TINT[alert.kind]}`}
            >
              <strong className="mr-1 text-[13px] uppercase tracking-wide">
                {ALERT_KIND_LABEL[alert.kind]}
              </strong>{' '}
              {alert.text}
            </li>
          ))}
        </ul>
      )}

      {horse.departedOn !== null && (
        <p
          role="status"
          className="mb-3 rounded-md border border-border bg-secondary px-4 py-3 text-sm"
        >
          Departed {horse.departedOn}
        </p>
      )}

      {horse.photoUrl !== null && (
        <img src={horse.photoUrl} alt={horse.name} width={320} className="mb-4 rounded-lg" />
      )}

      <h2>Attributes</h2>
      <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
        <ul className="m-0 list-none p-0">
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Halter colour: {horse.halterColour ?? 'not recorded'}
          </li>
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Blanket size: {horse.blanketSize ?? 'not recorded'}
          </li>
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Height: {horse.height ?? 'not recorded'}
          </li>
        </ul>
      </section>

      <h2>Space assignments</h2>
      <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
        <ul className="m-0 list-none p-0">
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Stall: {horse.spaces.stall?.name ?? 'not assigned'}
          </li>
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Pasture: {horse.spaces.pasture?.name ?? 'not assigned'}
          </li>
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Paddock: {horse.spaces.paddock?.name ?? 'not assigned'}
          </li>
          <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
            Barn: {horse.spaces.barn?.name ?? 'not assigned'}
          </li>
        </ul>
      </section>

      <h2>Feeding</h2>
      {horse.feedSchedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feed schedule recorded.</p>
      ) : (
        horse.feedSchedules.map((schedule) => (
          <section
            key={schedule.shiftType}
            className="mb-2 rounded-md border border-border px-4 py-3"
          >
            <h3 className="m-0 mb-1 flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
              {SHIFT_TYPE_LABEL[schedule.shiftType]}
              {schedule.isNew && (
                <Badge variant="purple" role="status">
                  New
                </Badge>
              )}
            </h3>
            {schedule.lines.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No feeding.</p>
            ) : (
              <ul className="m-0 list-disc pl-5">
                {schedule.lines.map((line) => (
                  <li key={line.productId} className="mb-1">
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
        <p className="text-sm text-muted-foreground">No weight recorded.</p>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {horse.measurements.weights.map((entry) => (
              <li
                key={entry.id}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                {entry.value} lb{entry.method !== null && ` (${entry.method})`} — {entry.takenOn}
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>Body condition</h2>
      {horse.measurements.bodyConditions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No body condition recorded.</p>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {horse.measurements.bodyConditions.map((entry) => (
              <li
                key={entry.id}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
                {entry.value} — {entry.takenOn}
              </li>
            ))}
          </ul>
        </section>
      )}

      {horse.endedAlerts.length > 0 && (
        <>
          <h2>Alerts that have ended</h2>
          {/* Ended ones are history, and they read as history: no tint, no
              rule down the side, nothing that competes with a warning that is
              still true. */}
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-muted-foreground">
            {horse.endedAlerts.map((alert) => (
              <li key={alert.id} className="m-0">
                <strong className="mr-1 text-[13px] uppercase tracking-wide">
                  {ALERT_KIND_LABEL[alert.kind]}
                </strong>{' '}
                {alert.text}
                {/* The reason, always — the audit entry answers who and when,
                    and only this answers why it is gone (ADR 0024). */}
                <span className="text-muted-foreground"> Ended: {alert.endingReason}</span>
                {alert.endedByName !== null && <span> — {alert.endedByName}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <RecordMeasurement onRecord={recordMeasurement} />
    </main>
  )
}

/** Radix's Select cannot carry an empty-string item, so *not recorded* is a word. */
const NO_METHOD = 'none'

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
  const [method, setMethod] = useState<string>(NO_METHOD)

  return (
    <form
      className="mt-6 rounded-lg border border-border bg-background p-4 sm:p-6"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        void onRecord({
          kind,
          value: Number(data.get('value')),
          method: kind === 'weight' && method !== NO_METHOD ? (method as 'tape' | 'scale') : null,
          takenOn: String(data.get('takenOn') ?? ''),
        }).then(() => {
          form.reset()
          setMethod(NO_METHOD)
        })
      }}
    >
      <h2 className="mt-0">Record a measurement</h2>
      <Fields>
        <Field label="Kind" htmlFor="measurement-kind">
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as MeasurementKind)
            }}
          >
            <SelectTrigger id="measurement-kind" aria-label="Kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weight">Weight</SelectItem>
              <SelectItem value="body_condition">Body condition</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Value" htmlFor="measurement-value">
          <Input id="measurement-value" name="value" type="number" step="any" required />
        </Field>
        {kind === 'weight' && (
          <Field label="Method (optional)" htmlFor="measurement-method">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="measurement-method" aria-label="Method (optional)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_METHOD}>Not recorded</SelectItem>
                {MEASUREMENT_METHODS.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {choice}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Date" htmlFor="measurement-taken-on">
          <Input id="measurement-taken-on" name="takenOn" type="date" required />
        </Field>
      </Fields>
      <Actions>
        <Button type="submit">Record</Button>
      </Actions>
    </form>
  )
}

export default HorseProfile
