/**
 * A control byte in source has no legitimate use and is mechanical to find —
 * the shape ADR 0016 asks for in a rule. It is not one of the six, though:
 * those are AST selectors over parsed `.ts`/`.tsx`, and a byte sitting between
 * tokens, inside a comment, or in a file that is not TypeScript at all is
 * invisible to `no-restricted-syntax`. #29 found one hiding inside a template
 * literal in `src/db/idempotency.memory.ts` — a single U+0000 typed where a
 * space was meant — and it survived two code reviews because git had already
 * stopped rendering the file as text by the time anyone looked. So this is a
 * byte-level scan, over every tracked file rather than only `src/**\/*.ts(x)`.
 */

/** Tab, newline, carriage return. Nothing else belongs in source (#29). */
const ALLOWED = new Set([0x09, 0x0a, 0x0d])

/** True for a C0 control code or DEL that is not ordinary whitespace. */
function isStrayControlByte(byte) {
  return (byte < 0x20 && !ALLOWED.has(byte)) || byte === 0x7f
}

/**
 * Every stray control byte in `buffer`, with the 1-based line it falls on.
 *
 * Byte offsets rather than a decoded string: a NUL byte is exactly the case
 * where decoding as UTF-8 is already the wrong move, since it is what made
 * `idempotency.memory.ts` invalid text to the tools that would have caught it.
 */
export function findControlBytes(buffer) {
  const violations = []
  let line = 1
  for (let offset = 0; offset < buffer.length; offset++) {
    const byte = buffer[offset]
    if (isStrayControlByte(byte)) violations.push({ line, byte, offset })
    if (byte === 0x0a) line++
  }
  return violations
}

/** `0x00` etc., for a message a person can read. */
export function describeByte(byte) {
  return `0x${byte.toString(16).padStart(2, '0')}`
}

/**
 * Extensions this check does not read as text. None are tracked today; the
 * list exists for the day one is, so a binary asset does not become a false
 * positive for the same reason a NUL byte was once a false negative — a
 * mechanism nobody looked at again after it stopped matching what was true.
 */
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'pdf',
  'zip',
])

/** Whether `relativePath` is one of the extensions this check skips. */
export function isBinaryPath(relativePath) {
  const extension = relativePath.split('.').pop()?.toLowerCase()
  return extension !== undefined && BINARY_EXTENSIONS.has(extension)
}
