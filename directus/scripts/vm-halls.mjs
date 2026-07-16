/**
 * vm-halls.mjs — resolve a game's HALL SET to the single VolleyManager gym that
 * represents it. Pure module: no env, no I/O, no Directus. Unit-tested in
 * __tests__/vm-halls.test.mjs.
 *
 * Why this exists. Our model and VM's disagree about what a multi-court booking
 * IS. A `halls` row is one physical court (hall_slots, the Hallenplan and the
 * conflict checker all assume one row = one court), so we express "play across A
 * and B" as a SET — hall = KWI A plus additional_halls = [KWI B]. VM instead
 * registers each usable combination as its own homologated gym:
 *
 *    3231 Kantonsschule Wiedikon A     (1 court, homol. H)
 *    3232 Kantonsschule Wiedikon B     (1 court, homol. H)
 *    3989 Kantonsschule Wiedikon C     (1 court, homol. H)
 *    4144 Kantonsschule Wiedikon A+B   (2 courts, homol. G)  ← the H1/H3 derbies
 *     914 Kantonsschule Wiedikon A-C   (3 courts, homol. C)
 *
 * So pushing a set means translating {A, B} → gym 4144. Getting this wrong is
 * expensive in BOTH directions: push the whole combo for a one-court game and you
 * silently book courts nobody reserved; push one court for a combo game and you
 * silently drop the other half of a booking the club already made. The push
 * reports success either way, which is why this resolves explicitly and refuses
 * rather than guessing.
 *
 * Keyed on VM's own gym uuids, not our `halls.id`. Row ids are local to a
 * database (a fresh install renumbers them); the uuids are the identifiers VM
 * itself uses, so this table stays valid across dev, prod and any rebuild.
 *
 * ⚠ The combo list is duplicated in SQL — `trg_halls_reject_vm_combo()`
 * (migration 220) enforces that no `halls` ROW points at one of these. SQL cannot
 * import this module. If a combo is ever added or a uuid changes, update BOTH.
 */

// Single-court gym uuids, named for readability in the combo table below.
const KWI_A = '9427f854-6ec8-4bf3-8c60-360cfcf2d4b1'; // VM 3231
const KWI_B = '600f0efa-82ac-46cf-8c33-7eae7b05ca82'; // VM 3232
const KWI_C = 'a3265f9d-f7ad-49d3-ab27-07da709ad7fc'; // VM 3989

/**
 * Every multi-court gym VM knows, and the single courts it is made of.
 * `parts` is a SET — order is irrelevant, matching is order-insensitive.
 */
export const VM_HALL_COMBOS = [
  {
    svHallId: '4144',
    vmHallId: '5261363c-da18-40e4-ab87-9d6bbdb6240b',
    name: 'Kantonsschule Wiedikon A+B',
    parts: [KWI_A, KWI_B],
  },
  {
    svHallId: '914',
    vmHallId: '122655f3-806e-4415-8305-5f7f9d19dab0',
    name: 'Kantonsschule Wiedikon A-C',
    parts: [KWI_A, KWI_B, KWI_C],
  },
];

const setKey = (ids) => [...new Set(ids)].sort().join('|');

/**
 * Resolve the hall rows a game occupies to one VM gym uuid.
 *
 * @param {Array<{id?: any, name?: string, vm_hall_id?: string|null}|null>} halls
 *        The game's full hall set — primary + additional, in any order.
 * @returns {{vmHallId: string|null, kind: string, label?: string, error?: string}}
 *   kind:
 *     'no_hall'          — nothing to push; caller pushes date/time only
 *     'single'           — one VM gym; vmHallId set
 *     'unmapped_single'  — one hall, but it has no vm_hall_id (e.g. Rebhügel);
 *                          caller pushes date/time only, as it always has
 *     'combo'            — a registered multi-court gym; vmHallId set
 *     'unmapped_combo'   — spans courts VM has no combo gym for, or a part is
 *                          unmapped. FAIL-CLOSED: caller must NOT push a hall.
 */
export function resolveVmHall(halls) {
  const rows = (halls || []).filter(Boolean);
  if (rows.length === 0) return { vmHallId: null, kind: 'no_hall' };

  const label = (r) => r?.name || `hall ${r?.id}`;
  const unmapped = rows.filter((r) => !r.vm_hall_id);

  // Distinct VM gyms, not distinct hall rows. Two rows can legitimately be the
  // same gym — Döltschi 1 and Döltschi 2 are both VM 153, because VM registers
  // the venue once. A set spanning only those is a single-gym booking, not a
  // combo, and must not fail as "no combo gym for [Döltschi 1 + Döltschi 2]".
  const gyms = [...new Set(rows.map((r) => r.vm_hall_id).filter(Boolean))];

  if (unmapped.length === rows.length && gyms.length === 0) {
    // Nothing in the set is known to VM at all.
    return rows.length === 1
      ? { vmHallId: null, kind: 'unmapped_single', label: label(rows[0]) }
      : {
          vmHallId: null,
          kind: 'unmapped_combo',
          error: `none of [${rows.map(label).join(' + ')}] has a vm_hall_id`,
        };
  }

  // A partially-mapped set is never safe: pushing the mapped half would silently
  // book fewer courts than the club reserved.
  if (unmapped.length > 0) {
    return {
      vmHallId: null,
      kind: 'unmapped_combo',
      error: `hall(s) [${unmapped.map(label).join(', ')}] have no vm_hall_id, so the set [${rows.map(label).join(' + ')}] cannot be expressed as one VM gym`,
    };
  }

  if (gyms.length === 1) {
    return { vmHallId: gyms[0], kind: 'single', label: label(rows[0]) };
  }

  const combo = VM_HALL_COMBOS.find((c) => setKey(c.parts) === setKey(gyms));
  if (!combo) {
    return {
      vmHallId: null,
      kind: 'unmapped_combo',
      error: `VM has no combo gym for [${rows.map(label).join(' + ')}] — register it in VM and add it to VM_HALL_COMBOS (vm-halls.mjs) + trg_halls_reject_vm_combo (migration 220)`,
    };
  }
  return { vmHallId: combo.vmHallId, kind: 'combo', label: combo.name };
}

/**
 * Flatten a slot/game's `hall` + `additional_halls` into unique hall-row ids.
 * Tolerates Directus returning either bare ids or expanded objects.
 */
export function hallIdsOf({ hall, additional_halls } = {}) {
  const one = (v) => (v && typeof v === 'object' ? (v.id ?? null) : v);
  const ids = [one(hall), ...((additional_halls ?? []).map(one))]
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(String);
  return [...new Set(ids)];
}
