/**
 * Products and Suppliers: the catalogue a Feed Schedule line names (ADR
 * 0019). Editable by holders of `horse_care` or `supplies` — ADR 0019's one
 * two-Scope record — which the server checks; this screen offers the same
 * forms to either.
 *
 * A Supplier has no edit here: five names carry the whole catalogue, and a
 * typo is rare enough that a correction can wait for a reason to add one.
 *
 * Both adds and the Product edit open the same sheet, and the Product form is
 * written once for both doors. Seven fields is where the old inline row edit
 * hurt most: on a phone it was a form laid across a table cell nobody could
 * see the right-hand half of.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  Actions,
  AddButton,
  Choice,
  Empty,
  Field,
  Fields,
  Filter,
  Loading,
  SaveButton,
  Saved,
  Sheet,
  matches,
  useSaving,
} from '../../components/forms'
import { client } from '../../shared/api-client'
import { PRODUCT_KINDS, type ProductKind } from '../../shared/products'
import { refusalText } from '../../shared/refusals'
import { dayString } from '../../shared/time'
import type { Answers, contract } from '../../shared/api-contract'

export const Route = createFileRoute('/admin/products')({
  component: Products,
})

type SupplierList = Answers<typeof contract, '/suppliers'>
type ProductList = Answers<typeof contract, '/products'>
type Product = ProductList['products'][number]

const KIND_LABEL: Record<ProductKind, string> = {
  feed: 'Feed',
  supplement: 'Supplement',
  medication: 'Medication',
  topical: 'Topical',
}

const KIND_OPTIONS = PRODUCT_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))

type Open =
  | { readonly kind: 'supplier' }
  /**
   * The **id** rather than the row, because the sheet stays open across its own
   * write: `Retirement` records and reloads without closing, and a captured row
   * would go on saying *Retire the Product* against a Product the catalogue
   * behind it has already marked Retired (#64). The same reason
   * `/admin/horses` holds `openFor` as an id and finds the horse at render.
   */
  | { readonly kind: 'product'; readonly productId: string | null }
  | null

function Products() {
  const [suppliers, setSuppliers] = useState<SupplierList | null>(null)
  const [products, setProducts] = useState<ProductList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<Open>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const [listedSuppliers, listedProducts] = await Promise.all([
      client.get('/suppliers'),
      client.get('/products'),
    ])
    setSuppliers(listedSuppliers)
    setProducts(listedProducts)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
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

  const shown = useMemo(
    () =>
      (products?.products ?? []).filter((product) =>
        matches(filter, product.name, KIND_LABEL[product.kind], product.supplierName),
      ),
    [products, filter],
  )

  /**
   * The Product the sheet is open on, resolved from the list on every render
   * rather than captured when the button was pressed — which is what makes the
   * Retirement panel flip the moment its own write lands (#64).
   */
  const editing = useMemo(
    () =>
      open?.kind === 'product' && open.productId !== null
        ? ((products?.products ?? []).find((product) => product.id === open.productId) ?? null)
        : null,
    [open, products],
  )

  return (
    <main>
      <h1>Products and Suppliers</h1>

      <p className="lede">
        Every Product a Feed Schedule line can name, and who it comes from. The kind is what colours
        it on the Board and what decides whether giving it needs Medication Authority.
      </p>

      {problem !== null && <p role="alert">{problem}</p>}

      <div className="list-head">
        <h2>Suppliers</h2>
        <AddButton
          onClick={() => {
            setOpen({ kind: 'supplier' })
          }}
        >
          Add a Supplier
        </AddButton>
      </div>

      {suppliers === null ? (
        <Loading what="Suppliers" />
      ) : suppliers.suppliers.length === 0 ? (
        <Empty>No Suppliers yet. A Product does not need one.</Empty>
      ) : (
        <section>
          <ul>
            {suppliers.suppliers.map((supplier) => (
              <li key={supplier.id}>
                <strong>{supplier.name}</strong>
                {supplier.url !== null && (
                  <>
                    {' '}
                    <a href={supplier.url} rel="noreferrer">
                      {supplier.url}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="list-head">
        <h2>The catalogue</h2>
        <AddButton
          onClick={() => {
            setOpen({ kind: 'product', productId: null })
          }}
        >
          Add a Product
        </AddButton>
      </div>

      {products === null ? (
        <Loading what="Products" />
      ) : products.products.length === 0 ? (
        <Empty>No Products yet. Add the feed the barn actually buys.</Empty>
      ) : (
        <>
          {products.products.length > 8 && (
            <Filter
              label="Find a Product"
              value={filter}
              onChange={setFilter}
              showing={shown.length}
              of={products.products.length}
              noun="Products"
            />
          )}

          {shown.length === 0 ? (
            <Empty>No Product matches “{filter}”.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Prescription</th>
                  <th scope="col">Reorder point</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {shown.map((product) => (
                  <tr key={product.id}>
                    <td>
                      {product.name}
                      {/* A Retired Product stays on this list, marked — the
                          same call `/admin/horses` makes for a Departed horse,
                          because admin is where the history stays (#64). */}
                      {product.retiredOn !== null && (
                        <>
                          {' '}
                          <span className="badge">Retired {product.retiredOn}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-${BADGE[product.kind]}`}>
                        {KIND_LABEL[product.kind]}
                      </span>
                    </td>
                    <td>{product.supplierName ?? 'None'}</td>
                    <td>{product.prescription ? 'Yes' : 'No'}</td>
                    <td>
                      {product.reorderPointDays === null
                        ? 'Not set'
                        : `${product.reorderPointDays} days`}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen({ kind: 'product', productId: product.id })
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {open?.kind === 'supplier' && (
        <Sheet
          title="Add a Supplier"
          description="A name is enough. The rest is for whoever places the order."
          onClose={() => {
            setOpen(null)
          }}
        >
          <SupplierForm
            act={act}
            onSaved={() => {
              setOpen(null)
            }}
          />
        </Sheet>
      )}

      {open?.kind === 'product' && (
        <Sheet
          title={editing === null ? 'Add a Product' : `Edit ${editing.name}`}
          description="Medication is the kind that needs Medication Authority to give. A Topical goes on a horse rather than in it, and is never fed."
          onClose={() => {
            setOpen(null)
          }}
        >
          <ProductForm
            product={editing}
            suppliers={suppliers?.suppliers ?? []}
            act={act}
            onSaved={() => {
              setOpen(null)
            }}
          />
          {editing !== null && <Retirement product={editing} act={act} />}
        </Sheet>
      )}
    </main>
  )
}

/** Which tint a kind wears wherever it is shown as a tag. */
const BADGE: Record<ProductKind, string> = {
  feed: 'green',
  supplement: 'purple',
  medication: 'orange',
  topical: 'blue',
}

function SupplierForm({
  act,
  onSaved,
}: {
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/suppliers', {
              name: String(data.get('name') ?? ''),
              url: String(data.get('url') ?? '') || null,
              note: String(data.get('note') ?? '') || null,
            }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="new-supplier-name">
          <input id="new-supplier-name" name="name" required maxLength={200} autoFocus />
        </Field>
        <Field label="Web address" htmlFor="new-supplier-url" optional>
          <input id="new-supplier-url" name="url" type="url" maxLength={2000} />
        </Field>
        <div className="field-wide">
          <Field label="Note" htmlFor="new-supplier-note" optional>
            <input id="new-supplier-note" name="note" maxLength={2000} />
          </Field>
        </div>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Add the Supplier</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/**
 * Retiring a Product, and correcting a mistaken Retirement — the same shape
 * `/admin/horses`'s Departure has, and for the same reason: a date, never a
 * delete (#64).
 *
 * `onFeedSchedules` comes down on the read, so the button is disabled with
 * the count against it **before** anybody clicks. The server refuses the same
 * case with `product_in_use` from the same derivation, so the two cannot
 * disagree — this is the friendlier half of one rule, not a second one.
 */
function Retirement({
  product,
  act,
}: {
  product: Product
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { pending, saved, save } = useSaving()

  if (product.retiredOn !== null) {
    return (
      <form
        className="danger"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void save(() =>
            act(() =>
              client.post('/products/retirement', {
                productId: product.id,
                retiredOn: null,
                reason: null,
              }),
            ),
          ).catch(() => {
            // Already on the screen behind the sheet, put there by `act`.
          })
        }}
      >
        <h3>Retired {product.retiredOn}</h3>
        <p>
          The record stays either way, and so do its readings and its Reorders. This only corrects
          the date.
        </p>
        <Actions>
          <SaveButton pending={pending}>Correct: not Retired</SaveButton>
          <Saved saved={saved} />
        </Actions>
      </form>
    )
  }

  if (product.onFeedSchedules > 0) {
    return (
      <div className="danger">
        <h3>Retirement</h3>
        <p>
          {product.name} is on {product.onFeedSchedules}{' '}
          {product.onFeedSchedules === 1 ? "horse's" : "horses'"} current Feed{' '}
          {product.onFeedSchedules === 1 ? 'Schedule' : 'Schedules'}. Take it off{' '}
          {product.onFeedSchedules === 1 ? 'that one' : 'those'} first — otherwise the phone would
          still ask for it every morning.
        </p>
      </div>
    )
  }

  return (
    <form
      className="danger"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void save(() =>
          act(() =>
            client.post('/products/retirement', {
              productId: product.id,
              retiredOn: dayString(String(data.get('retiredOn') ?? '')),
              reason: String(data.get('reason') ?? '') || null,
            }),
          ),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <h3>Retirement</h3>
      <p>
        A date, never a delete. It stays on this list, marked, and the readings and Reorders it
        already carries stay with it. It stops being offered on a new Feed Schedule line, a new
        reading and a new Reorder.
      </p>
      <Fields>
        <Field label="Date" htmlFor="retired-on">
          <input id="retired-on" name="retiredOn" type="date" required />
        </Field>
        <Field label="Reason" htmlFor="retirement-reason" optional>
          <input id="retirement-reason" name="reason" maxLength={500} />
        </Field>
      </Fields>
      <Actions>
        <SaveButton pending={pending}>Retire the Product</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}

/**
 * The Product form, written once and opened from both doors. A `null` Product
 * is the add; the reason field exists only on the edit, because that is what
 * the audit entry carries and a first creation has none (ADR 0003).
 */
function ProductForm({
  product,
  suppliers,
  act,
  onSaved,
}: {
  product: Product | null
  suppliers: SupplierList['suppliers']
  act: (work: () => Promise<unknown>) => Promise<void>
  onSaved: () => void
}) {
  const { pending, saved, save } = useSaving()
  // The kind is state rather than an uncontrolled default because one other
  // field depends on it: a Topical has no prescription to ask about.
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? 'feed')

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const supplierId = String(data.get('supplierId') ?? '')
        const reorderPointDays = String(data.get('reorderPointDays') ?? '')
        const common = {
          name: String(data.get('name') ?? ''),
          kind,
          supplierId: supplierId === '' ? null : supplierId,
          // A Topical is never a prescription — zinc oxide and fly spray are
          // bought off a shelf — so the question is not asked and the answer
          // is not carried over from whatever the kind was before (#58).
          prescription: kind !== 'topical' && data.get('prescription') === 'on',
          reorderPointDays: reorderPointDays === '' ? null : Number(reorderPointDays),
          orderingNote: String(data.get('orderingNote') ?? '') || null,
        }
        void save(() =>
          act(() =>
            product === null
              ? client.post('/products', common)
              : client.post('/products/edit', {
                  productId: product.id,
                  ...common,
                  reason: String(data.get('reason') ?? '') || null,
                }),
          ).then(onSaved),
        ).catch(() => {
          // Already on the screen behind the sheet, put there by `act`.
        })
      }}
    >
      <Fields>
        <Field label="Name" htmlFor="product-name">
          <input
            id="product-name"
            name="name"
            defaultValue={product?.name}
            required
            maxLength={200}
            placeholder="Senior"
            autoFocus
          />
        </Field>
        <Field label="Supplier" htmlFor="product-supplier" optional>
          <select id="product-supplier" name="supplierId" defaultValue={product?.supplierId ?? ''}>
            <option value="">None</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-wide">
          <Choice
            legend="Kind"
            name="kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
          />
        </div>
        <Field
          label="Reorder point"
          htmlFor="product-reorder"
          optional
          hint="In days of supply. Below this, it is flagged to reorder."
        >
          <input
            id="product-reorder"
            name="reorderPointDays"
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={product?.reorderPointDays ?? ''}
            aria-describedby="product-reorder-hint"
          />
        </Field>
        <Field label="Ordering note" htmlFor="product-note" optional>
          <input
            id="product-note"
            name="orderingNote"
            maxLength={2000}
            defaultValue={product?.orderingNote ?? ''}
          />
        </Field>
        {kind !== 'topical' && (
          <div className="field-wide">
            <label htmlFor="product-prescription">
              <input
                id="product-prescription"
                name="prescription"
                type="checkbox"
                defaultChecked={product?.prescription}
              />
              Needs a prescription
            </label>
          </div>
        )}
        {product !== null && (
          <div className="field-wide">
            <Field
              label="Reason"
              htmlFor="product-reason"
              optional
              hint="Why it changed. This is what the audit entry carries."
            >
              <input
                id="product-reason"
                name="reason"
                maxLength={500}
                aria-describedby="product-reason-hint"
              />
            </Field>
          </div>
        )}
      </Fields>

      <Actions>
        <SaveButton pending={pending}>{product === null ? 'Add the Product' : 'Save'}</SaveButton>
        <Saved saved={saved} />
      </Actions>
    </form>
  )
}
