/**
 * Whether the backups ADR 0006 counts on are actually happening, read off the
 * two stamps `deploy/backup.sh` writes after a job has **succeeded** — never
 * before, so a job that dies halfway leaves the previous stamp to age.
 *
 * ADR 0006: _"a backup that has been silently failing for three weeks is worse
 * than no backup: it is a backup being counted on."_ So `/health` goes unhealthy
 * on either stamp going stale, and a stamp that is missing, unreadable or dated
 * in the future is stale rather than unknown — the reassuring nothing is exactly
 * the answer this exists to refuse.
 *
 * Pure apart from `readBackupState`, so the thresholds are tested rather than
 * trusted. Plain JavaScript because `serve.mjs`, its only caller, runs on Node
 * outside the bundle.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * RPO ≤ 1 hour (ADR 0006). Dumps land every fifteen minutes, so an hour is
 * three missed runs in a row rather than one slow one.
 */
export const BACKUP_STALE_AFTER_MINUTES = 60

/** The restore check is nightly; two hours past a day is one missed night. */
export const RESTORE_CHECK_STALE_AFTER_HOURS = 26

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** The instant a stamp file names, in milliseconds, or undefined for anything else. */
export function parseStamp(text) {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!STAMP.test(trimmed)) return undefined
  const ms = Date.parse(trimmed)
  return Number.isNaN(ms) ? undefined : ms
}

/** How long ago, or undefined when there is no stamp or it is dated ahead of now. */
function ageOf(stamp, now) {
  if (stamp === undefined) return undefined
  const age = now - stamp
  return age < 0 ? undefined : age
}

/**
 * The backup half of `/health`'s body. Ages are whole minutes and whole hours,
 * floored, and null when there is no trustworthy stamp to measure from.
 */
export function backupFreshness({ lastBackup, lastRestoreCheck, now }) {
  const backupAge = ageOf(lastBackup, now)
  const checkAge = ageOf(lastRestoreCheck, now)
  return {
    backup:
      backupAge !== undefined && backupAge <= BACKUP_STALE_AFTER_MINUTES * 60_000 ? 'ok' : 'stale',
    backupAgeMinutes: backupAge === undefined ? null : Math.floor(backupAge / 60_000),
    restoreCheck:
      checkAge !== undefined && checkAge <= RESTORE_CHECK_STALE_AFTER_HOURS * 3_600_000
        ? 'ok'
        : 'stale',
    restoreCheckAgeHours: checkAge === undefined ? null : Math.floor(checkAge / 3_600_000),
  }
}

/** The two stamps as `backupFreshness` takes them; a file that cannot be read is no stamp. */
export async function readBackupState(dir) {
  const read = (name) => readFile(join(dir, name), 'utf8').then(parseStamp, () => undefined)
  const [lastBackup, lastRestoreCheck] = await Promise.all([
    read('last-backup'),
    read('last-restore-check'),
  ])
  return { lastBackup, lastRestoreCheck }
}
