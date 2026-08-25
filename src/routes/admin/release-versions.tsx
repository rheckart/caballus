/**
 * Release Versions: what has been published, and publishing another.
 *
 * A Version is immutable, so there is nothing on this screen that edits one —
 * a correction is a new Version, published without the obsoletes flag so it
 * invalidates nobody (ADR 0017). That is the whole of the immutability, and it
 * is why the screen offers no edit action rather than offering one that fails.
 *
 * The obsoletes-prior checkbox is the sharpest control in the application. Set
 * it, and every signature given before this Version's valid-from stales on the
 * next read of the people list — **flagged, never removed**, because a
 * re-papering would otherwise empty every roster in the system on a single
 * morning. The screen says so above the box rather than in a tooltip.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import {
  Actions,
  AddButton,
  Empty,
  Field,
  Fields,
  Loading,
  SaveButton,
  Saved,
  Sheet,
  useSaving,
} from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { client } from '../../shared/api-client'
import { refusalText } from '../../shared/refusals'
import type { Answers, contract } from '../../shared/api-contract'
import { dayString } from '../../shared/time'

export const Route = createFileRoute('/admin/release-versions')({
  component: ReleaseVersions,
})

type Versions = Answers<typeof contract, '/release-versions'>

function ReleaseVersions() {
  const [versions, setVersions] = useState<Versions | null>(null)
  const [day, setDay] = useState<string>('')
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // The checkbox's own state: shadcn's Checkbox is a Radix button rather than
  // a native input, so the value rides in the payload instead of in FormData.
  const [obsoletesPrior, setObsoletesPrior] = useState(false)
  const { pending, saved, save } = useSaving()

  const load = useCallback(async () => {
    const [published, today] = await Promise.all([
      client.get('/release-versions'),
      // The day from the server, in the organisation's timezone — a browser
      // deriving its own is right for most of the year and wrong at the edges
      // that matter (ADR 0007).
      client.get('/day'),
    ])
    setVersions(published)
    setDay(today.day)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [load])

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setProblem(null)
    void save(() =>
      client
        .post('/release-versions', {
          label: String(data.get('label') ?? ''),
          validFrom: dayString(String(data.get('validFrom') ?? '')),
          obsoletesPrior,
        })
        .then(async () => {
          form.reset()
          await load()
          setOpen(false)
        })
        .catch((error: unknown) => {
          setProblem(refusalText(error))
        }),
    )
  }

  return (
    <main>
      <h1 className="text-foreground">Release versions</h1>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        A version is one issue of the release text. It is immutable: a correction is a new version,
        and the current one is the newest. The signed papers stay in the cabinet; what is here is
        the record that they exist.
      </p>

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-foreground">Published, newest first</h2>
        <AddButton
          onClick={() => {
            setObsoletesPrior(false)
            setOpen(true)
          }}
        >
          Publish a version
        </AddButton>
      </div>

      {versions === null ? (
        <Loading what="versions" />
      ) : versions.versions.length === 0 ? (
        <Empty>Nothing published yet. The first version is the one everybody signs against.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Label</TableHead>
              <TableHead scope="col">Valid from</TableHead>
              <TableHead scope="col">Obsoleted prior signatures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.versions.map((version) => (
              <TableRow key={version.id}>
                <TableCell>{version.label}</TableCell>
                <TableCell>{version.validFrom}</TableCell>
                <TableCell>{version.obsoletesPrior ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {open && (
        <Sheet
          title="Publish a version"
          description="A version is immutable once published. A correction is another version."
          onClose={() => {
            setOpen(false)
          }}
        >
          <form onSubmit={publish}>
            <Fields>
              <Field label="Label" htmlFor="label" hint="What the paper itself says at the top.">
                <Input
                  id="label"
                  name="label"
                  required
                  maxLength={200}
                  placeholder="Updated 2020"
                  autoFocus
                  aria-describedby="label-hint"
                />
              </Field>
              <Field label="Valid from" htmlFor="valid-from">
                <Input id="valid-from" name="validFrom" type="date" defaultValue={day} required />
              </Field>
            </Fields>

            {/* The sharpest control in the application, so what it does is
                stated beside it at full size rather than in a hint. */}
            <div className="mt-5 rounded-md border border-destructive/30 border-l-3 border-l-destructive bg-destructive/4 p-4">
              <label
                htmlFor="obsoletes-prior"
                className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
              >
                <Checkbox
                  id="obsoletes-prior"
                  checked={obsoletesPrior}
                  onCheckedChange={(checked) => {
                    setObsoletesPrior(checked === true)
                  }}
                />
                Obsolete every prior signature
              </label>
              <p className="m-0 mt-2 text-sm text-muted-foreground">
                This stales every release signed before that date. Nobody is removed from any
                roster: they are flagged on the people list, and the Coordinator works the list.
              </p>
            </div>

            <Actions>
              <SaveButton pending={pending} pendingLabel="Publishing…">
                Publish
              </SaveButton>
              <Saved saved={saved} what="Published" />
            </Actions>
          </form>
        </Sheet>
      )}
    </main>
  )
}
