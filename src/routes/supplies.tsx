/**
 * Supplies: the whiteboard's Days-of-Supply table, finally doing the
 * arithmetic, and the Reorder — borrowing the Escalation's own shape rather
 * than a fourth hand-rolled log (`CONTEXT.md`'s Days of Supply and Reorder;
 * ADR 0019, #47).
 *
 * **Readable by everyone** — the same floor `/products` answers on.
 * Recording a reading is offered only to whoever the server will actually
 * take it from: a `supplies` holder, or whoever presently carries Shift
 * Authority on a Shift standing today — the "shown to whoever it will take"
 * discipline `shifts.tsx` follows for Short, rather than a link that fails
 * for everybody else.
 *
 * **A Reorder may be opened cold, against a Product alone, or from an open
 * Escalation addressed to `supplies`** — linked back, sharing no state with
 * it: closing the Reorder here never touches the Escalation, and the
 * Escalation's own screen is where it gets answered.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { Actions, Empty, Field, Fields, Loading } from '../components/forms'
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
import { refusalText } from '../shared/refusals'
import { carriesShiftAuthority } from '../shared/shifts'
import { dayString } from '../shared/time'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/supplies')({
  component: Supplies,
})

type Forecast = Answers<typeof contract, '/supplies'>
type ProductSupply = Forecast['products'][number]
type ReorderPage = Answers<typeof contract, '/reorders'>
type Reorder = ReorderPage['reorders'][number]
type EscalationPage = Answers<typeof contract, '/escalations'>
type Escalation = EscalationPage['escalations'][number]
type ShiftPage = Answers<typeof contract, '/shifts'>
type Me = Answers<typeof contract, '/me'>

const LABEL = 'mb-1 block text-sm font-medium text-foreground'

function ProductRow({
  product,
  canOpenReorder,
  act,
}: {
  product: ProductSupply
  canOpenReorder: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <li
      className={
        product.atOrBelowReorderPoint
          ? 'border-b border-l-4 border-border border-l-warning py-3 pl-3 first:pt-0 last:border-b-0 last:pb-0'
          : 'border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0'
      }
    >
      <div>
        <strong>{product.productName}</strong>
        {product.reorderPointDays !== null && ` (reorder at ${product.reorderPointDays} days)`}
        {product.atOrBelowReorderPoint && <strong> — reorder point reached</strong>}
      </div>
      {/* The count is the fact this screen exists to carry, so it is set in
          the mono face like every other countable thing — a column of days
          left is scanned down rather than read across, and proportional
          figures make that harder than it needs to be. */}
      <div className="mt-0.5 text-sm text-muted-foreground">
        {product.latestReading === null ? (
          <span>Never counted.</span>
        ) : product.projectedDaysRemaining === 0 ? (
          <span>Out — last counted {product.latestReading.countedOn}.</span>
        ) : (
          <span>
            {/* The figure and its unit stay one text node: they are one fact,
                and splitting them would leave the screen readable and the
                test that pins the sentence unable to see it. */}
            <span className="font-mono text-base font-medium text-foreground">
              {product.projectedDaysRemaining} days left
            </span>{' '}
            — last counted {product.latestReading.countedOn} by{' '}
            {product.latestReading.recordedByName}
          </span>
        )}
      </div>
      {canOpenReorder && (
        <div className="mt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void act(() => client.post('/reorders', { productId: product.productId }))
            }}
          >
            Open a Reorder
          </Button>
        </div>
      )}
    </li>
  )
}

function ReorderCard({
  reorder,
  canAct,
  act,
}: {
  reorder: Reorder
  canAct: boolean
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const run = useCallback(
    async (work: () => Promise<unknown>, reset?: () => void) => {
      setProblem(null)
      setBusy(true)
      try {
        await act(work)
        reset?.()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      } finally {
        setBusy(false)
      }
    },
    [act],
  )

  return (
    <li className="border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
      <p className="m-0">
        <strong>{reorder.productName}</strong> — {reorder.closedAt === null ? 'Open' : 'Closed'}
      </p>
      <p className="m-0 mt-1 text-sm text-muted-foreground">
        Opened by {reorder.openedByName}
        {reorder.escalationId !== null && ' — created from an Escalation'}
        {reorder.closedAt !== null &&
          `. Closed by ${reorder.closedByName ?? 'somebody'}: ${reorder.closingNote ?? ''}`}
      </p>

      {reorder.comments.length > 0 && (
        <ul className="m-0 mt-2 list-none p-0">
          {reorder.comments.map((comment) => (
            <li key={comment.id} className="m-0 py-1 text-sm">
              <span className="font-medium">{comment.authoredByName}:</span> {comment.text}
            </li>
          ))}
        </ul>
      )}

      {problem !== null && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      {canAct && reorder.closedAt === null && (
        <>
          <form
            className="mt-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const text = String(new FormData(form).get('text') ?? '')
              void run(
                () => client.post('/reorders/comments', { reorderId: reorder.id, text }),
                () => form.reset(),
              )
            }}
          >
            <label htmlFor={`reorder-comment-${reorder.id}`} className={LABEL}>
              Add to the thread
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`reorder-comment-${reorder.id}`}
                name="text"
                required
                maxLength={2000}
                className="max-w-96 flex-1 basis-52"
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Comment
              </Button>
            </div>
          </form>

          <form
            className="mt-3"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const note = String(new FormData(form).get('note') ?? '')
              void run(() => client.post('/reorders/close', { reorderId: reorder.id, note }))
            }}
          >
            <label htmlFor={`reorder-close-${reorder.id}`} className={LABEL}>
              Close with a note
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`reorder-close-${reorder.id}`}
                name="note"
                required
                maxLength={2000}
                className="max-w-96 flex-1 basis-52"
              />
              <Button type="submit" disabled={busy}>
                Close
              </Button>
            </div>
          </form>
        </>
      )}
    </li>
  )
}

/**
 * Opening a Reorder from an open Escalation addressed to `supplies`, linked
 * back to it. The Product is the picker's own state rather than a form field,
 * because shadcn's Select carries no form name (ADR 0025).
 */
function ReorderFromEscalation({
  escalation,
  products,
  act,
}: {
  escalation: Escalation
  products: readonly ProductSupply[]
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const [productId, setProductId] = useState('')

  return (
    <li className="border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <em>{escalation.framing}</em>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          if (productId === '') return
          void act(() =>
            client.post('/reorders', {
              productId,
              escalationId: escalation.id,
            }),
          )
        }}
      >
        <label htmlFor={`reorder-from-${escalation.id}`} className={`${LABEL} mt-2`}>
          Open a Reorder for
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger
              id={`reorder-from-${escalation.id}`}
              aria-label="Open a Reorder for"
              className="max-w-72 flex-1 basis-52"
            >
              <SelectValue placeholder="Pick a Product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((product) => (
                <SelectItem key={product.productId} value={product.productId}>
                  {product.productName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Open
          </Button>
        </div>
      </form>
    </li>
  )
}

export function Supplies() {
  const [forecast, setForecast] = useState<Forecast | null>(null)
  const [reorders, setReorders] = useState<ReorderPage | null>(null)
  const [escalations, setEscalations] = useState<EscalationPage | null>(null)
  const [shifts, setShifts] = useState<ShiftPage | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // The reading form's picked Product: shadcn's Select carries no form name,
  // so the value is held here and put on the payload rather than read out of
  // FormData (ADR 0025).
  const [readingProduct, setReadingProduct] = useState('')

  const load = useCallback(async () => {
    const [forecastAnswer, reordersAnswer, escalationsAnswer, shiftsAnswer, meAnswer] =
      await Promise.all([
        client.get('/supplies'),
        client.get('/reorders'),
        client.get('/escalations'),
        client.get('/shifts'),
        client.get('/me'),
      ])
    setForecast(forecastAnswer)
    setReorders(reordersAnswer)
    setEscalations(escalationsAnswer)
    setShifts(shiftsAnswer)
    setMe(meAnswer)
  }, [])

  useEffect(() => {
    let current = true
    load().catch((error: unknown) => {
      if (current) setProblem(refusalText(error))
    })
    return () => {
      current = false
    }
  }, [load])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await load()
      } catch (error: unknown) {
        setProblem(refusalText(error))
        throw error
      }
    },
    [load],
  )

  // Whoever presently carries Shift Authority on a Shift standing today — the
  // person standing in the feed room — so a reading can be recorded on their
  // behalf without asking them to name a Shift (ADR 0019).
  const myShiftId = useMemo(() => {
    if (shifts === null || me === null) return null
    const today = shifts.shifts.find((shift) => shift.day === forecast?.today)
    const standing = today?.roster.find(
      (member) => member.volunteerId === me.volunteerId && member.endedAs === null,
    )
    return standing !== undefined && carriesShiftAuthority(standing.position)
      ? (today?.id ?? null)
      : null
  }, [shifts, me, forecast])

  const holdsSupplies = me !== null && me.domainScopes.includes('supplies')
  const canRecordReading = holdsSupplies || myShiftId !== null

  if (problem !== null && forecast === null) {
    return (
      <main>
        <h1 className="text-foreground">Supplies</h1>
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      </main>
    )
  }

  if (forecast === null || reorders === null || escalations === null || me === null) {
    return (
      <main>
        <h1 className="text-foreground">Supplies</h1>
        <Loading what="supplies" />
      </main>
    )
  }

  const openFromSupplies = escalations.escalations.filter(
    (escalation) => escalation.scope === 'supplies' && escalation.closedAt === null,
  )

  return (
    <main>
      <h1 className="text-foreground">Supplies</h1>
      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <h2 className="mb-3 mt-6 text-foreground">Days of supply</h2>
      {forecast.products.length === 0 ? (
        <Empty>No Products in the catalogue yet.</Empty>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {forecast.products.map((product) => (
              <ProductRow
                key={product.productId}
                product={product}
                canOpenReorder={holdsSupplies}
                act={act}
              />
            ))}
          </ul>
        </section>
      )}

      {canRecordReading && (
        <section className="mb-4 mt-6 rounded-lg border border-border bg-background p-4 sm:p-6">
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const data = new FormData(form)
              if (readingProduct === '') return
              void act(() =>
                client.post('/supplies/readings', {
                  productId: readingProduct,
                  daysRemaining: Number(data.get('daysRemaining') ?? '0'),
                  countedOn: dayString(String(data.get('countedOn') ?? forecast.today)),
                  shiftId: myShiftId,
                }),
              ).then(() => {
                form.reset()
                setReadingProduct('')
              })
            }}
          >
            <h3 className="m-0">Record a count</h3>
            <Fields>
              <Field label="Product" htmlFor="reading-product">
                <Select value={readingProduct} onValueChange={setReadingProduct}>
                  <SelectTrigger id="reading-product" aria-label="Product">
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {forecast.products.map((product) => (
                      <SelectItem key={product.productId} value={product.productId}>
                        {product.productName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Days remaining"
                htmlFor="reading-days"
                hint="How many days it would last from the day you counted."
              >
                <Input
                  id="reading-days"
                  name="daysRemaining"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  required
                  aria-describedby="reading-days-hint"
                />
              </Field>
              <Field label="Counted on" htmlFor="reading-counted-on">
                <Input
                  id="reading-counted-on"
                  name="countedOn"
                  type="date"
                  required
                  defaultValue={forecast.today}
                />
              </Field>
            </Fields>
            <Actions>
              <Button type="submit">Record</Button>
            </Actions>
          </form>
        </section>
      )}

      {holdsSupplies && openFromSupplies.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-foreground">Open, addressed to supplies</h2>
          <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
            <ul className="m-0 list-none p-0">
              {openFromSupplies.map((escalation) => (
                <ReorderFromEscalation
                  key={escalation.id}
                  escalation={escalation}
                  products={forecast.products}
                  act={act}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      <h2 className="mb-3 mt-6 text-foreground">Reorders</h2>
      {reorders.reorders.length === 0 ? (
        <Empty>No Reorders yet.</Empty>
      ) : (
        <section className="mb-4 rounded-lg border border-border bg-background p-4 sm:p-6">
          <ul className="m-0 list-none p-0">
            {reorders.reorders.map((reorder) => (
              <ReorderCard key={reorder.id} reorder={reorder} canAct={holdsSupplies} act={act} />
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
