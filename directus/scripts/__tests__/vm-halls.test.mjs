import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVmHall, hallIdsOf, VM_HALL_COMBOS } from '../vm-halls.mjs';

// Real prod values (halls table + VM gym registry, read 2026-07-16).
const KWI_A = { id: 1, name: 'KWI A', vm_hall_id: '9427f854-6ec8-4bf3-8c60-360cfcf2d4b1' };
const KWI_B = { id: 2, name: 'KWI B', vm_hall_id: '600f0efa-82ac-46cf-8c33-7eae7b05ca82' };
const KWI_C = { id: 3, name: 'KWI C', vm_hall_id: 'a3265f9d-f7ad-49d3-ab27-07da709ad7fc' };
const DOELTSCHI_1 = { id: 4, name: 'Döltschi 1', vm_hall_id: '5a80a35c-a054-4e1f-9c43-88c765d1707f' };
const DOELTSCHI_2 = { id: 12, name: 'Döltschi 2', vm_hall_id: '5a80a35c-a054-4e1f-9c43-88c765d1707f' };
const REBHUEGEL = { id: 5, name: 'Rebhügel', vm_hall_id: null };

const AB_COMBO = '5261363c-da18-40e4-ab87-9d6bbdb6240b'; // VM 4144
const AC_COMBO = '122655f3-806e-4415-8305-5f7f9d19dab0'; // VM 914

// ─── single hall — the 78 ordinary fixtures ──────────────────────────

test('single mapped hall resolves to its own gym', () => {
  const r = resolveVmHall([KWI_C]);
  assert.equal(r.kind, 'single');
  assert.equal(r.vmHallId, KWI_C.vm_hall_id);
});

test('no hall at all pushes date/time only', () => {
  assert.equal(resolveVmHall([]).kind, 'no_hall');
  assert.equal(resolveVmHall(null).kind, 'no_hall');
  assert.equal(resolveVmHall([]).vmHallId, null);
});

test('single unmapped hall pushes date/time only, as before', () => {
  const r = resolveVmHall([REBHUEGEL]);
  assert.equal(r.kind, 'unmapped_single');
  assert.equal(r.vmHallId, null);
});

// ─── the combo — the H1/H3 derbies ───────────────────────────────────

test('KWI A + KWI B resolves to the A+B combo gym 4144', () => {
  const r = resolveVmHall([KWI_A, KWI_B]);
  assert.equal(r.kind, 'combo');
  assert.equal(r.vmHallId, AB_COMBO);
  assert.equal(r.label, 'Kantonsschule Wiedikon A+B');
});

test('combo matching is order-insensitive', () => {
  assert.equal(resolveVmHall([KWI_B, KWI_A]).vmHallId, AB_COMBO);
});

test('a duplicated hall in the set does not fabricate a combo', () => {
  // hall=KWI A + additional_halls=[KWI A] — the shape the away derby rows carry.
  const r = resolveVmHall([KWI_A, KWI_A]);
  assert.equal(r.kind, 'single');
  assert.equal(r.vmHallId, KWI_A.vm_hall_id);
});

test('KWI A + B + C resolves to the 3-court combo gym 914', () => {
  const r = resolveVmHall([KWI_A, KWI_B, KWI_C]);
  assert.equal(r.kind, 'combo');
  assert.equal(r.vmHallId, AC_COMBO);
});

// ─── fail-closed: never silently book the wrong number of courts ─────

test('an unregistered combo FAILS rather than downgrading to the primary hall', () => {
  // B+C is a real physical pairing but VM has no gym for it.
  const r = resolveVmHall([KWI_B, KWI_C]);
  assert.equal(r.kind, 'unmapped_combo');
  assert.equal(r.vmHallId, null, 'must not fall back to a single court');
  assert.match(r.error, /no combo gym/);
});

test('a partially-mapped set FAILS rather than pushing only the mapped half', () => {
  const r = resolveVmHall([KWI_A, REBHUEGEL]);
  assert.equal(r.kind, 'unmapped_combo');
  assert.equal(r.vmHallId, null);
  assert.match(r.error, /Rebhügel/);
});

test('a wholly unmapped multi-hall set fails closed', () => {
  const r = resolveVmHall([REBHUEGEL, { id: 6, name: 'Manegg', vm_hall_id: null }]);
  assert.equal(r.kind, 'unmapped_combo');
  assert.equal(r.vmHallId, null);
});

// ─── Döltschi: two of our rows, one VM gym ───────────────────────────

test('Döltschi 1 + Döltschi 2 is one gym, not a combo', () => {
  // VM registers the venue once (153), so both our rows carry the same uuid.
  // Treating this as a combo would fail a legitimate booking.
  const r = resolveVmHall([DOELTSCHI_1, DOELTSCHI_2]);
  assert.equal(r.kind, 'single');
  assert.equal(r.vmHallId, DOELTSCHI_1.vm_hall_id);
});

// ─── hallIdsOf: tolerate Directus' two shapes ────────────────────────

test('hallIdsOf flattens bare ids', () => {
  assert.deepEqual(hallIdsOf({ hall: 1, additional_halls: [2] }), ['1', '2']);
});

test('hallIdsOf flattens expanded relation objects', () => {
  assert.deepEqual(hallIdsOf({ hall: { id: 1 }, additional_halls: [{ id: 2 }] }), ['1', '2']);
});

test('hallIdsOf handles a plain single-hall slot', () => {
  assert.deepEqual(hallIdsOf({ hall: 3, additional_halls: null }), ['3']);
  assert.deepEqual(hallIdsOf({ hall: 3 }), ['3']);
});

test('hallIdsOf dedupes and drops empties', () => {
  assert.deepEqual(hallIdsOf({ hall: 1, additional_halls: [1, null, ''] }), ['1']);
  assert.deepEqual(hallIdsOf({}), []);
});

// ─── registry integrity ──────────────────────────────────────────────

test('no two combos share a part-set', () => {
  const keys = VM_HALL_COMBOS.map((c) => [...new Set(c.parts)].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length, 'a duplicate part-set makes resolution ambiguous');
});

test('every combo spans at least two distinct courts', () => {
  for (const c of VM_HALL_COMBOS) {
    assert.ok(new Set(c.parts).size >= 2, `${c.name} is not a combo`);
  }
});
