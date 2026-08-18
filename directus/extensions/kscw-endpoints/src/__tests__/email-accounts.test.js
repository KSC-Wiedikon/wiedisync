/**
 * Unit tests for the Emails Garage access rule and credential handling
 * (email-accounts.js).
 *
 * The invariant under test is the SCOPE rule, because it is the whole of this
 * module's access control and the only alternative way to prove it is to hand a
 * real member a role they should not keep:
 *   • global admin  → every section, may write
 *   • vb_admin      → club-wide + volleyball, read-only
 *   • bb_admin      → club-wide + basketball, read-only
 *   • plain member  → nothing at all
 *
 * Plus the two places a mistake would be silent rather than loud: the sport a
 * new address is filed under, and the ciphertext round-trip that must fail
 * CLOSED (throw) when the vault key is wrong rather than returning garbage.
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import {
  decryptSecret, encryptSecret, normalizeAddress, scopeForRoles, sportForAddress,
} from '../email-accounts.js'

describe('scopeForRoles', () => {
  it('gives a global admin every section and the write bit', () => {
    for (const role of ['admin', 'superuser']) {
      const scope = scopeForRoles(['user', role])
      expect(scope.global).toBe(true)
      expect(scope.sports.sort()).toEqual(['basketball', 'club', 'volleyball'])
    }
  })

  it('confines a volleyball admin to volleyball plus club-wide, read-only', () => {
    const scope = scopeForRoles(['user', 'vb_admin'])
    expect(scope.global).toBe(false)
    expect(scope.sports.sort()).toEqual(['club', 'volleyball'])
    // The point of the whole column: the basketball scheduling password is not
    // in a volleyball admin's scope.
    expect(scope.sports).not.toContain('basketball')
  })

  it('confines a basketball admin the mirror way', () => {
    const scope = scopeForRoles(['user', 'bb_admin'])
    expect(scope.global).toBe(false)
    expect(scope.sports.sort()).toEqual(['basketball', 'club'])
    expect(scope.sports).not.toContain('volleyball')
  })

  it('lets two sport hats accumulate rather than collide', () => {
    const scope = scopeForRoles(['user', 'vb_admin', 'bb_admin'])
    expect(scope.global).toBe(false)
    expect(scope.sports.sort()).toEqual(['basketball', 'club', 'volleyball'])
  })

  it('refuses everyone else — including roles that look privileged', () => {
    // vorstand and finance reach other admin pages; neither is on this one.
    for (const roles of [[], ['user'], ['user', 'vorstand'], ['user', 'finance'], ['user', 'website_admin']]) {
      expect(scopeForRoles(roles)).toBeNull()
    }
  })

  it('survives a non-array role value instead of granting scope', () => {
    // members.role is json and has arrived as a string before now. Failing
    // closed matters more than failing loudly.
    for (const bad of [null, undefined, 'admin', 42, {}]) {
      expect(scopeForRoles(bad)).toBeNull()
    }
  })
})

describe('sportForAddress', () => {
  it('files the two sport subdomains under their section', () => {
    expect(sportForAddress('spielplanung@volleyball.kscw.ch')).toBe('volleyball')
    expect(sportForAddress('scorer@volleyball.kscw.ch')).toBe('volleyball')
    expect(sportForAddress('spielplanung@basketball.kscw.ch')).toBe('basketball')
  })

  it('files everything else club-wide — the direction that hides nothing', () => {
    // A wrong guess towards 'club' shows the account to MORE admins, never
    // fewer, so nobody is locked out of a mailbox by a bad default.
    for (const a of [
      'kontakt@kscw.ch', 'admin@wiedisync.kscw.ch', 'finance@mail.kscw.ch',
      'vis_transfers@mail.kscw.ch', 'wiedisync@noreply.kscw.ch',
    ]) {
      expect(sportForAddress(a)).toBe('club')
    }
  })

  it('is case-insensitive and does not crash on junk', () => {
    expect(sportForAddress('Scorer@Volleyball.KSCW.ch')).toBe('volleyball')
    expect(sportForAddress('')).toBe('club')
    expect(sportForAddress(null)).toBe('club')
    expect(sportForAddress('no-at-sign')).toBe('club')
  })
})

describe('normalizeAddress', () => {
  it('lowercases and trims a valid address', () => {
    expect(normalizeAddress('  Scorer@Volleyball.KSCW.ch ')).toBe('scorer@volleyball.kscw.ch')
  })

  it('rejects what would generate an empty domain', () => {
    // The table's `domain` is a generated column; these would each produce a row
    // that sorts into a nameless group on the page.
    for (const bad of ['', '   ', 'scorer', 'scorer@', '@kscw.ch', 'a@b', 'two @spaces.ch', null]) {
      expect(normalizeAddress(bad)).toBeNull()
    }
  })
})

describe('password vault', () => {
  const key = crypto.randomBytes(32)

  it('round-trips a password', () => {
    const secret = 'correct horse battery staple ü€'
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret)
  })

  it('never emits the plaintext inside the ciphertext', () => {
    const blob = encryptSecret('s3cr3t-test-pw', key)
    expect(blob).not.toContain('s3cr3t-test-pw')
    expect(blob.startsWith('v1:')).toBe(true)
    expect(blob.split(':')).toHaveLength(4)
  })

  it('produces a different ciphertext each time (fresh IV)', () => {
    // Equal ciphertexts would leak which two mailboxes share a password.
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key))
  })

  it('THROWS on the wrong key rather than returning garbage', () => {
    // A rotated EMAIL_VAULT_KEY must surface as an error the endpoint can turn
    // into "the key does not match", not as a silently wrong password that
    // sends someone to reset a mailbox that was fine.
    const blob = encryptSecret('s3cr3t', key)
    expect(() => decryptSecret(blob, crypto.randomBytes(32))).toThrow()
  })

  it('THROWS on tampered ciphertext (GCM authenticates)', () => {
    const blob = encryptSecret('s3cr3t', key)
    const parts = blob.split(':')
    const ct = Buffer.from(parts[3], 'base64')
    ct[0] ^= 0xff
    parts[3] = ct.toString('base64')
    expect(() => decryptSecret(parts.join(':'), key)).toThrow()
  })

  it('rejects an unknown ciphertext format instead of guessing', () => {
    expect(() => decryptSecret('plaintext-password', key)).toThrow(/format/)
    expect(() => decryptSecret('v2:a:b:c', key)).toThrow(/format/)
  })
})
