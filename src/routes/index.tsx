/**
 * Home, which for now is the answer to *am I signed in* plus the one thing
 * everybody reads whether or not there is anything else to do here: the
 * unexpired Announcements (`CONTEXT.md`'s Announcement; ADR 0018, #46).
 *
 * The barn comes next. What this exists for today is that a session is not a
 * thing you can see: the login screen hands the browser a cookie, and without
 * somewhere that reads it back, "and is signed in" is a claim nobody in the
 * barn can check.
 *
 * **The Announcements section exists only when there are any** — ADR 0011's
 * rule about a tab that is empty most of the time, applied to a section: a
 * heading that is usually blank teaches people to stop reading under it. A
 * holder of any Domain Scope may post one, from this screen, because the
 * barn's wall is exactly where a volunteer already is when the water goes off
 * in the tack room.
 */
import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { signOutHere } from '../server/auth/login'
import { ApiError, client } from '../shared/api-client'
import { refusalText } from '../shared/refusals'
import { dayString } from '../shared/time'
import type { Answers, contract } from '../shared/api-contract'

export const Route = createFileRoute('/')({
  component: Home,
})

type Me = Answers<typeof contract, '/me'>
type AnnouncementList = Answers<typeof contract, '/announcements'>
type Announcement = AnnouncementList['announcements'][number]

type Who =
  | { readonly state: 'asking' }
  | { readonly state: 'signed-in'; readonly me: Me }
  | { readonly state: 'signed-out' }
  | { readonly state: 'broken'; readonly because: string }

function Home() {
  const [who, setWho] = useState<Who>({ state: 'asking' })
  const [announcements, setAnnouncements] = useState<AnnouncementList | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

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

  const loadAnnouncements = useCallback(async () => {
    setAnnouncements(await client.get('/announcements'))
  }, [])

  useEffect(() => {
    if (who.state !== 'signed-in') return
    void loadAnnouncements().catch((error: unknown) => {
      setProblem(refusalText(error))
    })
  }, [who.state, loadAnnouncements])

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setProblem(null)
      try {
        await work()
        await loadAnnouncements()
      } catch (error: unknown) {
        setProblem(refusalText(error))
      }
    },
    [loadAnnouncements],
  )

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

          {problem !== null && <p role="alert">{problem}</p>}

          {/* Shown only when there is something to show — a heading that is
              usually blank teaches people not to look under it (ADR 0011). */}
          {announcements !== null && announcements.announcements.length > 0 && (
            <section>
              <h2>Announcements</h2>
              <ul>
                {announcements.announcements.map((announcement) =>
                  editing === announcement.id ? (
                    <li key={announcement.id}>
                      <EditAnnouncement
                        announcement={announcement}
                        onCancel={() => {
                          setEditing(null)
                        }}
                        act={async (work) => {
                          await act(work)
                          setEditing(null)
                        }}
                      />
                    </li>
                  ) : (
                    <li key={announcement.id}>
                      {announcement.text} — expires {announcement.expiresOn}, posted by{' '}
                      {announcement.authoredByName}
                      {announcement.lastEditedByName !== null &&
                        ` (last edited by ${announcement.lastEditedByName})`}
                      {who.me.domainScopes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(announcement.id)
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

          {/* Posting takes any single Domain Scope, not the enumerated pair
              other forms in this application check (ADR 0018). */}
          {who.me.domainScopes.length > 0 && (
            <form
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                const form = event.currentTarget
                const data = new FormData(form)
                void act(() =>
                  client.post('/announcements', {
                    text: String(data.get('text') ?? ''),
                    expiresOn: dayString(String(data.get('expiresOn') ?? '')),
                  }),
                ).then(() => {
                  form.reset()
                })
              }}
            >
              <h3>Post an announcement</h3>
              <label htmlFor="new-announcement-text">Text</label>
              <textarea id="new-announcement-text" name="text" required maxLength={2000} />
              <label htmlFor="new-announcement-expires">Expires on</label>
              <input id="new-announcement-expires" name="expiresOn" type="date" required />
              <button type="submit">Post</button>
            </form>
          )}

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
                <Link to="/shifts">My shifts</Link>
              </li>
              <li>
                <Link to="/board">Feed board</Link>
              </li>
              <li>
                <Link to="/contacts">Contacts</Link>
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
                <Link to="/admin/shift-patterns">Shifts and patterns</Link>
              </li>
              <li>
                <Link to="/admin/thresholds">Thresholds</Link>
              </li>
              <li>
                <Link to="/admin/release-versions">Release versions</Link>
              </li>
              <li>
                <Link to="/admin/audit">Audit log</Link>
              </li>
              <li>
                <Link to="/admin/contacts">Contacts (admin)</Link>
              </li>
            </ul>
          </nav>
          <p>Checklists come next.</p>
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

/**
 * Editing an Announcement in place — by the author or any Domain Scope
 * holder, since that is the check `mutation` runs on `/announcements/edit`
 * (ADR 0018). No confirmation step beyond the form itself: this is the same
 * *edit and save* discipline `EditProduct` on the admin screens follows.
 */
function EditAnnouncement({
  announcement,
  onCancel,
  act,
}: {
  announcement: Announcement
  onCancel: () => void
  act: (work: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        void act(() =>
          client.post('/announcements/edit', {
            announcementId: announcement.id,
            text: String(data.get('text') ?? ''),
            expiresOn: dayString(String(data.get('expiresOn') ?? '')),
          }),
        )
      }}
    >
      <label htmlFor={`edit-announcement-text-${announcement.id}`}>Text</label>
      <textarea
        id={`edit-announcement-text-${announcement.id}`}
        name="text"
        required
        maxLength={2000}
        defaultValue={announcement.text}
      />
      <label htmlFor={`edit-announcement-expires-${announcement.id}`}>Expires on</label>
      <input
        id={`edit-announcement-expires-${announcement.id}`}
        name="expiresOn"
        type="date"
        required
        defaultValue={announcement.expiresOn}
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  )
}
