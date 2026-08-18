/**
 * Products and Suppliers: the catalogue a Feed Schedule line names (ADR
 * 0019). Editable by holders of `horse_care` or `supplies` — ADR 0019's one
 * two-Scope record — which the server checks; this screen offers the same
 * forms to either.
 *
 * A Supplier has no edit here: five names carry the whole catalogue, and a
 * typo is rare enough that a correction can wait for a reason to add one.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import { PRODUCT_KINDS, type ProductKind } from '../../shared/products'
import { refusalText } from '../../shared/refusals'
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
}

function Products() {
  const [suppliers, setSuppliers] = useState<SupplierList | null>(null)
  const [products, setProducts] = useState<ProductList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

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
      }
    },
    [load],
  )

  return (
    <main>
      <h1>Products and Suppliers</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      <section>
        <h2>Suppliers</h2>
        {suppliers === null ? (
          <p>One moment…</p>
        ) : (
          <ul>
            {suppliers.suppliers.map((supplier) => (
              <li key={supplier.id}>
                {supplier.name}
                {supplier.url !== null && ` — ${supplier.url}`}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            void act(() =>
              client.post('/suppliers', {
                name: String(data.get('name') ?? ''),
                url: String(data.get('url') ?? '') || null,
                note: String(data.get('note') ?? '') || null,
              }),
            ).then(() => {
              form.reset()
            })
          }}
        >
          <h3>Add a Supplier</h3>
          <label htmlFor="new-supplier-name">Name</label>
          <input id="new-supplier-name" name="name" required maxLength={200} />
          <label htmlFor="new-supplier-url">Web address (optional)</label>
          <input id="new-supplier-url" name="url" type="url" maxLength={2000} />
          <label htmlFor="new-supplier-note">Note (optional)</label>
          <input id="new-supplier-note" name="note" maxLength={2000} />
          <button type="submit">Add</button>
        </form>
      </section>

      <section>
        <h2>Products</h2>

        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            const supplierId = String(data.get('supplierId') ?? '')
            const reorderPointDays = String(data.get('reorderPointDays') ?? '')
            void act(() =>
              client.post('/products', {
                name: String(data.get('name') ?? ''),
                kind: data.get('kind') as ProductKind,
                supplierId: supplierId === '' ? null : supplierId,
                prescription: data.get('prescription') === 'on',
                reorderPointDays: reorderPointDays === '' ? null : Number(reorderPointDays),
                orderingNote: String(data.get('orderingNote') ?? '') || null,
              }),
            ).then(() => {
              form.reset()
            })
          }}
        >
          <h3>Add a Product</h3>
          <label htmlFor="new-product-name">Name</label>
          <input id="new-product-name" name="name" required maxLength={200} placeholder="Senior" />
          <label htmlFor="new-product-kind">Kind</label>
          <select id="new-product-kind" name="kind" defaultValue="feed">
            {PRODUCT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          <label htmlFor="new-product-supplier">Supplier (optional)</label>
          <select id="new-product-supplier" name="supplierId" defaultValue="">
            <option value="">None</option>
            {(suppliers?.suppliers ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <label htmlFor="new-product-prescription">Needs a prescription</label>
          <input id="new-product-prescription" name="prescription" type="checkbox" />
          <label htmlFor="new-product-reorder">Reorder point, in days (optional)</label>
          <input id="new-product-reorder" name="reorderPointDays" type="number" min={0} />
          <label htmlFor="new-product-note">Ordering note (optional)</label>
          <input id="new-product-note" name="orderingNote" maxLength={2000} />
          <button type="submit">Add</button>
        </form>

        {products === null ? (
          <p>One moment…</p>
        ) : (
          <table>
            <caption>The catalogue</caption>
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
              {products.products.map((product) => (
                <tr key={product.id}>
                  {editing === product.id ? (
                    <EditProduct
                      product={product}
                      suppliers={suppliers?.suppliers ?? []}
                      onCancel={() => {
                        setEditing(null)
                      }}
                      act={async (work) => {
                        await act(work)
                        setEditing(null)
                      }}
                    />
                  ) : (
                    <>
                      <td>{product.name}</td>
                      <td>{KIND_LABEL[product.kind]}</td>
                      <td>{product.supplierName ?? '—'}</td>
                      <td>{product.prescription ? 'Yes' : 'No'}</td>
                      <td>
                        {product.reorderPointDays === null
                          ? '—'
                          : `${product.reorderPointDays} days`}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(product.id)
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

function EditProduct({
  product,
  suppliers,
  onCancel,
  act,
}: {
  product: Product
  suppliers: SupplierList['suppliers']
  onCancel: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <td colSpan={6}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const supplierId = String(data.get('supplierId') ?? '')
          const reorderPointDays = String(data.get('reorderPointDays') ?? '')
          void act(() =>
            client.post('/products/edit', {
              productId: product.id,
              name: String(data.get('name') ?? ''),
              kind: data.get('kind') as ProductKind,
              supplierId: supplierId === '' ? null : supplierId,
              prescription: data.get('prescription') === 'on',
              reorderPointDays: reorderPointDays === '' ? null : Number(reorderPointDays),
              orderingNote: String(data.get('orderingNote') ?? '') || null,
              reason: String(data.get('reason') ?? '') || null,
            }),
          )
        }}
      >
        <label htmlFor={`edit-name-${product.id}`}>Name</label>
        <input
          id={`edit-name-${product.id}`}
          name="name"
          defaultValue={product.name}
          required
          maxLength={200}
        />
        <label htmlFor={`edit-kind-${product.id}`}>Kind</label>
        <select id={`edit-kind-${product.id}`} name="kind" defaultValue={product.kind}>
          {PRODUCT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <label htmlFor={`edit-supplier-${product.id}`}>Supplier</label>
        <select
          id={`edit-supplier-${product.id}`}
          name="supplierId"
          defaultValue={product.supplierId ?? ''}
        >
          <option value="">None</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
        <label htmlFor={`edit-prescription-${product.id}`}>Needs a prescription</label>
        <input
          id={`edit-prescription-${product.id}`}
          name="prescription"
          type="checkbox"
          defaultChecked={product.prescription}
        />
        <label htmlFor={`edit-reorder-${product.id}`}>Reorder point, in days</label>
        <input
          id={`edit-reorder-${product.id}`}
          name="reorderPointDays"
          type="number"
          min={0}
          defaultValue={product.reorderPointDays ?? ''}
        />
        <label htmlFor={`edit-note-${product.id}`}>Ordering note</label>
        <input
          id={`edit-note-${product.id}`}
          name="orderingNote"
          maxLength={2000}
          defaultValue={product.orderingNote ?? ''}
        />
        <label htmlFor={`edit-reason-${product.id}`}>Reason (optional)</label>
        <input id={`edit-reason-${product.id}`} name="reason" maxLength={500} />
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </td>
  )
}
