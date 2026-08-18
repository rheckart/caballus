/**
 * The three messages an Escalation sends, all email, because ADR 0009 leaves
 * exactly one channel (ADR 0014): to the destination Scope's holders when it
 * lands, to the reporter in full when it closes, and to both on a thread
 * comment. Reused from `src/server/email.ts` the way `src/server/shifts/digest.ts`
 * reuses it — one address failing must not stop the others arriving, so each
 * send is attempted and logged rather than allowed to fail the write.
 *
 * **Not coalesced.** ADR 0014 asks for delivery "coalesced per recipient over
 * roughly ten minutes," which needs a scheduler this application does not
 * have yet (ADR 0007: nothing here runs on a bare interval). Sent immediately
 * instead — a known gap, and the dilution risk ADR 0009 already accepted, not
 * a new one.
 */
import type { OrgScopedDatabase } from '../../db/for-org'
import type { DomainScope } from '../../shared/domain-scopes'
import type { DayString } from '../../shared/time'
import { EmailNotSentError, sendEmail } from '../email'
import { log } from '../observability'
import { peopleList } from '../roster/people'

async function scopeHolderEmails(
  db: OrgScopedDatabase,
  today: DayString,
  scope: DomainScope,
): Promise<readonly string[]> {
  const people = await peopleList(db, today, true)
  return people
    .filter((person) => person.domainScopes.includes(scope))
    .map((person) => person.behindRoster?.email)
    .filter((email): email is string => email !== undefined)
}

async function deliver(
  to: readonly string[],
  message: { readonly subject: string; readonly text: string },
  about: Record<string, unknown>,
): Promise<void> {
  for (const recipient of to) {
    try {
      await sendEmail({ to: recipient, ...message })
    } catch (cause) {
      // Logged rather than thrown: the record this mail is about already
      // exists, the same way the close gate ADR 0014 describes is satisfied
      // by recording rather than by arrival.
      log('warn', 'escalation_mail_not_sent', {
        ...about,
        to: recipient,
        because: cause instanceof EmailNotSentError ? cause.because : String(cause),
      })
    }
  }
}

/** To the destination Scope's holders, when an Escalation lands. */
export async function notifyEscalated(
  db: OrgScopedDatabase,
  clock: { readonly today: DayString; readonly organisation: string },
  about: {
    readonly scope: DomainScope
    readonly framing: string
    readonly observationText: string
  },
): Promise<void> {
  const to = await scopeHolderEmails(db, clock.today, about.scope)
  await deliver(
    to,
    {
      subject: `${clock.organisation}: an Escalation addressed to ${about.scope}`,
      text: [about.framing, '', `The Observation: ${about.observationText}`].join('\n'),
    },
    { kind: 'escalated', scope: about.scope },
  )
}

/** To the reporter alone, carrying the closing note in full — never a teaser. */
export async function notifyClosed(
  organisation: string,
  reporterEmail: string | null,
  about: { readonly closingNote: string },
): Promise<void> {
  if (reporterEmail === null) return
  await deliver(
    [reporterEmail],
    { subject: `${organisation}: your report was closed`, text: about.closingNote },
    { kind: 'closed' },
  )
}

/** To the destination Scope's holders and the reporter — two parties with standing, no subscription model. */
export async function notifyCommented(
  db: OrgScopedDatabase,
  clock: { readonly today: DayString; readonly organisation: string },
  scope: DomainScope,
  reporterEmail: string | null,
  about: { readonly text: string },
): Promise<void> {
  const holders = await scopeHolderEmails(db, clock.today, scope)
  const to = reporterEmail === null ? holders : [...new Set([...holders, reporterEmail])]
  await deliver(
    to,
    { subject: `${clock.organisation}: a new comment on an Escalation`, text: about.text },
    { kind: 'comment', scope },
  )
}
