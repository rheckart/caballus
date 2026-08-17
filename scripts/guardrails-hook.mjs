/**
 * The `PostToolUse` hook of ADR 0016.
 *
 * ADR 0007 runs lint at pre-push and in CI, which means an agent writing thirty
 * files hits nothing until the end — by which point the wrong pattern is
 * established across all thirty and the correction is a refactor. This runs the
 * six rules on the file that was just written, and exits 2 so the violation is
 * fed back immediately.
 *
 * The ESLint rules are scoped to `src/**\/*.ts(x)` on purpose: a hook running
 * the full config would block on formatting noise mid-refactor. The
 * control-byte check below is not scoped that way — a stray byte is a
 * property of any file's bytes, not of TypeScript syntax, and it is checked
 * first because a file that fails it is not safely readable as text at all
 * (#29).
 */
import { ESLint } from 'eslint'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describeByte, findControlBytes, isBinaryPath } from './control-bytes.mjs'

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

const input = await readStdin()
let payload = {}
try {
  payload = JSON.parse(input)
} catch {
  process.exit(0)
}

const filePath = payload.tool_input?.file_path ?? payload.tool_input?.filePath
if (typeof filePath !== 'string') process.exit(0)

const relative = path.relative(projectDir, path.resolve(projectDir, filePath))

if (!isBinaryPath(relative)) {
  // Fails open: a file that vanished between the write and this hook, or that
  // this process cannot read, is not this check's problem to solve, and a
  // hook that crashes blocks every tool call behind it rather than just this
  // one file's.
  let contents
  try {
    contents = readFileSync(filePath)
  } catch {
    contents = null
  }

  const controlBytes = contents === null ? [] : findControlBytes(contents)
  if (controlBytes.length > 0) {
    process.stderr.write(
      `${relative} carries a literal control byte, which is invisible to git diff and to ` +
        'anyone reviewing the file it is in (#29). Write it as an escape sequence or a ' +
        'printable character instead.\n',
    )
    for (const violation of controlBytes) {
      process.stderr.write(
        `  ${relative}:${String(violation.line)} ${describeByte(violation.byte)}\n`,
      )
    }
    process.exit(2)
  }
}

if (!/^src[/\\].+\.tsx?$/.test(relative)) process.exit(0)

const eslint = new ESLint({
  cwd: projectDir,
  overrideConfigFile: path.join(projectDir, 'eslint.guardrails.config.ts'),
  errorOnUnmatchedPattern: false,
})

const results = await eslint.lintFiles([filePath])
const problems = results.flatMap((result) =>
  result.messages.map(
    (message) => `${relative}:${message.line}:${message.column} ${message.message}`,
  ),
)

if (problems.length === 0) process.exit(0)

process.stderr.write(
  `${relative} breaks an invariant ADR 0016 enforces. Fix it here rather than working around it; the only exemption mechanism is a path override in eslint.config.ts.\n`,
)
for (const problem of problems) process.stderr.write(`  ${problem}\n`)
process.exit(2)

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
