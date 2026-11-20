/**
 * The session cookie is not renamed by #113 (ADR 0030).
 *
 * `baseURL` moved from `APP_URL` — `https://caballus.tech` on the box — to the
 * reserved `https://caballus.invalid`, because one deployment now answers at
 * every rescue's host. A cookie whose name or attributes followed that change
 * would sign every volunteer out on the deploy, so this asks the installed
 * library directly, for both values of `useSecureCookies` the application runs
 * with: production (`__Secure-`, `Secure`) and development.
 */
import { getCookies } from 'better-auth/cookies'
import { describe, expect, it } from 'vitest'

const A_YEAR_IN_SECONDS = 365 * 24 * 60 * 60

function sessionCookie(baseURL: string, useSecureCookies: boolean) {
  return getCookies({
    baseURL,
    advanced: { useSecureCookies },
    session: { expiresIn: A_YEAR_IN_SECONDS },
  }).sessionToken
}

describe('the session cookie, across the baseURL change', () => {
  it.each([true, false])('is the same cookie with useSecureCookies %s', (useSecureCookies) => {
    const before = sessionCookie('https://caballus.tech', useSecureCookies)
    const after = sessionCookie('https://caballus.invalid', useSecureCookies)
    expect(after).toEqual(before)
  })

  it('is __Secure- and Secure in production, host-only either way', () => {
    const production = sessionCookie('https://caballus.invalid', true)
    expect(production.name).toBe('__Secure-better-auth.session_token')
    expect(production.attributes).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' })
    // No Domain: a cookie is sent back to the host that set it and no other,
    // which is also what keeps one rescue's cookie at its own host.
    expect(production.attributes).not.toHaveProperty('domain')
  })
})
