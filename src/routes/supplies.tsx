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
type ShiftPage = Answers<typeof contract, '/shifts'>
type Me = Answers<typeof contract, '/me'>

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
    <li>
      <strong>{product.productName}</strong>
      {product.reorderPointDays !== null && ` (reorder at ${product.reorderPointDays} days)`}
      {product.atOrBelowReorderPoint && <strong> — reorder point reached</strong>}
      <br />
      {product.latestReading === null ? (
        <span>Never counted.</span>
      ) : product.projectedDaysRemaining === 0 ? (
        <span>Out — last counted {product.latestReading.countedOn}.</span>
      ) : (
        <span>
          {product.projectedDaysRemaining} days left — last counted{' '}
          {product.latestReading.countedOn} by {product.latestReading.recordedByName}
        </span>
      )}
      {canOpenReorder && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => {
              void act(() => client.post('/reorders', { productId: product.productId }))
            }}
          >
            Open a Reorder
          </button>
        </>
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
    <li>
      <p>
        <strong>{reorder.productName}</strong> — {reorder.closedAt === null ? 'Open' : 'Closed'}
      </p>
      <p>
        Opened by {reorder.openedByName}
        {reorder.escalationId !== null && ' — created from an Escalation'}
        {reorder.closedAt !== null &&
          `. Closed by ${reorder.closedByName ?? 'somebody'}: ${reorder.closingNote ?? ''}`}
      </p>

      {reorder.comments.length > 0 && (
        <ul>
          {reorder.comments.map((comment) => (
            <li key={comment.id}>
              {comment.authoredByName}: {comment.text}
            </li>
          ))}
        </ul>
      )}

      {problem !== null && <p role="alert">{problem}</p>}

      {canAct && reorder.closedAt === null && (
        <>
          <form
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
            <label htmlFor={`reorder-comment-${reorder.id}`}>Add to the thread</label>
            <input id={`reorder-comment-${reorder.id}`} name="text" required maxLength={2000} />
            <button type="submit" disabled={busy}>
              Comment
            </button>
          </form>

          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const note = String(new FormData(form).get('note') ?? '')
              void run(() => client.post('/reorders/close', { reorderId: reorder.id, note }))
            }}
          >
            <label htmlFor={`reorder-close-${reorder.id}`}>Close with a note</label>
            <input id={`reorder-close-${reorder.id}`} name="note" required maxLength={2000} />
            <button type="submit" disabled={busy}>
              Close
            </button>
          </form>
        </>
      )}
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
        <h1>Supplies</h1>
        <p role="alert">{problem}</p>
      </main>
    )
  }

  if (forecast === null || reorders === null || escalations === null || me === null) {
    return (
      <main>
        <h1>Supplies</h1>
        <p>One moment…</p>
      </main>
    )
  }

  const openFromSupplies = escalations.escalations.filter(
    (escalation) => escalation.scope === 'supplies' && escalation.closedAt === null,
  )

  return (
    <main>
      <h1>Supplies</h1>
      {problem !== null && <p role="alert">{problem}</p>}

      <section>
        <h2>Days of supply</h2>
        {forecast.products.length === 0 ? (
          <p>No Products in the catalogue yet.</p>
        ) : (
          <ul>
            {forecast.products.map((product) => (
              <ProductRow
                key={product.productId}
                product={product}
                canOpenReorder={holdsSupplies}
                act={act}
              />
            ))}
          </ul>
        )}
      </section>

      {canRecordReading && (
        <section>
          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const form = event.currentTarget
              const data = new FormData(form)
              void act(() =>
                client.post('/supplies/readings', {
                  productId: String(data.get('productId') ?? ''),
                  daysRemaining: Number(data.get('daysRemaining') ?? '0'),
                  countedOn: dayString(String(data.get('countedOn') ?? forecast.today)),
                  shiftId: myShiftId,
                }),
              ).then(() => form.reset())
            }}
          >
            <h3>Record a count</h3>
            <label htmlFor="reading-product">Product</label>
            <select id="reading-product" name="productId" required defaultValue="">
              <option value="" disabled>
                Pick one
              </option>
              {forecast.products.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.productName}
                </option>
              ))}
            </select>
            <label htmlFor="reading-days">Days remaining</label>
            <input
              id="reading-days"
              name="daysRemaining"
              type="number"
              min={0}
              step="0.5"
              required
            />
            <label htmlFor="reading-counted-on">Counted on</label>
            <input
              id="reading-counted-on"
              name="countedOn"
              type="date"
              required
              defaultValue={forecast.today}
            />
            <button type="submit">Record</button>
          </form>
        </section>
      )}

      {holdsSupplies && openFromSupplies.length > 0 && (
        <section>
          <h2>Open, addressed to supplies</h2>
          <ul>
            {openFromSupplies.map((escalation) => (
              <li key={escalation.id}>
                <em>{escalation.framing}</em>
                <form
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    void act(() =>
                      client.post('/reorders', {
                        productId: String(data.get('productId') ?? ''),
                        escalationId: escalation.id,
                      }),
                    )
                  }}
                >
                  <label htmlFor={`reorder-from-${escalation.id}`}>Open a Reorder for</label>
                  <select
                    id={`reorder-from-${escalation.id}`}
                    name="productId"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Pick a Product
                    </option>
                    {forecast.products.map((product) => (
                      <option key={product.productId} value={product.productId}>
                        {product.productName}
                      </option>
                    ))}
                  </select>
                  <button type="submit">Open</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Reorders</h2>
        {reorders.reorders.length === 0 ? (
          <p>No Reorders yet.</p>
        ) : (
          <ul>
            {reorders.reorders.map((reorder) => (
              <ReorderCard key={reorder.id} reorder={reorder} canAct={holdsSupplies} act={act} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
