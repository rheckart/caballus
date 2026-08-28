/**
 * The Urgent Send, through the API application's own fetch entry (#77, ADR
 * 0028) — the same primary seam and the same real-Postgres discipline the rest
 * of these suites use.
 *
 * What is claimed here is the ticket's own acceptance. **Declining sends
 * nothing**: declaring Short and posting an Announcement are untouched, and the
 * send is a second endpoint nobody has to call. **The reachable count is
 * answered before the send**, from the same derivation the fan-out walks.
 * **Somebody with no number, no consent or a STOP against them is excluded and
 * counted in the shortfall.** **The hundred-and-twenty-first message in a day
 * is refused, loudly.** **With no configuration every send refuses** rather
 * than reaching nobody quietly. And **no test makes a paid call** — the
 * transport is replaced in `beforeEach`, which is what it is injectable for.
 *
 * Skipped, loudly, on a machine with no database: `docker compose up -d`,
 * then `psql -f scripts/provision-database.sql` and `npm run db:migrate`.
 */
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeDb } from '../../db/for-org'
import { postgresIdempotency } from '../../db/idempotency'
import { API_BASE, newIdempotencyKey } from '../../shared/api-client'
import { contract } from '../../shared/api-contract'
import type { DomainScope } from '../../shared/domain-scopes'
import { today } from '../time'
import type { DayString } from '../../shared/time'
import { anonymousContext } from '../request-context'
import { DAILY_CAP, forgetTextsForTest, setSmsTransport, type OutgoingText } from '../sms'
import { buildApi } from './app'

const applicationUrl = process.env.DATABASE_URL ?? ''
const ownerUrl = process.env.ADMIN_DATABASE_URL ?? ''
const reachable = applicationUrl !== '' && ownerUrl !== ''

const SHOUT_BARN = '00000000-0000-0000-0000-0000000000fc'
const TIME_ZONE = 'America/New_York'

describe.skipIf(!reachable)('the Urgent Send, through the API', () => {
  const owner = postgres(ownerUrl, { max: 1 })

  /** Every text the run sent, in order. Nothing here reaches a carrier. */
  let texted: OutgoingText[] = []

  function apiAs(volunteerId: string, scopes: readonly DomainScope[]) {
    return buildApi({
      idempotency: postgresIdempotency(),
      context: (request) => ({
        ...anonymousContext(request),
        actor: { volunteerId, domainScopes: scopes },
      }),
    })
  }

  function url(path: string): string {
    return `http://barn.invalid${API_BASE}${path}`
  }

  async function get(api: ReturnType<typeof apiAs>, path: string) {
    const response = await api.fetch(new Request(url(path)))
    return { status: response.status, body: (await bodyOf(response)) as Record<string, unknown> }
  }

  async function post(
    api: ReturnType<typeof apiAs>,
    path: string,
    payload: Record<string, unknown> = {},
  ) {
    const response = await api.fetch(
      new Request(url(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: newIdempotencyKey() }),
      }),
    )
    return { status: response.status, body: (await bodyOf(response)) as Record<string, unknown> }
  }

  async function bodyOf(response: Response): Promise<unknown> {
    const text = await response.text()
    return text === '' ? {} : (JSON.parse(text) as unknown)
  }

  beforeAll(async () => {
    process.env.APP_ORG_ID = SHOUT_BARN
    await wipe()
    await owner`
      insert into orgs (id, name, time_zone)
      values (${SHOUT_BARN}, 'Shout Barn Horse Rescue', ${TIME_ZONE})
    `
  })

  beforeEach(() => {
    texted = []
    forgetTextsForTest()
    setSmsTransport((message) => {
      texted.push(message)
      return Promise.resolve()
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    setSmsTransport(null)
    forgetTextsForTest()
    vi.restoreAllMocks()
    await wipe({ keepOrg: true })
  })

  afterAll(async () => {
    await wipe()
    await owner.end()
    await closeDb()
  })

  async function wipe({ keepOrg = false }: { keepOrg?: boolean } = {}): Promise<void> {
    await owner`delete from audit_entries where org_id = ${SHOUT_BARN}`
    await owner`delete from shift_roster where org_id = ${SHOUT_BARN}`
    await owner`delete from shifts where org_id = ${SHOUT_BARN}`
    await owner`delete from announcements where org_id = ${SHOUT_BARN}`
    await owner`delete from idempotency_keys where org_id = ${SHOUT_BARN}`
    await owner`delete from volunteers where org_id = ${SHOUT_BARN}`
    if (!keepOrg) await owner`delete from orgs where id = ${SHOUT_BARN}`
  }

  function day(): DayString {
    return today(TIME_ZONE)
  }

  /**
   * A Volunteer, oriented so that `mayCover` would let them on a Shift, with
   * whichever of the three reachability facts the test is about.
   */
  async function volunteer(
    name: string,
    {
      mobile = null,
      consented = false,
      stopped = false,
      oriented = true,
    }: {
      mobile?: string | null
      consented?: boolean
      stopped?: boolean
      oriented?: boolean
    } = {},
  ): Promise<string> {
    const [row] = await owner`
      insert into volunteers (id, org_id, name, email, mobile, oriented_on,
                              sms_consent_at, sms_stopped_at)
      values (gen_random_uuid(), ${SHOUT_BARN}, ${name},
              ${`${name.toLowerCase().replace(/\W/g, '')}-${newIdempotencyKey()}@shout.test`},
              ${mobile}, ${oriented ? day() : null},
              ${consented ? owner`now()` : null}, ${stopped ? owner`now()` : null})
      returning id
    `
    return String(row?.id)
  }

  /** Somebody who can actually be texted: a number, consent, and no STOP. */
  async function reachablePerson(name: string, mobile: string): Promise<string> {
    return volunteer(name, { mobile, consented: true })
  }

  /** A Shift today, already declared Short by `by`. */
  async function shortShift(by: string): Promise<string> {
    const [row] = await owner`
      insert into shifts (id, org_id, day, shift_type, start_time, target_headcount,
                          staffing_mode, short_declared_at, short_declared_by)
      values (gen_random_uuid(), ${SHOUT_BARN}, ${day()}, 'feed_pm', '16:00', 3,
              'standing_roster', now(), ${by})
      returning id
    `
    return String(row?.id)
  }

  async function announcement(by: string, text = 'The hay comes Thursday.'): Promise<string> {
    const [row] = await owner`
      insert into announcements (id, org_id, text, expires_on, authored_by)
      values (gen_random_uuid(), ${SHOUT_BARN}, ${text}, ${day()}, ${by})
      returning id
    `
    return String(row?.id)
  }

  describe('who it reaches, answered before anybody presses send', () => {
    it('counts a number, consent and no STOP — and nothing else', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await reachablePerson('Joy Marsden', '+14105550102')
      await volunteer('No Number', { consented: true })
      await volunteer('No Consent', { mobile: '+14105550104' })
      await volunteer('Replied Stop', { mobile: '+14105550105', consented: true, stopped: true })

      const report = await get(apiAs(officer, ['roster']), '/reach')

      expect(report.status).toBe(200)
      expect(report.body.everyone).toEqual({ reachable: 2, total: 5 })
    })

    it('is on the read-everything floor, because it answers counts and never a number', async () => {
      // It has to be: whoever holds Shift Authority over a Shift may send about
      // it and may hold no Domain Scope at all, and a read cannot declare Shift
      // Authority (ADR 0016).
      const plain = await volunteer('Plain Volunteer')

      const report = await get(apiAs(plain, []), '/reach')

      expect(report.status).toBe(200)
      expect(JSON.stringify(report.body)).not.toContain('4105550')
    })

    it('counts a Shift by who could cover it, not by everybody', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const rostered = await reachablePerson('Joy Marsden', '+14105550102')
      await reachablePerson('Free Volunteer', '+14105550103')
      // Could cover, cannot be reached: in the total and out of the reachable,
      // which is the shortfall the sender has to see.
      await volunteer('No Consent', { mobile: '+14105550106' })
      // A Candidate: no Orientation, so `mayCover` refuses and a text asking
      // them to cover would be asking for something the app would then refuse.
      // Out of both numbers — the shortfall is about people who could come.
      await volunteer('Not Oriented', {
        mobile: '+14105550104',
        consented: true,
        oriented: false,
      })
      const shiftId = await shortShift(officer)
      await owner`
        insert into shift_roster (id, org_id, shift_id, volunteer_id, position, origin)
        values (gen_random_uuid(), ${SHOUT_BARN}, ${shiftId}, ${rostered}, 'volunteer', 'standing_roster')
      `

      const report = await get(apiAs(officer, ['roster']), '/reach')

      const forShift = (report.body.shifts as { shiftId: string; reach: unknown }[]).find(
        (one) => one.shiftId === shiftId,
      )
      // Kate and the free volunteer are reachable; the third could come and
      // cannot be told. Joy is already coming, and the Candidate could not be
      // put on it at all — neither is in either number.
      expect(forShift?.reach).toEqual({ reachable: 2, total: 3 })
    })
  })

  describe('a Shift declared Short', () => {
    it('sends nothing until somebody asks for it', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await reachablePerson('Joy Marsden', '+14105550102')

      // Declaring Short is one act; the text is another. Declining the second
      // sends nothing, which is what two endpoints make true by construction.
      await shortShift(officer)

      expect(texted).toEqual([])
    })

    it('texts the people who could cover, in words a volunteer can act on', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await reachablePerson('Joy Marsden', '+14105550102')
      const shiftId = await shortShift(officer)

      const sent = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      expect(sent.status).toBe(200)
      expect(sent.body).toEqual({ recipients: 2, sent: 2, unreachable: 0 })
      expect(texted.map((message) => message.to).sort()).toEqual(['+14105550101', '+14105550102'])
      // The reply is the receipt: somebody taps Cover, which is already a
      // record with a name on it (ADR 0028).
      expect(texted[0]?.text).toBe(
        `Caballus: Feed PM on ${day()} at 16:00 is short. Open the app to cover. Reply STOP to stop.`,
      )
    })

    it('counts the unreachable in the shortfall rather than hiding them', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await volunteer('No Number', { consented: true })
      await volunteer('Replied Stop', { mobile: '+14105550105', consented: true, stopped: true })
      const shiftId = await shortShift(officer)

      const sent = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      expect(sent.body).toEqual({ recipients: 1, sent: 1, unreachable: 2 })
    })

    it('refuses a Shift nobody has called short', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const [row] = await owner`
        insert into shifts (id, org_id, day, shift_type, start_time, target_headcount, staffing_mode)
        values (gen_random_uuid(), ${SHOUT_BARN}, ${day()}, 'feed_am', '06:30', 3, 'standing_roster')
        returning id
      `
      const shiftId = String(row?.id)

      const refused = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      expect(refused.status).toBe(409)
      expect(refused.body).toEqual({ error: 'not_short' })
      expect(texted).toEqual([])
    })

    it('refuses a second send against the same declaration', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const api = apiAs(officer, ['roster'])
      await post(api, '/shifts/short/text', { shiftId })
      texted = []

      const again = await post(api, '/shifts/short/text', { shiftId })

      expect(again.status).toBe(409)
      expect(again.body).toEqual({ error: 'already_sent' })
      expect(texted).toEqual([])
    })

    it('lets a Shift called short a second time be sent a second time', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const api = apiAs(officer, ['roster'])
      await post(api, '/shifts/short/text', { shiftId })

      // Cleared and declared again: a second genuine shortage on the same Shift
      // is a second thing worth saying, and no column had to be reset for it.
      await owner`
        update shifts set short_cleared_at = now(), short_cleared_by = ${officer}
        where id = ${shiftId}
      `
      await owner`
        update shifts set short_declared_at = now(), short_declared_by = ${officer},
                          short_cleared_at = null, short_cleared_by = null
        where id = ${shiftId}
      `
      texted = []

      const again = await post(api, '/shifts/short/text', { shiftId })

      expect(again.status).toBe(200)
      expect(texted).toHaveLength(1)
    })

    it('refuses somebody who is neither on the Shift nor holding a Scope', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const stranger = await volunteer('Plain Volunteer')

      const refused = await post(apiAs(stranger, []), '/shifts/short/text', { shiftId })

      expect(refused.status).toBe(403)
      expect(texted).toEqual([])
    })

    it('takes it from a rostered Lead who holds no Domain Scope at all', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const lead = await reachablePerson('Lead Volunteer', '+14105550109')
      await owner`
        insert into shift_roster (id, org_id, shift_id, volunteer_id, position, origin)
        values (gen_random_uuid(), ${SHOUT_BARN}, ${shiftId}, ${lead}, 'lead', 'standing_roster')
      `

      const sent = await post(apiAs(lead, []), '/shifts/short/text', { shiftId })

      expect(sent.status).toBe(200)
    })
  })

  describe('an Announcement whose news will not keep', () => {
    it('sends nothing when it is posted, and everything when somebody asks', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await reachablePerson('Joy Marsden', '+14105550102')
      const announcementId = await announcement(officer)

      // ADR 0018 said the app sends nothing about an Announcement. Posting still
      // sends nothing; this is the second act that amends it.
      expect(texted).toEqual([])

      const sent = await post(apiAs(officer, ['financial']), '/announcements/text', {
        announcementId,
      })

      expect(sent.status).toBe(200)
      expect(sent.body).toEqual({ recipients: 2, sent: 2, unreachable: 0 })
      // The Announcement's own words, unedited: nothing is said in a text that
      // is not already written somewhere it will still be true tomorrow.
      expect(texted[0]?.text).toBe('Caballus: The hay comes Thursday. Reply STOP to stop.')
    })

    it('refuses a second send, because nobody is told twice', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const announcementId = await announcement(officer)
      const api = apiAs(officer, ['roster'])
      await post(api, '/announcements/text', { announcementId })

      const again = await post(api, '/announcements/text', { announcementId })

      expect(again.status).toBe(409)
      expect(again.body).toEqual({ error: 'already_sent' })
    })

    it('refuses somebody holding no Domain Scope at all', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const announcementId = await announcement(officer)
      const plain = await volunteer('Plain Volunteer')

      const refused = await post(apiAs(plain, []), '/announcements/text', { announcementId })

      expect(refused.status).toBe(403)
      expect(texted).toEqual([])
    })
  })

  describe('the machinery', () => {
    it('refuses every send when there is no transport at all', async () => {
      setSmsTransport(null)
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)

      const refused = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      // Loudly, and as a fact about the deployment rather than about this
      // Shift: `sent: 0` would read like everybody has left the rescue.
      expect(refused.status).toBe(503)
      expect(refused.body).toEqual({ error: 'sms_not_configured' })
    })

    it('refuses the hundred-and-twenty-first message in a day, and says so in the log', async () => {
      const lines: string[] = []
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        lines.push(String(chunk))
        return true
      })
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      await reachablePerson('Joy Marsden', '+14105550102')
      const shiftId = await shortShift(officer)
      // The cap is process-wide and rolling; spend all but one of it.
      let spent = 0
      setSmsTransport(() => {
        spent += 1
        texted.push({ to: 'filler', text: '' })
        return Promise.resolve()
      })
      const { sendText } = await import('../sms')
      for (let index = 0; index < DAILY_CAP - 1; index += 1) await sendText({ to: 'x', text: 'y' })
      expect(spent).toBe(DAILY_CAP - 1)

      const sent = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      // One got through and the other did not, reported rather than assumed.
      expect(sent.body).toMatchObject({ recipients: 2, sent: 1 })
      expect(lines.join('')).toContain('urgent_send_not_sent')
    })

    it('writes down a STOP the carrier reports, so the next count is right', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const gone = await reachablePerson('Joy Marsden', '+14105550102')
      const shiftId = await shortShift(officer)
      setSmsTransport((message) => {
        if (message.to === '+14105550102') {
          return Promise.reject(new Error('Twilio answered 400 (21610): unsubscribed'))
        }
        texted.push(message)
        return Promise.resolve()
      })

      const sent = await post(apiAs(officer, ['roster']), '/shifts/short/text', { shiftId })

      expect(sent.body).toMatchObject({ recipients: 2, sent: 1 })
      const [row] = await owner`select sms_stopped_at from volunteers where id = ${gone}`
      // Twilio is the system of record for an opt-out and legally has to be;
      // this is the rescue's copy, so *this reaches 47 of 60* is right next time.
      expect(row?.sms_stopped_at).not.toBeNull()
    })

    it('carries the send back on the read, so no screen offers one twice', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const api = apiAs(officer, ['roster'])
      const announcementId = await announcement(officer)

      const before = await get(api, '/shifts')
      expect(
        (
          before.body.shifts as { id: string; short: { urgentSentAt: number | null } | null }[]
        ).find((one) => one.id === shiftId)?.short?.urgentSentAt,
      ).toBeNull()

      await post(api, '/shifts/short/text', { shiftId })
      await post(api, '/announcements/text', { announcementId })

      // *Nobody is told twice* has to be visible and not only enforced: a
      // screen that offered the send would be quoting a reachable count for a
      // request the server would refuse.
      const after = await get(api, '/shifts')
      expect(
        (after.body.shifts as { id: string; short: { urgentSentAt: number | null } | null }[]).find(
          (one) => one.id === shiftId,
        )?.short?.urgentSentAt,
      ).toEqual(expect.any(Number))

      const wall = await get(api, '/announcements')
      expect(
        (wall.body.announcements as { id: string; urgentSentAt: number | null }[]).find(
          (one) => one.id === announcementId,
        )?.urgentSentAt,
      ).toEqual(expect.any(Number))
    })

    it('offers the send afresh when a Shift is called short a second time', async () => {
      const officer = await reachablePerson('Kate Ellery', '+14105550101')
      const shiftId = await shortShift(officer)
      const api = apiAs(officer, ['roster'])
      await post(api, '/shifts/short/text', { shiftId })

      await owner`
        update shifts set short_cleared_at = now(), short_cleared_by = ${officer}
        where id = ${shiftId}
      `
      await owner`
        update shifts set short_declared_at = now(), short_declared_by = ${officer},
                          short_cleared_at = null, short_cleared_by = null
        where id = ${shiftId}
      `

      // A send older than the declaration belongs to a shortage somebody
      // already cleared, so nothing had to be reset for this to read as unsent.
      const after = await get(api, '/shifts')
      expect(
        (after.body.shifts as { id: string; short: { urgentSentAt: number | null } | null }[]).find(
          (one) => one.id === shiftId,
        )?.short?.urgentSentAt,
      ).toBeNull()
    })

    it('declares neverQueued on both sends, because the app is the medium here', () => {
      // ADR 0018's restated rule. Declaring Short queues — a Shift needing
      // people is true whether or not the app knows — and a text about Tuesday
      // arriving on Thursday is the failure that rule exists to prevent.
      expect(contract.writes['/shifts/short/text'].neverQueued).toBe(true)
      expect(contract.writes['/announcements/text'].neverQueued).toBe(true)
      expect('neverQueued' in contract.writes['/shifts/short']).toBe(false)
    })
  })
})
