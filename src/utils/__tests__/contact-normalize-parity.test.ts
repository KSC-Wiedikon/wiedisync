// Parity harness for the contact-data canonicalizers: the frontend mirror
// (src/utils/contact.ts) and the backend canonical implementation
// (kscw-endpoints/src/normalize.js) MUST behave identically — a fixture that
// diverges means one side drifted. Fixtures include real damage patterns seen
// on prod 2026-07-07 (apostrophe corruption, Excel-mangled cells, ClubDesk
// Zahl-format AHV, legacy 9-digit numbers).
import { describe, it, expect } from 'vitest'
import * as fe from '../contact'
import * as be from '../../../directus/extensions/kscw-endpoints/src/normalize.js'

type Fixture = { input: string; ok: boolean; value: string | null; reason?: string }

const PHONE: Fixture[] = [
  { input: '', ok: true, value: null },
  { input: '   ', ok: true, value: null },
  { input: '+41 79 720 54 17', ok: true, value: '+41 79 720 54 17' },
  { input: '+41797205417', ok: true, value: '+41 79 720 54 17' },
  { input: '0414560662', ok: true, value: '+41 41 456 06 62' },
  { input: '0793014952 ', ok: true, value: '+41 79 301 49 52' },
  { input: '+41 763429696', ok: true, value: '+41 76 342 96 96' },
  { input: '+4179 500 1172', ok: true, value: '+41 79 500 11 72' },
  { input: '078 747 8161', ok: true, value: '+41 78 747 81 61' },
  { input: '079 667 18  91', ok: true, value: '+41 79 667 18 91' },
  { input: '043/277 93 94', ok: true, value: '+41 43 277 93 94' },
  { input: '076-420 08 42', ok: true, value: '+41 76 420 08 42' },
  { input: "'+41 79 123 45 67", ok: true, value: '+41 79 123 45 67' }, // legacy CSV-guard apostrophe
  { input: '+41 (0)79 123 45 67', ok: true, value: '+41 79 123 45 67' },
  { input: '41 76 334 99 61', ok: true, value: '+41 76 334 99 61' }, // international sans +
  { input: '0041 79 123 45 67', ok: true, value: '+41 79 123 45 67' },
  { input: '787986271', ok: true, value: '+41 78 798 62 71' }, // Swiss national missing the 0
  // Foreign → compact E.164
  { input: '0043 6507930957', ok: true, value: '+436507930957' },
  { input: '+33 627 79 48 35', ok: true, value: '+33627794835' },
  { input: '+353874187763', ok: true, value: '+353874187763' },
  { input: '+1 97 02 19 52 74', ok: true, value: '+19702195274' },
  // Not rewritable
  { input: '01 451 60 38', ok: false, value: '01 451 60 38', reason: 'bad_length' }, // pre-2007 9-digit
  { input: '4.91709E+11', ok: false, value: '4.91709E+11', reason: 'unparseable' }, // Excel-mangled
  { input: 'und 0782141178 (Quinn)', ok: false, value: 'und 0782141178 (Quinn)', reason: 'unparseable' },
  { input: '+41 79 123 45', ok: false, value: '+41 79 123 45', reason: 'bad_length' },
  { input: '079 123 45 678', ok: false, value: '079 123 45 678', reason: 'bad_length' },
  { input: '+41+79 123 45 67', ok: false, value: '+41+79 123 45 67', reason: 'unparseable' },
]

const IBAN: Fixture[] = [
  { input: '', ok: true, value: null },
  { input: 'CH9300762011623852957', ok: true, value: 'CH9300762011623852957' },
  { input: 'ch93 0076 2011 6238 5295 7', ok: true, value: 'CH9300762011623852957' },
  { input: 'DE89 3704 0044 0532 0130 00', ok: true, value: 'DE89370400440532013000' },
  { input: 'CH9300762011623852958', ok: false, value: 'CH9300762011623852958', reason: 'checksum' },
  { input: 'CH93', ok: false, value: 'CH93', reason: 'format' },
  { input: 'not-an-iban', ok: false, value: 'not-an-iban', reason: 'format' },
]

const AHV: Fixture[] = [
  { input: '', ok: true, value: null },
  { input: '756.1234.5678.97', ok: true, value: '756.1234.5678.97' },
  { input: '7561234567897', ok: true, value: '756.1234.5678.97' },
  { input: '756.74468971.66', ok: true, value: '756.7446.8971.66' }, // ClubDesk dot-mangled, digits intact
  { input: '7563814487939', ok: true, value: '756.3814.4879.39' }, // prod outlier member 632
  { input: '7.56E+12', ok: false, value: '7.56E+12', reason: 'excel_mangled' },
  { input: '756.1234.5678.98', ok: false, value: '756.1234.5678.98', reason: 'checksum' },
  { input: '123.4567.8901.23', ok: false, value: '123.4567.8901.23', reason: 'format' },
  { input: '756.1234.5678', ok: false, value: '756.1234.5678', reason: 'format' },
]

const EMAIL: Fixture[] = [
  { input: '', ok: true, value: null },
  { input: '  Someone@Example.COM ', ok: true, value: 'someone@example.com' },
  { input: 'no-at-sign', ok: false, value: 'no-at-sign', reason: 'format' },
  { input: 'a@b', ok: false, value: 'a@b', reason: 'format' },
  { input: 'a@b.ch', ok: true, value: 'a@b.ch' },
]

type Normalizer = (raw: unknown) => { ok: boolean; value: string | null; reason?: string }

function runParity(name: string, fixtures: Fixture[], feFn: Normalizer, beFn: Normalizer) {
  describe(name, () => {
    for (const f of fixtures) {
      it(`${JSON.stringify(f.input)} → ${f.ok ? f.value : `✗ ${f.reason}`}`, () => {
        const front = feFn(f.input)
        const back = beFn(f.input)
        expect(front).toEqual(back) // the mirrors must agree first
        expect(back.ok).toBe(f.ok)
        expect(back.value).toBe(f.value)
        if (!f.ok) expect(back.reason).toBe(f.reason)
      })
    }
  })
}

runParity('normalizePhone', PHONE, fe.normalizePhone as Normalizer, be.normalizePhone)
runParity('normalizeIban', IBAN, fe.normalizeIbanChecked as Normalizer, be.normalizeIban)
runParity('normalizeAhv', AHV, fe.normalizeAhv as Normalizer, be.normalizeAhv)
runParity('normalizeEmail', EMAIL, fe.normalizeEmail as Normalizer, be.normalizeEmail)
