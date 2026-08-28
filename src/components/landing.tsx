/**
 * The public page at `/`, for a visitor with no session (#75, ADR 0028).
 *
 * **It exists because a carrier reads it.** 10DLC campaign vetting wants to
 * see what the messages are and how the people receiving them consented, and a
 * login form shows neither — so this is a genuine requirement rather than
 * decoration, and the reader who matters is a reviewer comparing this page
 * against the campaign's sample messages. Everything below therefore describes
 * what the application does **today**: no roadmap, no marketing claim, and no
 * term that is not already in `CONTEXT.md`.
 *
 * It lives in `src/components/` and not in `src/routes/`, deliberately. Every
 * file under `src/routes/` is a Destination the sidebar has to offer
 * (`src/shared/navigation.test.ts` reads them off disk and fails the build on
 * one that is missing), and a marketing page in a signed-in volunteer's
 * navigation is wrong on its face. `src/routes/index.tsx` renders this in the
 * one state it belongs in: `signed-out`.
 *
 * **The shell is already off.** #66 made a visitor with no session the third
 * bare case beside `/login` and `/board`, so there is no navigation chrome
 * here and nothing to remove — a menu of twenty Destinations in front of
 * somebody with no session is twenty ways to be refused.
 *
 * **The operator named below is the maintainer, personally, and that is not an
 * oversight.** ADR 0028 registers the Sole Proprietor brand to him rather than
 * to the rescue, as a deliberate deferral of ADR 0006's ownership question,
 * and a vetting reviewer matches this page against that brand. The ADR's
 * tripwire is what changes it: the day real volunteers depend on being texted,
 * the rescue registers its own brand against its own EIN, and this page names
 * the rescue instead.
 */
import { Link } from '@tanstack/react-router'

import { Button } from './ui/button'

/**
 * Who to write to. The maintainer's own address, because there is no support
 * alias and inventing one that reaches nobody is worse than a personal one
 * that does — the page has to give a reviewer somewhere to write.
 */
const CONTACT = 'rob@heckart.me'

const SECTION = 'mb-4 rounded-lg border border-border bg-background p-5 sm:p-6'
const LEAD = 'm-0 max-w-[52ch] text-base text-on-dark-muted'

export function Landing() {
  return (
    <main>
      <div className="mb-5 rounded-lg bg-brand-navy px-5 py-10 min-[600px]:px-8 min-[600px]:py-14">
        <h1 className="mb-3 text-4xl text-on-dark min-[600px]:text-5xl">Caballus</h1>
        <p className={LEAD}>
          Operations for a horse rescue: the daily care of horses, and the coordination of the
          volunteers who deliver it.
        </p>
        <p className={`${LEAD} mt-2`}>
          It is built for a volunteer working a shift in a barn, on a phone, outdoors, on poor
          signal.
        </p>
        <div className="mt-6">
          <Button asChild size="lg">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </div>

      <h2>What it is</h2>
      <section className={SECTION}>
        <p className="m-0">
          Caballus holds a rescue’s horses and its shift roster in one place: each horse’s record
          and feeding, the checklist a shift works through, who was there and for how long, and the
          reports a volunteer raises when something needs an officer’s attention.
        </p>
        <p className="m-0 mt-3">
          It is run by <strong>Rob Heckart</strong>, and it is used by one horse rescue in Maryland.
        </p>
      </section>

      <h2>You cannot sign yourself up</h2>
      <section className={SECTION}>
        <p className="m-0">
          There is no public sign-up, and there never has been. A{' '}
          <strong>Volunteer Coordinator</strong> at the rescue creates your record from your name,
          your email address and — if you give one — your mobile number, and that is the moment you
          are asked whether Caballus may text you. Your answer is recorded against your record with
          the date you gave it.
        </p>
        <p className="m-0 mt-3">
          You then sign in with a six-digit code sent to you. Nobody without a record can get in.
        </p>
      </section>

      <h2>What we send by text</h2>
      <section className={SECTION}>
        <p className="m-0">Two things, and nothing else, ever:</p>
        <ul className="m-0 mt-3 list-disc pl-5">
          <li className="mb-2">
            A <strong>shift you could work is short of people</strong> — so that somebody who is
            free can pick it up.
          </li>
          <li>
            <strong>Rescue news that will not keep</strong> until you next open the app.
          </li>
        </ul>
        <p className="m-0 mt-3 text-sm text-muted-foreground">
          Everything else the app has to say — the daily staffing summary, reports raised on a
          shift, and your sign-in code — goes by email. A real emergency is a phone call, and this
          is not one.
        </p>
        <p className="m-0 mt-3 text-sm text-muted-foreground">
          Message frequency varies and is low; there is a hard limit on how many the app will send
          in a day. Message and data rates may apply.
        </p>
      </section>

      <h2>How to stop</h2>
      <section className={SECTION}>
        <p className="m-0">
          Reply <strong>STOP</strong> to any text from us and the texts stop. Signing in still
          works: your sign-in code is not part of this, so stopping the texts never locks you out of
          the app.
        </p>
        <p className="m-0 mt-3">
          A Volunteer Coordinator can also take your number off your record, and you can change or
          remove it yourself once you are signed in.
        </p>
      </section>

      <h2>Getting in touch</h2>
      <section className={SECTION}>
        <p className="m-0">
          Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> — about the messages, about your
          record, or about anything else here.
        </p>
      </section>
    </main>
  )
}
