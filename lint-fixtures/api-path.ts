// Fixture: no unversioned API path.
// Two violations. Both are string literals; a path assembled in a template
// literal is not one, and that is the rule's known edge rather than an
// oversight — ADR 0016 takes the version-in-the-path ban in the form that has
// no false positives.
export async function unversioned(): Promise<Response> {
  const path = '/api/shifts'
  return fetch('/api/v1/shifts', { method: 'POST', body: path })
}
