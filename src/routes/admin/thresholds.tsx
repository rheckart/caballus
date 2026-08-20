/**
 * The numbers: the rescue's default Thresholds and the horses that hold their
 * own (ADR 0015; `CONTEXT.md`'s Threshold).
 *
 * **Three states, and the third one is the point.** A horse is on its own
 * number, deliberately on the rescue's, or **not yet decided** — and this
 * screen says the third out loud, as a question somebody owes an answer to,
 * rather than rendering it as agreement with the default. A new intake with no
 * thresholds set gets its sheet from the default at 38 °, and the screen is
 * where the fact that nobody decided stays visible (ADR 0015, ADR 0013).
 *
 * **An edit is a version.** There is no delete and nothing here updates a row:
 * publishing a new number supersedes the old one on its valid-from day, and
 * *what was her sheet number in January* stays answerable (ADR 0003).
 *
 * The metric is not on any form. Cold is air temperature and heat is real
 * feel, the kind already knows which, and a field asking a volunteer to
 * restate it is the one field that could silently re-calibrate every horse in
 * the barn (#6).
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Actions, Empty, Field, Fields, SaveButton, Saved, useSaving } from '../../components/forms'
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import {
  PER_HORSE_THRESHOLD_KINDS,
  THRESHOLD_KINDS,
  THRESHOLD_SPECS,
  type ThresholdKind,
} from '../../shared/weather'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/thresholds')({
  component: Thresholds,
})

type ThresholdList = Answers<typeof contract, '/thresholds'>
type HorseThresholds = ThresholdList['horses'][number]
type ThresholdRecord = ThresholdList['defaults'][number]

const KIND_LABEL: Record<ThresholdKind, string> = {
  sheet: 'Sheet weather, under',
  blanket: 'Blanket weather, under',
  staying_in: 'Staying in, real feel at',
  fly_sheet_max: 'Fly sheet weather, real feel up to',
  cold_and_wet: 'Cold and wet, under',
}

const METRIC_LABEL: Record<ThresholdRecord['metric'], string> = {
  air_temp: 'air temperature',
  apparent_temp: 'real feel',
  temp_plus_humidity_sum: 'temperature plus humidity',
  wbgt: 'wet bulb globe temperature',
}

function Thresholds() {
  const [listed, setListed] = useState<ThresholdList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setListed(await client.get('/thresholds'))
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  /**
   * Does the work and says whether it landed.
   *
   * The answer matters: a form that resets on a refusal throws away what
   * somebody just typed and makes them enter it again to retry, which is the
   * app punishing them for its own 409.
   */
  const act = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      setProblem(null)
      try {
        await work()
        await load()
        return true
      } catch (error: unknown) {
        setProblem(refusalText(error))
        return false
      }
    },
    [load],
  )

  if (listed === null) {
    return (
      <main>
        <h1>Thresholds</h1>
        {problem === null ? <p>One moment…</p> : <p role="alert">{problem}</p>}
      </main>
    )
  }

  const owed = listed.horses.filter((horse) => horse.undecided.length > 0)
  const byKind = new Map(listed.defaults.map((record) => [record.kind, record]))

  return (
    <main>
      <h1>Thresholds</h1>
      <p className="lede">
        The temperatures the weather rules turn at. An edit publishes a new version; the old one
        stays, so what a horse’s number was in January is still answerable.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <section>
        <h2>The rescue’s numbers</h2>
        <p>What every horse follows unless somebody decided otherwise for it.</p>
        <ul>
          {THRESHOLD_KINDS.map((kind) => {
            const record = byKind.get(kind)
            return (
              <li key={kind}>
                {KIND_LABEL[kind]}{' '}
                {record === undefined ? (
                  // Never a zero and never a blank: a number nobody has set is
                  // a question, and the rules that need it cannot be resolved.
                  <em>not set — the rules that use it cannot be answered</em>
                ) : (
                  <>
                    <strong>{record.value}°F</strong> ({METRIC_LABEL[record.metric]}, as{' '}
                    {record.provider === 'open_meteo'
                      ? 'Open-Meteo'
                      : 'the National Weather Service'}{' '}
                    reads it, since {record.validFrom}){record.isNew && <span> — New</span>}
                  </>
                )}
              </li>
            )
          })}
        </ul>

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/thresholds', {
                horseId: null,
                kind: data.get('kind') as ThresholdKind,
                stance: 'overridden',
                value: Number(data.get('value') ?? ''),
                validFrom: listed.today,
              }),
            ).then((landed) => {
              if (landed) form.reset()
            })
          }}
        >
          <h3>Set one of the rescue’s numbers</h3>
          <Fields>
            <Field label="Which" htmlFor="default-kind">
              <select id="default-kind" name="kind" defaultValue="sheet">
                {THRESHOLD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Degrees Fahrenheit" htmlFor="default-value">
              <input
                id="default-value"
                name="value"
                type="number"
                inputMode="numeric"
                required
                step="1"
              />
            </Field>
          </Fields>
          <Actions>
            <button type="submit">Publish</button>
          </Actions>
        </form>
      </section>

      <section>
        <h2>Today’s weather</h2>
        <p>
          Fetches the forecast and works out what it means for today — what the Board shows, and
          what a Shift’s list will be fixed against. It becomes the daily job’s first step the day
          there is a daily job; until then it is this button.
        </p>
        <button
          type="button"
          onClick={() => {
            void act(() => client.post('/weather/readings', {}))
          }}
        >
          Read today’s weather
        </button>
      </section>

      <section>
        <h2>Decisions owed</h2>
        {owed.length === 0 ? (
          <p className="field-hint">
            Every horse has a sheet and a blanket number, or has been put on the rescue’s.
          </p>
        ) : (
          <ul className="owed-list">
            {owed.map((horse) => (
              <li key={horse.horseId}>
                {horse.horseName} —{' '}
                {horse.undecided.map((kind) => KIND_LABEL[kind].toLowerCase()).join(' and ')}{' '}
                <em>not yet decided</em>; the rescue’s number is being used meanwhile.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Each horse</h2>
        {listed.horses.length === 0 && <Empty>No horses yet.</Empty>}
        {listed.horses.map((horse) => (
          <Horse key={horse.horseId} horse={horse} today={listed.today} act={act} />
        ))}
      </section>
    </main>
  )
}

function Horse({
  horse,
  today,
  act,
}: {
  horse: HorseThresholds
  today: ThresholdList['today']
  act: (work: () => Promise<unknown>) => Promise<boolean>
}) {
  const held = new Map(horse.records.map((record) => [record.kind, record]))
  const { pending, saved, save } = useSaving()

  return (
    <article>
      <h3>{horse.horseName}</h3>
      <ul>
        {PER_HORSE_THRESHOLD_KINDS.map((kind) => {
          const record = held.get(kind)
          return (
            <li key={kind}>
              {KIND_LABEL[kind]}:{' '}
              {record === undefined ? (
                <em>not yet decided</em>
              ) : record.stance === 'follows_default' ? (
                <>the rescue’s number, deliberately (since {record.validFrom})</>
              ) : (
                <>
                  <strong>{record.value}°F</strong>, its own (since {record.validFrom})
                </>
              )}
              {record?.isNew === true && <span> — New</span>}
            </li>
          )
        })}
      </ul>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const stance = data.get('stance') === 'follows_default' ? 'follows_default' : 'overridden'
          const value = String(data.get('value') ?? '')
          void save(() =>
            act(() =>
              client.post('/thresholds', {
                horseId: horse.horseId,
                kind: data.get('kind') as ThresholdKind,
                stance,
                // A horse deliberately on the rescue's number carries none of its
                // own: one copied here would stop moving when the default did.
                value: stance === 'follows_default' || value === '' ? null : Number(value),
                validFrom: today,
              }),
            ).then((landed) => {
              if (landed) form.reset()
            }),
          )
        }}
      >
        <Fields>
          <Field label="Which" htmlFor={`kind-${horse.horseId}`}>
            <select id={`kind-${horse.horseId}`} name="kind" defaultValue="sheet">
              {PER_HORSE_THRESHOLD_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]} ({METRIC_LABEL[THRESHOLD_SPECS[kind].metric]})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Degrees Fahrenheit"
            htmlFor={`value-${horse.horseId}`}
            hint="Left blank when this horse follows the rescue’s number."
          >
            <input
              id={`value-${horse.horseId}`}
              name="value"
              type="number"
              inputMode="numeric"
              step="1"
              aria-describedby={`value-${horse.horseId}-hint`}
            />
          </Field>

          {/* The tri-state, as two buttons rather than two loose radios: the
              third state is the absence of a row and is not offered here,
              because a decision is what this form records (ADR 0015). */}
          <fieldset className="choice field-wide">
            <legend>Which number it follows</legend>
            <div className="choice-options">
              <label htmlFor={`stance-own-${horse.horseId}`}>
                <input
                  id={`stance-own-${horse.horseId}`}
                  name="stance"
                  type="radio"
                  value="overridden"
                  defaultChecked
                />
                <span>Its own number</span>
              </label>
              <label htmlFor={`stance-default-${horse.horseId}`}>
                <input
                  id={`stance-default-${horse.horseId}`}
                  name="stance"
                  type="radio"
                  value="follows_default"
                />
                <span>The rescue’s number, deliberately</span>
              </label>
            </div>
          </fieldset>
        </Fields>

        <Actions>
          <SaveButton pending={pending} pendingLabel="Publishing…">
            {`Publish for ${horse.horseName}`}
          </SaveButton>
          <Saved saved={saved} what="Published" />
        </Actions>
      </form>
    </article>
  )
}
