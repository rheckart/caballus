/**
 * Spaces: every stall, field and barn, occupied or not — and the desk where
 * splitting or merging one happens.
 *
 * There is no delete here on purpose: splitting `2 & 3` back into `2` and `3`,
 * or merging `C` and `D` into `All of C + D`, is an edit of the row's kind and
 * name rather than a new one, which is the whole of how ADR 0002 says a
 * physical change to the barn becomes a change to the record.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import { SPACE_KINDS, type SpaceKind } from '../../shared/spaces'

export const Route = createFileRoute('/admin/spaces')({
  component: Spaces,
})

type SpaceList = Answers<typeof contract, '/spaces'>
type Space = SpaceList['spaces'][number]

const KIND_LABEL: Record<SpaceKind, string> = { stall: 'Stall', field: 'Field', barn: 'Barn' }

function Spaces() {
  const [spaces, setSpaces] = useState<SpaceList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setSpaces(await client.get('/spaces'))
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
      <h1>Spaces</h1>

      {problem !== null && <p role="alert">{problem}</p>}

      <p>
        A Space is one named area — a stall, a field, a barn — that may be more than one physical
        unit joined together. An empty Space is shown exactly like an occupied one: nothing here is
        removed for having nobody in it.
      </p>

      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          void act(() =>
            client.post('/spaces', {
              kind: data.get('kind') as SpaceKind,
              name: String(data.get('name') ?? ''),
            }),
          ).then(() => {
            form.reset()
          })
        }}
      >
        <h2>Add a Space</h2>
        <label htmlFor="new-space-kind">Kind</label>
        <select id="new-space-kind" name="kind" defaultValue="stall">
          {SPACE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <label htmlFor="new-space-name">Name</label>
        <input id="new-space-name" name="name" required maxLength={200} placeholder="Stall 7" />
        <button type="submit">Add</button>
      </form>

      {spaces === null ? (
        <p>One moment…</p>
      ) : (
        <table>
          <caption>Every Space</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Occupied by</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {spaces.spaces.map((space) => (
              <tr key={space.id}>
                {editing === space.id ? (
                  <EditSpace
                    space={space}
                    onCancel={() => {
                      setEditing(null)
                    }}
                    onSaved={() => {
                      setEditing(null)
                      void load()
                    }}
                    act={act}
                  />
                ) : (
                  <>
                    <td>{space.name}</td>
                    <td>{KIND_LABEL[space.kind]}</td>
                    <td>
                      {space.occupants.length === 0
                        ? '—'
                        : space.occupants.map((horse) => horse.name).join(', ')}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(space.id)
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
    </main>
  )
}

function EditSpace({
  space,
  onCancel,
  onSaved,
  act,
}: {
  space: Space
  onCancel: () => void
  onSaved: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <td colSpan={4}>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void act(() =>
            client.post('/spaces/edit', {
              spaceId: space.id,
              kind: data.get('kind') as SpaceKind,
              name: String(data.get('name') ?? ''),
              reason: String(data.get('reason') ?? '') || null,
            }),
          ).then(onSaved)
        }}
      >
        {/* Splitting `2 & 3` into `2` and `3`, or merging `C` and `D`, happens
            here — an edit of this row's kind and name, never a new Space
            (ADR 0002). */}
        <label htmlFor={`edit-name-${space.id}`}>Name</label>
        <input
          id={`edit-name-${space.id}`}
          name="name"
          defaultValue={space.name}
          required
          maxLength={200}
        />
        <label htmlFor={`edit-kind-${space.id}`}>Kind</label>
        <select id={`edit-kind-${space.id}`} name="kind" defaultValue={space.kind}>
          {SPACE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <label htmlFor={`edit-reason-${space.id}`}>Reason (optional)</label>
        <input id={`edit-reason-${space.id}`} name="reason" maxLength={500} />
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </td>
  )
}
