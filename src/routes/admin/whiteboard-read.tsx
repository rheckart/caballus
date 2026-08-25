/**
 * The Whiteboard Read: photograph one panel of the rescue's paper board, and
 * it becomes records (ADR 0023, #59).
 *
 * A setup screen, used a handful of times and then never again — so it is a
 * dropdown, a file input and a button, and everything else on it is the
 * report. **The panel is chosen by a person before shooting**, because barns
 * structure their boards differently and a misclassified panel writes to the
 * wrong tables; it is one tap by somebody already holding the phone.
 *
 * The file input takes a fresh photograph **or one already in the gallery**:
 * the panels are usually shot on a walk round the barn and read at the desk
 * afterwards, so forcing the camera would refuse the ordinary case.
 *
 * The image is read to base64 here and sent inside the payload (ADR 0021).
 * Nothing stores it: not this screen, not the server, not IndexedDB — the
 * write declares `neverQueued`, so a failed send is retried by pressing the
 * button again rather than by holding five megabytes in a pocket (ADR 0018).
 */
import { createFileRoute } from '@tanstack/react-router'
import { useState, type ChangeEvent, type FormEvent } from 'react'

import { Actions, Empty, Field, Fields, SaveButton, useSaving } from '../../components/forms'
import { Refusal } from '../../components/refusal'
import { Alert, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { client } from '../../shared/api-client'
import type { AnswersWrite, contract } from '../../shared/api-contract'
import { refusalText } from '../../shared/refusals'
import {
  imageFits,
  MOST_IMAGE_BASE64_CHARS,
  PANEL_HINT,
  PANEL_LABEL,
  RECORD_LABEL,
  WHITEBOARD_IMAGE_TYPES,
  WHITEBOARD_PANELS,
  type WhiteboardImageType,
  type WhiteboardPanel,
} from '../../shared/whiteboard'

export const Route = createFileRoute('/admin/whiteboard-read')({
  component: WhiteboardRead,
})

type Report = AnswersWrite<typeof contract, '/whiteboard-read'>

const PANEL_OPTIONS = WHITEBOARD_PANELS.map((panel) => ({
  value: panel,
  label: PANEL_LABEL[panel],
}))

interface Photo {
  readonly base64: string
  readonly mediaType: WhiteboardImageType
  readonly fileName: string
}

function WhiteboardRead() {
  const [panel, setPanel] = useState<WhiteboardPanel>('grid')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const { pending, save } = useSaving()

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    setProblem(null)
    setReport(null)
    const file = event.currentTarget.files?.[0]
    if (file === undefined) {
      setPhoto(null)
      return
    }
    const mediaType = file.type
    if (!isImageType(mediaType)) {
      setPhoto(null)
      setProblem('That is not a photograph. Shoot the panel as a JPEG, PNG or WebP.')
      return
    }

    void readAsBase64(file)
      .then((base64) => {
        // Refused here, in words, rather than sent and rejected downstream:
        // somebody holding a phone needs to be told to shoot it again.
        if (!imageFits(base64)) {
          setPhoto(null)
          setProblem(
            `That photograph is too big — the limit is about ${String(Math.round(MOST_IMAGE_BASE64_CHARS / 1_400_000))} megabytes. Shoot it again at a smaller size.`,
          )
          return
        }
        setPhoto({ base64, mediaType, fileName: file.name })
      })
      .catch(() => {
        setPhoto(null)
        setProblem('That file could not be read.')
      })
  }

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // In words, like everything else on this screen: the file input is not
    // `required`, because a photograph rejected for its size clears the choice
    // and the browser's own bubble would then say nothing useful about why.
    if (photo === null) {
      setProblem('Choose a photograph of the panel first.')
      return
    }
    setProblem(null)
    setReport(null)
    void save(() =>
      client
        .post('/whiteboard-read', {
          panel,
          mediaType: photo.mediaType,
          image: photo.base64,
        })
        .then(setReport),
    ).catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }

  return (
    <main>
      <h1 className="text-foreground">Read the whiteboard</h1>

      <p className="mb-5 max-w-[68ch] text-base leading-relaxed text-muted-foreground">
        One photograph of one panel becomes records. It only ever adds: a name already on file is
        skipped and named back, so running the same panel twice cannot overwrite a correction. The
        photograph itself is never stored.
      </p>

      {problem !== null && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>
            <Refusal>{problem}</Refusal>
          </AlertTitle>
        </Alert>
      )}

      <form onSubmit={send}>
        <Fields>
          <div className="sm:col-span-2">
            <Field label="Which panel is this?" htmlFor="whiteboard-panel" hint={PANEL_HINT[panel]}>
              <Select
                value={panel}
                onValueChange={(next) => {
                  setPanel(next as WhiteboardPanel)
                  setReport(null)
                }}
              >
                <SelectTrigger id="whiteboard-panel" aria-label="Which panel is this?">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PANEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="The photograph"
              htmlFor="whiteboard-photo"
              hint="Take one now, or pick one already on the phone."
            >
              {/*
               * `accept` and **no `capture`**. `capture` forces the camera and
               * hides the gallery, which is wrong for the ordinary case: the
               * panels were photographed on a walk round the barn and the
               * reading happens at the desk afterwards, off a phone that
               * already has them.
               */}
              <Input
                id="whiteboard-photo"
                name="photo"
                type="file"
                accept={WHITEBOARD_IMAGE_TYPES.join(',')}
                onChange={choose}
              />
            </Field>
            {photo !== null && (
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                Ready to read: {photo.fileName}
              </p>
            )}
          </div>
        </Fields>

        <Actions>
          <SaveButton pending={pending} pendingLabel="Reading…">
            Read this panel
          </SaveButton>
        </Actions>
      </form>

      {report !== null && <Report report={report} />}
    </main>
  )
}

/**
 * The report **is** the answer, not a table (ADR 0023). Four sections and the
 * things to check, and a section with nothing in it is left off rather than
 * shown empty — an empty heading reads as a gap when it is an absence.
 */
function Report({ report }: { report: Report }) {
  const nothing =
    report.created.length === 0 &&
    report.skipped.length === 0 &&
    report.blank.length === 0 &&
    report.couldNotPlace.length === 0

  return (
    <section className="mb-4 mt-6 rounded-lg border border-border bg-background p-4 sm:p-6">
      <h2 className="mt-0 text-foreground">What that panel said</h2>

      {nothing && <Empty>Nothing was read off it. Try a straighter, brighter shot.</Empty>}

      {report.check.length > 0 && (
        <>
          <h3 className="text-foreground">Check these</h3>
          <ul role="list" className="m-0 mb-4 list-none p-0">
            {report.check.map((sentence, at) => (
              // Keyed by position: two rows that were unreadable in the same
              // way produce the same sentence, and the list never reorders.
              <li key={`${String(at)} ${sentence}`} className="mb-1 last:mb-0">
                {sentence}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.created.length > 0 && (
        <>
          <h3 className="text-foreground">Created</h3>
          <ul role="list" className="m-0 mb-4 list-none p-0">
            {report.created.map((entry) => (
              <li key={entry.id} className="mb-1 last:mb-0">
                <Badge className="mr-1">{RECORD_LABEL[entry.record]}</Badge> {entry.name}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.skipped.length > 0 && (
        <>
          <h3 className="text-foreground">Already on file</h3>
          <ul role="list" className="m-0 mb-4 list-none p-0">
            {report.skipped.map((entry, at) => (
              <li key={`${String(at)} ${entry.record} ${entry.name}`} className="mb-1 last:mb-0">
                <Badge className="mr-1">{RECORD_LABEL[entry.record]}</Badge> {entry.name}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.blank.length > 0 && (
        <>
          <h3 className="text-foreground">Left blank</h3>
          <p className="m-0 mb-2 text-sm text-muted-foreground">
            Not clearly legible, so nothing was recorded. Go and look at the board.
          </p>
          <ul role="list" className="m-0 mb-4 list-none p-0">
            {report.blank.map((sentence, at) => (
              // Keyed by position: two rows that were unreadable in the same
              // way produce the same sentence, and the list never reorders.
              <li key={`${String(at)} ${sentence}`} className="mb-1 last:mb-0">
                {sentence}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.couldNotPlace.length > 0 && (
        <>
          <h3 className="text-foreground">Could not be placed</h3>
          <ul role="list" className="m-0 mb-4 list-none p-0">
            {report.couldNotPlace.map((sentence, at) => (
              // Keyed by position: two rows that were unreadable in the same
              // way produce the same sentence, and the list never reorders.
              <li key={`${String(at)} ${sentence}`} className="mb-1 last:mb-0">
                {sentence}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function isImageType(mediaType: string): mediaType is WhiteboardImageType {
  return (WHITEBOARD_IMAGE_TYPES as readonly string[]).includes(mediaType)
}

/** The bytes as the payload carries them, and the only place they ever exist. */
async function readAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // A chunk at a time: `String.fromCharCode(...bytes)` on a five-megabyte
  // photograph is an argument list long enough to blow the stack.
  const CHUNK = 8192
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(binary)
}
