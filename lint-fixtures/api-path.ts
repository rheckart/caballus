// Fixture: no unversioned API path.
// The literal form and the template form. A real path takes parameters, so the
// backticked one is the likelier half of the traffic this guards — the rule
// would be blind to most of it if only the literal were banned.
export async function unversioned(id: string): Promise<Response> {
  const path = '/api/shifts'
  await fetch(`/api/shifts/${id}`)
  return fetch('/api/v1/shifts', { method: 'POST', body: path })
}
