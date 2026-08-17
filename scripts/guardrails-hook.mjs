/**
 * The `PostToolUse` hook of ADR 0016.
 *
 * ADR 0007 runs lint at pre-push and in CI, which means an agent writing thirty
 * files hits nothing until the end — by which point the wrong pattern is
 * established across all thirty and the correction is a refactor. This runs the
 * six rules on the file that was just written, and exits 2 so the violation is
 * fed back immediately.
 *
 * It is scoped to those rules on purpose: a hook running the full config would
 * block on formatting noise mid-refactor.
 */
import { ESLint } from 'eslint'
import path from 'node:path'

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
