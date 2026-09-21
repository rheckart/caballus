import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { backupFreshness, parseStamp, readBackupState } from './backup-freshness.mjs'

const now = Date.parse('2026-09-12T12:00:00Z')
const minutesAgo = (m) => now - m * 60_000
const hoursAgo = (h) => now - h * 3_600_000

describe('parseStamp', () => {
  it('reads the one shape backup.sh writes, trailing newline and all', () => {
    expect(parseStamp('2026-09-12T11:45:00Z\n')).toBe(Date.parse('2026-09-12T11:45:00Z'))
  })

  it.each([
    ['empty', ''],
    ['a date with no time', '2026-09-12'],
    ['an offset rather than Z', '2026-09-12T11:45:00+00:00'],
    ['words', 'yesterday'],
    ['an impossible month', '2026-13-12T11:45:00Z'],
  ])('refuses %s', (_, text) => {
    expect(parseStamp(text)).toBeUndefined()
  })
})

describe('backupFreshness', () => {
  it('is ok with a dump fifteen minutes old and a check from last night', () => {
    expect(
      backupFreshness({ lastBackup: minutesAgo(15), lastRestoreCheck: hoursAgo(8), now }),
    ).toEqual({
      backup: 'ok',
      backupAgeMinutes: 15,
      restoreCheck: 'ok',
      restoreCheckAgeHours: 8,
    })
  })

  it('is still ok at exactly an hour, and stale a minute past it', () => {
    expect(backupFreshness({ lastBackup: minutesAgo(60), lastRestoreCheck: now, now }).backup).toBe(
      'ok',
    )
    expect(backupFreshness({ lastBackup: minutesAgo(61), lastRestoreCheck: now, now }).backup).toBe(
      'stale',
    )
  })

  it('goes stale when one night of restore checks is missed', () => {
    const result = backupFreshness({ lastBackup: now, lastRestoreCheck: hoursAgo(27), now })
    expect(result.restoreCheck).toBe('stale')
    expect(result.restoreCheckAgeHours).toBe(27)
  })

  it('reads a missing stamp as stale with no age, never as fine', () => {
    expect(backupFreshness({ lastBackup: undefined, lastRestoreCheck: undefined, now })).toEqual({
      backup: 'stale',
      backupAgeMinutes: null,
      restoreCheck: 'stale',
      restoreCheckAgeHours: null,
    })
  })

  it('does not trust a stamp dated in the future', () => {
    const result = backupFreshness({ lastBackup: now + 60_000, lastRestoreCheck: now, now })
    expect(result.backup).toBe('stale')
    expect(result.backupAgeMinutes).toBeNull()
  })
})

describe('readBackupState', () => {
  let dir

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  })

  it('reads both stamps out of the state directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-state-'))
    await writeFile(join(dir, 'last-backup'), '2026-09-12T11:45:00Z\n')
    await writeFile(join(dir, 'last-restore-check'), '2026-09-12T08:00:00Z\n')
    expect(await readBackupState(dir)).toEqual({
      lastBackup: Date.parse('2026-09-12T11:45:00Z'),
      lastRestoreCheck: Date.parse('2026-09-12T08:00:00Z'),
    })
  })

  it('reads a directory with nothing in it as no stamps rather than throwing', async () => {
    expect(await readBackupState(join(tmpdir(), 'no-such-backup-state'))).toEqual({
      lastBackup: undefined,
      lastRestoreCheck: undefined,
    })
  })
})
