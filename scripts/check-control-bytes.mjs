/**
 * Runs `findControlBytes` over every file git tracks, not only `src/**\/*.ts(x)`
 * — a stray control byte is a property of a file's bytes, and #29's slipped
 * past because the mechanism that would have caught it (ADR 0016's ESLint
 * rules) never sees a file outside that glob, and would not have seen this one
 * reliably even inside it (see `control-bytes.mjs`).
 *
 * `git ls-files` rather than a directory walk, so this asks the same question
 * `git diff` and `git blame` answer badly for a binary file: what does the
 * repository actually track. A binary asset is the one thing this has to leave
 * alone, so extensions git and this repository already treat as binary are
 * skipped by name — there are none today, and the list exists for the day
 * there are.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describeByte, findControlBytes, isBinaryPath } from './control-bytes.mjs'

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: projectDir })
  .toString('utf8')
  .split('\0')
  .filter((entry) => entry !== '')

const failures = []

for (const relativePath of tracked) {
  if (isBinaryPath(relativePath)) continue

  const buffer = readFileSync(path.join(projectDir, relativePath))
  for (const violation of findControlBytes(buffer)) {
    failures.push(
      `${relativePath}:${String(violation.line)} carries ${describeByte(violation.byte)} ` +
        'as a literal byte — write it as an escape sequence or a printable character (#29).',
    )
  }
}

if (failures.length > 0) {
  process.stderr.write(
    'A control byte in source is invisible to git diff and git blame, and to anyone ' +
      'reviewing the file it is in (#29):\n',
  )
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}

process.stdout.write(`No stray control bytes in ${String(tracked.length)} tracked files.\n`)
