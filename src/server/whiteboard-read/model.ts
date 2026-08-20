/**
 * Where a Whiteboard Read's reading comes from, and **the only module in this
 * application that knows the model API** — the shape `src/server/weather/providers.ts`
 * holds for the forecast, and for the same reason (ADR 0023, #59).
 *
 * The phone sends bytes; the server calls out. The key lives in the
 * environment beside `BOARD_TOKEN` and `BARN_LATITUDE`, and **unset fails
 * closed**: `whiteboardReader` answers `null` and the endpoint refuses in
 * words, rather than a development box quietly making a paid call or a
 * production one failing obscurely.
 *
 * **What comes back is loose on purpose.** Structured outputs guarantee the
 * JSON's shape; they cannot guarantee that `paddock` is a Space kind this build
 * knows or that `feed_am` is a Shift Type. So every enum here is a plain string
 * and `records.ts` parses each element against the contract's own schemas — a
 * field that does not parse is reported as could-not-place, never coerced
 * (ADR 0023). One misread cell costs that cell rather than the panel.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { PANEL_RECORDS, RECORD_LABEL, type WhiteboardPanel } from '../../shared/whiteboard'

/**
 * `claude-sonnet-5`, named by #59 rather than chosen here.
 *
 * A Whiteboard Read is a one-time setup act reading a photograph of a
 * whiteboard, which is a transcription problem rather than a reasoning one.
 */
const MODEL = 'claude-sonnet-5'

/**
 * How long the model gets.
 *
 * Long, and the cost is honest: `mutation` opens the transaction before the
 * handler runs (ADR 0020), so this holds a pooled connection for as long as it
 * is allowed to take, on a box with one Postgres (ADR 0006). Weather takes
 * five seconds because it runs on a schedule; this is one person at a desk
 * pressing a button once, at setup, so a long call by one caller is what the
 * feature is. A ceiling all the same, because a request with no ceiling is a
 * connection held until the container restarts — and the ceiling is the whole
 * of it, because `maxRetries` is zero: the SDK's own retry would double the
 * hold to four minutes without the caller ever being told, and a person at a
 * desk can press the button again for less than the price of a second paid
 * call.
 */
const TIMEOUT_MILLIS = 120_000

/** Room for ten horse rows with their feed cells, and no more than that needs. */
const MAX_TOKENS = 16_000

/**
 * One reading, as the model gives it: every enum a plain string, because what
 * this build's vocabularies actually contain is `records.ts`'s question.
 */
const reading = z.object({
  spaces: z.array(z.object({ kind: z.string(), name: z.string() })),
  horses: z.array(
    z.object({
      name: z.string(),
      halterColour: z.string().nullable(),
      blanketSize: z.string().nullable(),
      height: z.string().nullable(),
      spaces: z.array(z.object({ kind: z.string(), name: z.string() })),
      feedings: z.array(
        z.object({
          shiftType: z.string(),
          lines: z.array(
            z.object({
              productName: z.string(),
              productKind: z.string(),
              prescription: z.boolean(),
              amount: z.string(),
              route: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
  contacts: z.array(
    z.object({
      name: z.string(),
      number: z.string(),
      hours: z.string().nullable(),
      purpose: z.string(),
    }),
  ),
  standingRules: z.array(z.object({ text: z.string() })),
  blank: z.array(z.string()),
  couldNotPlace: z.array(z.string()),
})

export type WhiteboardReading = z.infer<typeof reading>

/** The photograph, as it arrived in the payload and as it is passed on — never stored. */
export interface Photograph {
  readonly panel: WhiteboardPanel
  readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  readonly base64: string
}

/** Reads one panel. Injectable, so nothing in the test suite makes a paid call. */
export type WhiteboardReader = (photograph: Photograph) => Promise<WhiteboardReading>

/** The model would not answer. The caller refuses; nothing is written. */
export class ReadingFailed extends Error {
  constructor(readonly because: string) {
    super(`The whiteboard could not be read: ${because}`)
    this.name = 'ReadingFailed'
  }
}

let reader: WhiteboardReader | null | undefined

/**
 * Overrides the reader, or turns reading off entirely with `null`.
 *
 * The shape `setEmailTransport` has, for the same two reasons: it is the kill
 * switch reachable from a running process, and it is how the test suite proves
 * every rule in this feature without a network or a bill.
 */
export function setWhiteboardReader(replacement: WhiteboardReader | null): void {
  reader = replacement
}

/**
 * The reader this deployment has, or `null` for none — an unset key, or the
 * switch above thrown.
 */
export function whiteboardReader(): WhiteboardReader | null {
  if (reader !== undefined) return reader
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  if (key === '') return null
  return (photograph) => askTheModel(key, photograph)
}

async function askTheModel(key: string, photograph: Photograph): Promise<WhiteboardReading> {
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MILLIS, maxRetries: 0 })

  let answer
  try {
    answer = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(photograph.panel),
      output_config: { format: zodOutputFormat(reading) },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: photograph.mediaType,
                data: photograph.base64,
              },
            },
            { type: 'text', text: userPrompt(photograph.panel) },
          ],
        },
      ],
    })
  } catch (error: unknown) {
    throw new ReadingFailed(error instanceof Error ? error.message : 'unknown failure')
  }

  // A refusal is an HTTP 200 with no parsed output, so it is checked rather
  // than caught (the SDK's own `stop_reason` note).
  if (answer.parsed_output === null || answer.parsed_output === undefined) {
    throw new ReadingFailed(
      answer.stop_reason === 'refusal'
        ? 'the model declined it'
        : 'the model answered with nothing',
    )
  }
  return answer.parsed_output
}

/**
 * The rules that make a Whiteboard Read safe, said to the model (ADR 0023).
 *
 * **No confidence scores anywhere.** A model's own confidence is not
 * calibrated and would be trusted anyway, so the instruction is the blunt one:
 * a cell that is not clearly legible is left out and named in `blank`, which
 * is the same rule a blank Item already follows.
 */
function systemPrompt(panel: WhiteboardPanel): string {
  return [
    'You are reading one photographed panel of a horse rescue’s paper whiteboard so that it can become records in their app. Transcribe; do not interpret.',
    '',
    'Rules, in order of importance:',
    '1. If a cell is not clearly legible, LEAVE IT OUT and add a short sentence to `blank` saying which cell it was, in words somebody could use to go and look at the board. Never guess. Never score your own confidence.',
    '2. Anything you can read but cannot place in the fields below goes verbatim into `couldNotPlace`.',
    '3. Amounts are free text. Copy `2 cups Senior` and `2 wells` exactly as written. Never do arithmetic and never convert a unit.',
    '4. Standing rules are copied verbatim, with no interpretation.',
    '',
    'Spaces read as:',
    '- `2 & 3` is ONE Space of kind `stall` named `2 & 3`. Never two.',
    '- `7 OPEN` is a Space of kind `stall` named `7`, with no horse in it.',
    '- `Small Barn` is a Space of kind `barn`.',
    '- The grid’s turnout letters are kind `pasture`.',
    '- The hay panel’s `Paddocks A–D` are kind `paddock`. A pasture and a paddock are different places and a horse can be in both.',
    '',
    'Products come out of the feed cells; there is no product list panel. For each one:',
    '- `productKind` is `feed`, `supplement`, `medication`, or `topical`. Topical is what goes ON a horse rather than in it — fly spray, sunblock, zinc oxide. Never call one a medication.',
    '- `route` is `in_feed`, `oral_syringe`, `topical`, or `other`.',
    '- `shiftType` is `feed_am`, `feed_pm`, or `lunch`.',
    '- `prescription` is true only for a drug that genuinely needs a prescription. Previcox is firocoxib and does; Elevate is vitamin E and does not. No board says this, so propose it from the drug name — a person checks every one you propose.',
    '',
    'Do not read the ALERT column. Do not read the GROOM column or any task assignment. Do not read reminders as announcements. Do not invent suppliers.',
    '',
    `This panel writes only: ${PANEL_RECORDS[panel].map((record) => RECORD_LABEL[record]).join(', ')}. Leave every other array empty.`,
  ].join('\n')
}

function userPrompt(panel: WhiteboardPanel): string {
  return `This is the ${panel} panel of the board. Read it.`
}
