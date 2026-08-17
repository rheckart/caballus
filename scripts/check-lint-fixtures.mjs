/**
 * Asserts that ADR 0016's guardrails are armed.
 *
 * The rules are hand-written AST queries and their failure mode is silent: a
 * selector that matches nothing reports clean forever, which looks exactly
 * like a clean codebase. So `lint-fixtures/` holds a deliberately-violating
 * file per rule and this script asserts the exact violation count for each.
 *
 * It also asserts the exemption counts ADR 0016 states — two, one, one, zero,
 * one, one — so that changing an override breaks a count and somebody reads
 * the ADR.
 */
import { ESLint } from 'eslint'
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
const { BANS, EXEMPTIONS } = await jiti.import('../eslint.config.ts')

/** Violations each fixture must produce, by rule. */
const EXPECTED_VIOLATIONS = {
  serverFn: 3,
  dbClient: 4,
  dayBoundary: 8,
  drizzleZod: 1,
  sentry: 1,
  apiPath: 3,
}

/** ADR 0016: "Today: two, two, one, zero, one, one." */
const EXPECTED_EXEMPTIONS = {
  serverFn: 2,
  dbClient: 2,
  dayBoundary: 1,
  drizzleZod: 0,
  sentry: 1,
  apiPath: 1,
}

/**
 * And the paths those entries cover, counted separately.
 *
 * Counting entries alone leaves the likelier edit unguarded: widening an
 * existing override's file list from one path to ten changes no number and
 * breaks no check, which is not what ADR 0016 promises.
 */
const EXPECTED_EXEMPT_PATHS = 10

const failures = []

const banIds = BANS.map((ban) => ban.id)
for (const id of Object.keys(EXPECTED_VIOLATIONS)) {
  if (!banIds.includes(id))
    failures.push(`${id} is expected here but is not a rule in eslint.config.ts`)
}
for (const id of banIds) {
  if (!(id in EXPECTED_VIOLATIONS)) {
    failures.push(`${id} is a rule in eslint.config.ts with no fixture expectation here`)
  }
}

// --- Exemptions -------------------------------------------------------------

const exemptionCounts = Object.fromEntries(banIds.map((id) => [id, 0]))
const claimedFiles = new Set()
for (const exemption of EXEMPTIONS) {
  if (typeof exemption.reason !== 'string' || exemption.reason.trim() === '') {
    failures.push(`an exemption for ${exemption.bans.join(', ')} carries no reason`)
  }
  for (const id of exemption.bans) exemptionCounts[id] += 1
  for (const file of exemption.files) {
    // Two overrides matching one file would silently reinstate a ban the
    // earlier one lifted, depending on order.
    if (claimedFiles.has(file)) failures.push(`${file} is exempted by two overrides`)
    claimedFiles.add(file)
  }
}
for (const [id, expected] of Object.entries(EXPECTED_EXEMPTIONS)) {
  const actual = exemptionCounts[id]
  if (actual !== expected) {
    failures.push(
      `${id}: ADR 0016 counts ${String(expected)} exemption(s), eslint.config.ts has ${String(actual)}`,
    )
  }
}

if (claimedFiles.size !== EXPECTED_EXEMPT_PATHS) {
  failures.push(
    `the overrides cover ${String(claimedFiles.size)} path(s), and ${String(EXPECTED_EXEMPT_PATHS)} were written down`,
  )
}

// --- Violations -------------------------------------------------------------

const eslint = new ESLint({ overrideConfigFile: 'eslint.guardrails.config.ts' })
const results = await eslint.lintFiles(['lint-fixtures/**/*.ts'])

const counts = Object.fromEntries(banIds.map((id) => [id, 0]))
for (const result of results) {
  for (const message of result.messages) {
    const ban = BANS.find((candidate) => message.message.includes(candidate.message))
    if (ban === undefined) {
      failures.push(`${result.filePath}:${String(message.line)} unattributable: ${message.message}`)
      continue
    }
    counts[ban.id] += 1
  }
}

for (const [id, expected] of Object.entries(EXPECTED_VIOLATIONS)) {
  const actual = counts[id]
  if (actual !== expected) {
    failures.push(
      `${id}: expected ${String(expected)} violation(s) in lint-fixtures, found ${String(actual)}`,
    )
  }
}

if (failures.length > 0) {
  process.stderr.write('The ADR 0016 guardrails are not what they say they are:\n')
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}

process.stdout.write(
  `Guardrails armed: ${String(BANS.length)} rules, ${String(EXEMPTIONS.length)} exemptions, ` +
    `${String(Object.values(EXPECTED_VIOLATIONS).reduce((a, b) => a + b, 0))} fixture violations.\n`,
)
