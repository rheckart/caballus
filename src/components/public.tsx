/**
 * The frame the three pages a visitor with no session can read are built from
 * (#75, #80, ADR 0028).
 *
 * There are three of them and there will not be a fourth without a reason: the
 * public page at `/`, the privacy policy at `/privacy`, and the terms at
 * `/terms`. All three exist because **a carrier reads them** — 10DLC campaign
 * vetting wants a public URL describing the messages, a privacy policy stating
 * that mobile numbers are not shared, and terms carrying the frequency, the
 * rates disclosure and the two keywords. None of it is decoration, and the
 * reader who matters is a reviewer comparing the three against the campaign's
 * sample messages.
 *
 * The constants live here rather than in `landing.tsx` because a second copy of
 * the maintainer's address is a second thing to get wrong on the day ADR 0028's
 * tripwire fires and the rescue registers its own brand: one address, one
 * effective date, one section style, changed once.
 */
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * Who to write to. The maintainer's own address, because there is no support
 * alias and inventing one that reaches nobody is worse than a personal one
 * that does — the page has to give a reviewer somewhere to write.
 */
export const CONTACT = 'rob@heckart.me'

/**
 * When these documents last changed, in words rather than a `Date`.
 *
 * A rendered `new Date()` would say *today* forever, which is the one thing a
 * policy's date must never do: a reviewer checking whether a document is
 * current would be told yes by a page that had not been edited in a year.
 * Editing this string is part of editing the documents.
 */
export const LAST_UPDATED = '28 August 2026'

export const SECTION = 'mb-4 rounded-lg border border-border bg-background p-5 sm:p-6'
export const LEAD = 'm-0 max-w-[52ch] text-base text-on-dark-muted'

/**
 * The carrier's own required sentence about mobile numbers, and it is quoted
 * rather than paraphrased.
 *
 * Vetting looks for this wording. A plain-English restatement sits beside it on
 * the page, because a volunteer is the other reader and this sentence is not
 * written for them — but the restatement never replaces it.
 */
export const NO_SHARING =
  'No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. All other categories exclude text messaging originator opt-in data and consent; this information will not be shared with any third parties.'

/** The disclosure that has to appear wherever the messages are described. */
export const RATES = 'Message and data rates may apply.'

/**
 * A legal page: a heading, the date, the prose, and the way back.
 *
 * The footer cross-links the other two public pages, because a reviewer lands
 * on whichever URL was typed into the campaign form and has to be able to reach
 * the rest from it — and because a volunteer who followed a link out of the app
 * needs a door back.
 */
export function LegalPage({
  title,
  lead,
  children,
}: Readonly<{ title: string; lead: string; children: ReactNode }>) {
  return (
    <main>
      <div className="mb-5 rounded-lg bg-brand-navy px-5 py-8 min-[600px]:px-8 min-[600px]:py-10">
        <h1 className="mb-3 text-3xl text-on-dark min-[600px]:text-4xl">{title}</h1>
        <p className={LEAD}>{lead}</p>
        <p className="m-0 mt-2 max-w-[52ch] text-sm text-on-dark-muted">
          Last updated {LAST_UPDATED}.
        </p>
      </div>

      {children}

      <nav className={SECTION} aria-label="The rest of the public pages">
        <p className="m-0 text-sm">
          <Link to="/">About Caballus</Link> · <Link to="/privacy">Privacy policy</Link> ·{' '}
          <Link to="/terms">Terms and conditions</Link>
        </p>
        <p className="m-0 mt-3 text-sm">
          Questions about any of this: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </nav>
    </main>
  )
}
