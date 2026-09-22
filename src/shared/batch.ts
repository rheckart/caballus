/**
 * The most records one batch act may name (#99, #100).
 *
 * **Bulk means one change applied to many records, never a spreadsheet**: a
 * batch is the single write's effect and audit entry, repeated, under one key
 * (ADR 0020). A cap rather than none, because a "select all" over a filter
 * that failed to filter should not be a thousand rows in one transaction;
 * two hundred is past every herd and every roster this rescue has.
 */
export const MOST_AT_ONCE = 200

/**
 * Why a batch left one horse alone (#99). Partial, never all-or-nothing: one
 * Departed horse in a herd of twelve does not keep the other eleven in.
 */
export const HORSE_BATCH_SKIPS = ['horse_not_found', 'horse_departed'] as const

export type HorseBatchSkip = (typeof HORSE_BATCH_SKIPS)[number]

/**
 * Why a batch left one volunteer alone, per act (#100) — each the single
 * write's own refusal, or the state already being what the batch asks for.
 */
export const VOLUNTEER_BATCH_SKIPS = {
  orientation: ['volunteer_not_found', 'date_of_birth_not_established', 'already_oriented'],
  release: [
    'volunteer_not_found',
    'date_of_birth_not_established',
    'self_recorded',
    'already_signed',
  ],
  roles: ['volunteer_not_found', 'already_held', 'self_granted'],
  medicationAuthority: ['volunteer_not_found', 'already_held', 'not_held'],
  smsConsent: ['volunteer_not_found', 'already_off'],
} as const

export type VolunteerBatchAct = keyof typeof VOLUNTEER_BATCH_SKIPS

export type VolunteerBatchSkip<A extends VolunteerBatchAct = VolunteerBatchAct> =
  (typeof VOLUNTEER_BATCH_SKIPS)[A][number]

/** The words a desk shows beside a skipped name — one place, so two screens cannot differ. */
export const BATCH_SKIP_WORDS: Record<HorseBatchSkip | VolunteerBatchSkip, string> = {
  horse_not_found: 'no longer on the books',
  horse_departed: 'has Departed',
  volunteer_not_found: 'no longer with the rescue',
  date_of_birth_not_established: 'no date of birth recorded yet',
  already_oriented: 'already oriented',
  self_recorded: 'you cannot record your own Release',
  already_signed: 'already signed this Version',
  already_held: 'already holds it',
  self_granted: 'you cannot grant yourself a Role',
  not_held: 'did not hold it',
  already_off: 'texts were already off',
}
