/**
 * The privacy policy, at `/privacy` (#80, ADR 0028).
 *
 * **It exists because a carrier reads it.** 10DLC campaign vetting requires a
 * privacy policy at a public URL, and requires three things to be in it: a
 * statement that mobile numbers are not shared, a note on how often messages
 * are sent, and the *message and data rates may apply* disclosure. All three
 * are below, and `privacy.test.tsx` asserts each one — a policy that lost its
 * non-sharing sentence to an edit is a rejected campaign a fortnight later.
 *
 * **It is a route rather than a component, unlike `landing.tsx`, because it
 * needs a URL of its own.** The campaign form takes a link, and a section of
 * `/` is not a link. That makes it the first file under `src/routes/` that is
 * not a Destination, so `src/shared/navigation.test.ts` names it as an
 * exclusion alongside `/login` — and `src/routes/__root.tsx` adds it to the
 * bare paths, because chrome offering twenty Destinations to a vetting
 * reviewer with no session is the shell drawn for nobody.
 *
 * **Everything below describes what the application does today.** No roadmap,
 * no marketing claim, and no promise the code does not keep: a policy that
 * overstates is worse than one that admits a gap, because the reader who
 * catches it is a regulator or a volunteer who trusted it.
 */
import { createFileRoute } from '@tanstack/react-router'

import { CONTACT, LegalPage, NO_SHARING, RATES, SECTION } from '../components/public'

export const Route = createFileRoute('/privacy')({
  component: Privacy,
})

function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      lead="What Caballus holds about you, who it is given to, and what you can do about it."
    >
      <h2>Who this is about</h2>
      <section className={SECTION}>
        <p className="m-0">
          Caballus is operated by <strong>Rob Heckart</strong> and used by one horse rescue in
          Maryland. This policy covers the application at caballus.tech and the text messages and
          emails it sends.
        </p>
        <p className="m-0 mt-3">
          There is no public sign-up. A <strong>Volunteer Coordinator</strong> at the rescue creates
          your record, so everything here starts with somebody at the rescue entering your details
          rather than with you filling in a form.
        </p>
      </section>

      <h2>Your mobile number is never shared</h2>
      <section className={SECTION}>
        <p className="m-0">
          <strong>{NO_SHARING}</strong>
        </p>
        <p className="m-0 mt-3">
          In plain words: your mobile number and your agreement to be texted are not sold, not
          rented, not passed to anybody else&rsquo;s marketing, and not shared outside the rescue
          and the company that puts the message on the network for us. There is no advertising in
          Caballus and there never has been.
        </p>
      </section>

      <h2>How often we text, and what it costs</h2>
      <section className={SECTION}>
        <p className="m-0">
          <strong>Message frequency varies and is low.</strong> A text goes out only when a shift
          you could work is short of people, or when there is rescue news that will not keep. In a
          normal month that is a handful of messages or none at all, and the application refuses to
          send more than 120 in any twenty-four hours across the whole roster.
        </p>
        <p className="m-0 mt-3">
          <strong>{RATES}</strong> Caballus charges you nothing; your own mobile plan is between you
          and your carrier.
        </p>
        <p className="m-0 mt-3">
          Your sign-in code is separate from all of this. It is not part of the alerts, and stopping
          the alerts never stops you signing in.
        </p>
      </section>

      <h2>What we hold</h2>
      <section className={SECTION}>
        <ul className="m-0 list-disc pl-5">
          <li className="mb-2">
            <strong>Your record</strong> — your name, your email address, your mobile number if you
            gave one, whether you agreed to be texted and the date you agreed, the roles you hold,
            and the orientation, release and — if you are under 18 — parental consent that let you
            be put on a roster.
          </li>
          <li className="mb-2">
            <strong>Your date of birth</strong>, where the rescue has it. The day and month are
            shown to volunteers because the rescue has a party; the year and your age are not, and
            being under 18 is shown as a fact rather than as a number.
          </li>
          <li className="mb-2">
            <strong>What you did</strong> — the shifts you were rostered on, when you arrived and
            left, the checklist items you ticked, the notes and reports you wrote, and who recorded
            each of those.
          </li>
          <li className="mb-2">
            <strong>An audit trail</strong> of changes to records, carrying who made the change and
            when. Care records are a history rather than a current value, so an entry is added
            rather than an old one erased.
          </li>
          <li>
            <strong>Sessions</strong> — a row saying you are signed in on a device. Signing out
            deletes it.
          </li>
        </ul>
        <p className="m-0 mt-3 text-sm text-muted-foreground">
          Caballus carries no message between two people. There is no chat, no inbox and no read
          receipt, and nothing tracks where you are.
        </p>
      </section>

      <h2>Who else sees it</h2>
      <section className={SECTION}>
        <p className="m-0">
          Inside the rescue: other volunteers see the barn&rsquo;s working information — the horses,
          the roster, who is on a shift. Your contact details, your age and the hours you worked are
          behind an officer&rsquo;s permission rather than open to everyone.
        </p>
        <p className="m-0 mt-3">Outside the rescue, only the companies that run the plumbing:</p>
        <ul className="m-0 mt-3 list-disc pl-5">
          <li className="mb-2">
            <strong>Twilio</strong> delivers the text messages and the sign-in codes sent to a
            mobile. It receives your number and the message.
          </li>
          <li className="mb-2">
            <strong>Our mail provider</strong> delivers sign-in codes, the evening staffing summary
            and report notices. It receives your email address and the message.
          </li>
          <li className="mb-2">
            <strong>Our hosting provider</strong> runs the server and the database the records sit
            in.
          </li>
          <li className="mb-2">
            <strong>Anthropic, through OpenRouter</strong>, reads a photograph of the barn&rsquo;s
            whiteboard when somebody at the desk asks it to. The photograph is not stored anywhere,
            and it is a picture of a board about horses.
          </li>
          <li>
            <strong>A weather service</strong> receives the barn&rsquo;s coordinates and nothing
            about any person.
          </li>
        </ul>
        <p className="m-0 mt-3">
          None of these is given anything for their own purposes, and none of them is given your
          mobile number for marketing. We also hand over information if the law requires it.
        </p>
      </section>

      <h2>How long it is kept</h2>
      <section className={SECTION}>
        <p className="m-0">
          The care record of a horse is kept for as long as the rescue exists, including after the
          horse has left — that history is the point of the application. What you did on a shift is
          part of that record.
        </p>
        <p className="m-0 mt-3">
          Sessions last about a year and are deleted when you sign out. If you leave the rescue,
          your account is revoked and you can no longer sign in; ask us if you want your contact
          details removed as well.
        </p>
      </section>

      <h2>What you can do</h2>
      <section className={SECTION}>
        <ul className="m-0 list-disc pl-5">
          <li className="mb-2">
            <strong>Stop the texts.</strong> Reply <strong>STOP</strong> to any text from us. You
            can still sign in afterwards.
          </li>
          <li className="mb-2">
            <strong>Change or remove your number and email</strong> yourself, once signed in, under
            your own details.
          </li>
          <li>
            <strong>Ask what we hold, or ask us to correct or delete it</strong> — write to{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we will answer.
          </li>
        </ul>
      </section>

      <h2>Under 18</h2>
      <section className={SECTION}>
        <p className="m-0">
          Volunteers under 18 are on the roster only with a parent or guardian&rsquo;s signed
          consent, held by the rescue. A parent or guardian may write to us about their
          child&rsquo;s record at the address above.
        </p>
      </section>

      <h2>Changes to this policy</h2>
      <section className={SECTION}>
        <p className="m-0">
          If this policy changes, the date at the top changes with it. A change that alters what we
          send by text or who sees your number is told to volunteers directly rather than left on
          this page to be noticed.
        </p>
      </section>
    </LegalPage>
  )
}
