/**
 * Home, which for now is only the answer to *am I signed in*.
 *
 * The barn comes next. What this exists for today is that a session is not a
 * thing you can see: the login screen hands the browser a cookie, and without
 * somewhere that reads it back, "and is signed in" is a claim nobody in the
 * barn can check.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { signOutHere } from '../server/auth/login'
import { ApiError, client } from '../shared/api-client'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/')({
  component: Home,
})

type Me = Answers<typeof contract, '/me'>

type Who =
  | { readonly state: 'asking' }
  | { readonly state: 'signed-in'; readonly me: Me }
  | { readonly state: 'signed-out' }
  | { readonly state: 'broken'; readonly because: string }

function Home() {
  const [who, setWho] = useState<Who>({ state: 'asking' })

  useEffect(() => {
    let current = true
    // Through the typed client, so the answer is parsed against the same
    // contract the server registered against rather than asserted (ADR 0021).
    client
      .get('/me')
      .then((me) => {
        if (current) setWho({ state: 'signed-in', me })
      })
      .catch((error: unknown) => {
        if (!current) return
        // The explicit denial, read as what it is. A signed-out request and a
        // broken server are different facts and get different screens — which
        // is the whole reason the refusal is a status and a shape rather than
        // an empty answer (ADR 0010).
        if (error instanceof ApiError && error.status === 401) {
          setWho({ state: 'signed-out' })
          return
        }
        setWho({ state: 'broken', because: error instanceof Error ? error.message : 'unknown' })
      })
    return () => {
      current = false
    }
  }, [])

  return (
    <main>
      <h1>Caballus</h1>
      {who.state === 'asking' && <p>One moment…</p>}
      {who.state === 'signed-out' && (
        <p>
          <Link to="/login">Sign in</Link> to get started.
        </p>
      )}
      {who.state === 'broken' && <p role="alert">Something is wrong: {who.because}</p>}
      {who.state === 'signed-in' && (
        <>
          <p>Signed in as {who.me.name}.</p>
          <p>
            {who.me.domainScopes.length === 0
              ? 'You hold no domain scopes.'
              : `You hold ${who.me.domainScopes.join(', ')}.`}
          </p>
          {/* The desk, for whoever holds the scopes it needs. Shown to
              everybody rather than hidden by scope: the server is what
              refuses, and a link that is not there is indistinguishable from
              a broken app — ADR 0011's argument for the disabled-and-explained
              action, applied to navigation. */}
          <nav>
            <ul>
              <li>
                <Link to="/horses">Horses</Link>
              </li>
              <li>
                <Link to="/board">Feed board</Link>
              </li>
              <li>
                <Link to="/admin/volunteers">Volunteers</Link>
              </li>
              <li>
                <Link to="/admin/horses">Horses (admin)</Link>
              </li>
              <li>
                <Link to="/admin/spaces">Spaces</Link>
              </li>
              <li>
                <Link to="/admin/products">Products and Suppliers</Link>
              </li>
              <li>
                <Link to="/admin/release-versions">Release versions</Link>
              </li>
              <li>
                <Link to="/admin/audit">Audit log</Link>
              </li>
            </ul>
          </nav>
          <p>Shifts come next.</p>
          {/* Reachable, because a session lasts until somebody ends it and the
              barn has a shared tablet on it. This ends *this* session only —
              revoking every session an Account holds is an officer's act. */}
          <button
            type="button"
            onClick={() => {
              void signOutHere().then(() => {
                window.location.assign('/login')
              })
            }}
          >
            Sign out
          </button>
        </>
      )}
    </main>
  )
}
