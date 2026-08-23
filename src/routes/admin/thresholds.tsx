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

import {
  Actions,
  CHOICE_OPTION,
  Empty,
  Field,
  Fields,
  SaveButton,
  Saved,
  useSaving,
} from '../../components/forms'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
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

/** A card section, now that a `<section>` is no longer one by element rule. */
const CARD = 'mb-4 rounded-lg border border-border bg-background p-4 sm:p-6'

function Thresholds() {
  const [listed, setListed] = useState<ThresholdList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [defaultKind, setDefaultKind] = useState<ThresholdKind>('sheet')

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
        <h1 className="text-foreground">Thresholds</h1>
        {problem === null ? (
          <p>One moment…</p>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>{problem}</AlertTitle>
          </Alert>
        )}
      </main>
    )
  }

  const owed = listed.horses.filter((horse) => horse.undecided.length > 0)
  const byKind = new Map(listed.defaults.map((record) => [record.kind, record]))

  return (
    <main>
      <h1 className="text-foreground">Thresholds</h1>
      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        The temperatures the weather rules turn at. An edit publishes a new version; the old one
        stays, so what a horse’s number was in January is still answerable.
      </p>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>{problem}</AlertTitle>
        </Alert>
      )}

      <section className={CARD}>
        <h2 className="mt-0">The rescue’s numbers</h2>
        <p>What every horse follows unless somebody decided otherwise for it.</p>
        <ul className="m-0 mb-3 list-none p-0">
          {THRESHOLD_KINDS.map((kind) => {
            const record = byKind.get(kind)
            return (
              <li
                key={kind}
                className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
              >
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
          className="mt-4 rounded-md border border-border bg-card p-4"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/thresholds', {
                horseId: null,
                kind: defaultKind,
                stance: 'overridden',
                value: Number(data.get('value') ?? ''),
                validFrom: listed.today,
              }),
            ).then((landed) => {
              if (landed) {
                form.reset()
                setDefaultKind('sheet')
              }
            })
          }}
        >
          <h3 className="m-0 mb-1 text-base font-semibold text-foreground">
            Set one of the rescue’s numbers
          </h3>
          <Fields>
            <Field label="Which" htmlFor="default-kind">
              <Select
                value={defaultKind}
                onValueChange={(kind) => {
                  setDefaultKind(kind as ThresholdKind)
                }}
              >
                <SelectTrigger id="default-kind" aria-label="Which">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLD_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Degrees Fahrenheit" htmlFor="default-value">
              <Input
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
            <Button type="submit">Publish</Button>
          </Actions>
        </form>
      </section>

      <section className={CARD}>
        <h2 className="mt-0">Today’s weather</h2>
        <p>
          Fetches the forecast and works out what it means for today — what the Board shows, and
          what a Shift’s list will be fixed against. It becomes the daily job’s first step the day
          there is a daily job; until then it is this button.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void act(() => client.post('/weather/readings', {}))
          }}
        >
          Read today’s weather
        </Button>
      </section>

      <section className={CARD}>
        <h2 className="mt-0">Decisions owed</h2>
        {owed.length === 0 ? (
          <p className="m-0 text-[13px] leading-snug text-muted-foreground">
            Every horse has a sheet and a blanket number, or has been put on the rescue’s.
          </p>
        ) : (
          <ul className="my-3 list-none rounded-md bg-card-tint-peach px-4 py-3 text-sm text-brand-orange-deep dark:border dark:border-card-tint-peach/40 dark:bg-transparent dark:text-card-tint-peach">
            {owed.map((horse) => (
              <li key={horse.horseId} className="mb-1 last:mb-0">
                {horse.horseName} —{' '}
                {horse.undecided.map((kind) => KIND_LABEL[kind].toLowerCase()).join(' and ')}{' '}
                <em>not yet decided</em>; the rescue’s number is being used meanwhile.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <h2 className="mt-0">Each horse</h2>
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
  const [kind, setKind] = useState<ThresholdKind>('sheet')

  return (
    <article className="mb-3 rounded-md border border-border bg-background p-4 last:mb-0">
      <h3 className="mt-0">{horse.horseName}</h3>
      <ul className="m-0 mb-3 list-disc pl-5">
        {PER_HORSE_THRESHOLD_KINDS.map((recordKind) => {
          const record = held.get(recordKind)
          return (
            <li key={recordKind} className="mb-1 last:mb-0">
              {KIND_LABEL[recordKind]}:{' '}
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
                kind,
                stance,
                // A horse deliberately on the rescue's number carries none of its
                // own: one copied here would stop moving when the default did.
                value: stance === 'follows_default' || value === '' ? null : Number(value),
                validFrom: today,
              }),
            ).then((landed) => {
              if (landed) {
                form.reset()
                setKind('sheet')
              }
            }),
          )
        }}
      >
        <Fields>
          <Field label="Which" htmlFor={`kind-${horse.horseId}`}>
            <Select
              value={kind}
              onValueChange={(next) => {
                setKind(next as ThresholdKind)
              }}
            >
              <SelectTrigger id={`kind-${horse.horseId}`} aria-label="Which">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PER_HORSE_THRESHOLD_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {KIND_LABEL[option]} ({METRIC_LABEL[THRESHOLD_SPECS[option].metric]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Degrees Fahrenheit"
            htmlFor={`value-${horse.horseId}`}
            hint="Left blank when this horse follows the rescue’s number."
          >
            <Input
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
          <fieldset className="mt-3 min-w-0 border-0 p-0 sm:col-span-2">
            <legend className="mb-1 block p-0 text-sm font-medium text-foreground">
              Which number it follows
            </legend>
            <div className="flex flex-wrap gap-2">
              <label htmlFor={`stance-own-${horse.horseId}`} className="m-0 block">
                <input
                  className="peer sr-only"
                  id={`stance-own-${horse.horseId}`}
                  name="stance"
                  type="radio"
                  value="overridden"
                  defaultChecked
                />
                <span className={CHOICE_OPTION}>Its own number</span>
              </label>
              <label htmlFor={`stance-default-${horse.horseId}`} className="m-0 block">
                <input
                  className="peer sr-only"
                  id={`stance-default-${horse.horseId}`}
                  name="stance"
                  type="radio"
                  value="follows_default"
                />
                <span className={CHOICE_OPTION}>The rescue’s number, deliberately</span>
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
