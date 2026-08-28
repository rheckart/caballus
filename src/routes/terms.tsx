/**
 * The terms and conditions, at `/terms` (#80, ADR 0028).
 *
 * **It exists because a carrier reads it.** 10DLC campaign vetting requires
 * terms at a public URL carrying a named list: what the message programme is,
 * how often it sends, that message and data rates may apply, how to get help,
 * how to stop, that carriers are not liable for an undelivered message, and a
 * link to the privacy policy. Every one of them is below, and `terms.test.tsx`
 * asserts the ones a wording change could quietly drop.
 *
 * **The SMS half is the reason the file exists, and the rest is honest about
 * what Caballus is** — a volunteer project one rescue uses, with no warranty
 * anybody could rely on. Overstating here would be worse than the gap: the
 * reader who catches it is a reviewer or a volunteer who trusted it.
 *
 * Like `privacy.tsx` this is a route rather than a component, because the
 * campaign form takes a link and a section of `/` is not one — so it is named
 * as an exclusion in `src/shared/navigation.test.ts` and added to the bare
 * paths in `src/routes/__root.tsx`.
 */
import { Link, createFileRoute } from '@tanstack/react-router'

import { CONTACT, LegalPage, RATES, SECTION } from '../components/public'

export const Route = createFileRoute('/terms')({
  component: Terms,
})

function Terms() {
  return (
    <LegalPage
      title="Terms and conditions"
      lead="The rules for the Caballus text alerts, and for the application they come from."
    >
      <h2>The message programme</h2>
      <section className={SECTION}>
        <p className="m-0">
          <strong>Caballus Volunteer Alerts</strong> is operated by <strong>Rob Heckart</strong> for
          one horse rescue in Maryland. It sends a text message in two situations, and no others,
          ever:
        </p>
        <ul className="m-0 mt-3 list-disc pl-5">
          <li className="mb-2">
            a <strong>shift you could work is short of people</strong>, so somebody free can pick it
            up; and
          </li>
          <li>
            <strong>rescue news that will not keep</strong> until you next open the application.
          </li>
        </ul>
        <p className="m-0 mt-3">
          Everything else — your sign-in code, the evening staffing summary, and reports raised on a
          shift — goes by email. <strong>A real emergency is a phone call, not a text.</strong>
        </p>
      </section>

      <h2>Who can be on it, and how you got on it</h2>
      <section className={SECTION}>
        <p className="m-0">
          There is no public sign-up and no way to join by texting a keyword. A{' '}
          <strong>Volunteer Coordinator</strong> at the rescue creates your record from your name,
          your email address and — if you give one — your mobile number, and asks you at that moment
          whether Caballus may text you. Your answer is stored against your record with the date you
          gave it.
        </p>
        <p className="m-0 mt-3">
          You must be a volunteer at the rescue to use Caballus. When you stop being one, your
          account is revoked and the texts stop with it.
        </p>
      </section>

      <h2>Frequency, cost, help and stopping</h2>
      <section className={SECTION}>
        <ul className="m-0 list-disc pl-5">
          <li className="mb-2">
            <strong>Frequency.</strong> Message frequency varies and is low — a handful in a normal
            month, and often none. The application will not send more than 120 messages in any
            twenty-four hours across the whole roster.
          </li>
          <li className="mb-2">
            <strong>Cost.</strong> {RATES} Caballus charges you nothing for them.
          </li>
          <li className="mb-2">
            <strong>Help.</strong> Reply <strong>HELP</strong> to any message, or write to{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </li>
          <li className="mb-2">
            <strong>Stopping.</strong> Reply <strong>STOP</strong> to any message and the texts
            stop. <strong>Signing in still works</strong> — your sign-in code is not part of this
            programme, so stopping the texts never locks you out of the application.
          </li>
          <li>
            <strong>Starting again.</strong> Text START to the same number — your carrier decides,
            not us — then ask a Volunteer Coordinator, or clear it yourself under your own details
            once signed in.
          </li>
        </ul>
      </section>

      <h2>Delivery is not guaranteed</h2>
      <section className={SECTION}>
        <p className="m-0">
          <strong>
            Carriers are not liable for delayed or undelivered messages, and neither are we.
          </strong>{' '}
          Delivery depends on your carrier, your handset and your signal, and none of the three is
          ours. Do not rely on a text arriving: the shift roster, the announcements and everything
          else a text mentions are in the application, which is where they stay true.
        </p>
        <p className="m-0 mt-3">
          There are no read receipts and nobody is told twice. If a shift is short and nobody picks
          it up, nobody saw it.
        </p>
      </section>

      <h2>Using the application</h2>
      <section className={SECTION}>
        <ul className="m-0 list-disc pl-5">
          <li className="mb-2">
            Your sign-in code is yours. Do not pass it on, and do not let somebody else use your
            account — what you record is credited to you.
          </li>
          <li className="mb-2">
            What you write about a horse or a shift is a record the rescue keeps. Records are added
            to rather than erased, and changes carry your name.
          </li>
          <li>
            Record what actually happened. A checklist ticked for work nobody did is worse than an
            empty one, because a horse is on the other end of it.
          </li>
        </ul>
      </section>

      <h2>No warranty</h2>
      <section className={SECTION}>
        <p className="m-0">
          Caballus is provided as it is, with no warranty of any kind. It is a small project run by
          one person for one rescue, and it can be unavailable, wrong or interrupted. It is not a
          substitute for a vet, and it is not an emergency service.
        </p>
        <p className="m-0 mt-3">
          To the extent the law allows, the operator is not liable for any loss arising from using
          it or from a message that did not arrive.
        </p>
      </section>

      <h2>Changes, and getting in touch</h2>
      <section className={SECTION}>
        <p className="m-0">
          These terms can change; the date at the top changes with them. What we do with your
          details is in the <Link to="/privacy">privacy policy</Link>.
        </p>
        <p className="m-0 mt-3">
          Write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> about the messages, your record, or
          anything else here.
        </p>
      </section>
    </LegalPage>
  )
}
