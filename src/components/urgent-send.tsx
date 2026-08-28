/**
 * The Urgent Send's one control (#77, ADR 0028).
 *
 * **Two taps, and the count sits between them.** *This reaches 47 of 60 — 13
 * will not get it* is the whole reason a confirmation step exists here at all:
 * a sender who believes they told everyone and did not is the failure the
 * ticket exists to fix, and a single button that sent immediately would
 * reproduce it inside the app. Declining sends nothing, which is the acceptance
 * criterion this shape satisfies by construction — the first tap only asks.
 *
 * **`/reach` is read on the first tap and not on page load.** #67 gave Home one
 * request on purpose, and a count only a Domain Scope holder will ever act on
 * is not worth a second one on every phone that opens the screen.
 *
 * **What comes back is reported, not assumed.** `sent` against `recipients` is
 * how a half-delivered send stays visible; a bare *Sent* would be the confident
 * lie the whole channel is meant to replace.
 */
import { useState } from 'react'

import { Button } from './ui/button'
import { client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import { reachSentence } from '../shared/urgent'
import type { AnswersWrite, contract } from '../shared/api-contract'

/** What both Urgent Sends answer with — one shape, so this control is one control. */
type Sent = AnswersWrite<typeof contract, '/announcements/text'>

/** Whose reach to look up: everybody, or the people who could cover one Shift. */
export type Audience =
  { readonly kind: 'everyone' } | { readonly kind: 'shift'; readonly shiftId: string }

type Stage =
  | { readonly stage: 'idle' }
  | { readonly stage: 'asking' }
  | { readonly stage: 'confirming'; readonly sentence: string }
  | { readonly stage: 'sent'; readonly result: Sent }

export function UrgentSend({
  audience,
  label,
  onSend,
  disabled = false,
}: {
  audience: Audience
  /** What the first tap says. The count is deliberately not in it — it is not known yet. */
  label: string
  onSend: () => Promise<Sent>
  disabled?: boolean
}) {
  const [stage, setStage] = useState<Stage>({ stage: 'idle' })
  const [problem, setProblem] = useState<string | null>(null)

  if (stage.stage === 'sent') {
    return (
      <span role="status" className="text-sm text-muted-foreground">
        Texted {String(stage.result.sent)} of {String(stage.result.recipients)}.
        {stage.result.unreachable > 0 &&
          ` ${String(stage.result.unreachable)} could not be reached.`}
      </span>
    )
  }

  if (stage.stage === 'confirming') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{stage.sentence}</span>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setProblem(null)
            void onSend().then(
              (result) => {
                setStage({ stage: 'sent', result })
              },
              (error: unknown) => {
                setStage({ stage: 'idle' })
                setProblem(refusalText(error))
              },
            )
          }}
        >
          Send it
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setStage({ stage: 'idle' })
          }}
        >
          Not now
        </Button>
        {problem !== null && (
          <span role="alert" className="text-sm text-destructive">
            {problem}
          </span>
        )}
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || stage.stage === 'asking'}
        onClick={() => {
          setProblem(null)
          setStage({ stage: 'asking' })
          void client.get('/reach').then(
            (report) => {
              const reach =
                audience.kind === 'everyone'
                  ? report.everyone
                  : (report.shifts.find((one) => one.shiftId === audience.shiftId)?.reach ?? {
                      reachable: 0,
                      total: 0,
                    })
              setStage({
                stage: 'confirming',
                sentence: reachSentence(reach.reachable, reach.total),
              })
            },
            (error: unknown) => {
              setStage({ stage: 'idle' })
              setProblem(refusalText(error))
            },
          )
        }}
      >
        {stage.stage === 'asking' ? 'Checking…' : label}
      </Button>
      {problem !== null && (
        <span role="alert" className="text-sm text-destructive">
          {problem}
        </span>
      )}
    </span>
  )
}
