/**
 * Orphan sweep of the pick-time upload folders (audit 2026-09-28, F-09 / C1).
 *
 * The sweep deletes files unattended, so these pin what must NEVER be deleted:
 * files in any other folder or in none, files younger than 24 h, files a
 * submission / registration references (however the answer is shaped), files any
 * Directus file relation references, and — on any error — everything.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  sweepFolderOrphans, findFolderOrphans, referencedByFormAnswers, referencedByRegistrationDocs,
  fileRelationColumns, ORPHAN_MIN_AGE_HOURS,
} from '../orphan-sweep.js'
import { FORM_UPLOADS_FOLDER } from '../../../kscw-endpoints/src/upload-folders.js'

const REG_FOLDER = 'a0000167-0000-4000-8000-000000000001'
const OTHER_PRIVATE = 'd0c00003-0000-4000-8000-000000000001'
const HOUR = 3600_000
const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

/**
 * In-memory knex stand-in covering exactly the builder calls orphan-sweep.js makes.
 * `raw` with the age expression returns a marker the `<` comparison understands;
 * the form-answers raw query is evaluated the way Postgres would (text containment).
 */
function makeDb(tables, { failOn } = {}) {
  const now = Date.now()
  const db = (name) => {
    if (failOn === name) throw new Error(`boom: ${name}`)
    let rows = [...(tables[name] || [])]
    const q = {
      where(col, opOrVal, val) {
        if (val === undefined) rows = rows.filter((r) => r[col] === opOrVal)
        else if (opOrVal === '<' && val?.ageHours != null) {
          const cutoff = now - val.ageHours * HOUR
          rows = rows.filter((r) => r[col] != null && new Date(r[col]).getTime() < cutoff)
        } else throw new Error(`unsupported where ${col} ${opOrVal}`)
        return q
      },
      whereIn(col, ids) { rows = rows.filter((r) => ids.includes(r[col])); return q },
      whereNotNull(col) { rows = rows.filter((r) => r[col] != null); return q },
      orderBy(col) { rows.sort((a, b) => String(a[col]).localeCompare(String(b[col]))); return q },
      limit(n) { rows = rows.slice(0, n); return q },
      async pluck(col) { return rows.map((r) => r[col]) },
      async select(...cols) { return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) },
    }
    return q
  }
  db.raw = (sql, bindings) => {
    if (/interval '1 hour'/.test(sql)) return { ageHours: bindings[0] }
    if (/form_submissions/.test(sql)) {
      if (failOn === 'form_submissions') return Promise.reject(new Error('boom: form_submissions'))
      const texts = (tables.form_submissions || []).map((s) => JSON.stringify(s.answers).toLowerCase())
      return Promise.resolve({ rows: bindings[0].filter((i) => texts.some((t) => t.includes(i))).map((i) => ({ id: i })) })
    }
    throw new Error(`unexpected raw: ${sql}`)
  }
  return db
}

const ago = (h) => new Date(Date.now() - h * HOUR).toISOString()

function formFixture() {
  return {
    directus_files: [
      { id: id(1), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(30) },  // orphan → deleted
      { id: id(2), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(30) },  // referenced {id,name}
      { id: id(3), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(2) },   // too young
      { id: id(4), folder: null, uploaded_on: ago(900) },                // public image, no folder
      { id: id(5), folder: OTHER_PRIVATE, uploaded_on: ago(900) },       // another private folder
      { id: id(6), folder: REG_FOLDER, uploaded_on: ago(900) },          // registration folder
      { id: id(7), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(30) },  // referenced by a team picture
      { id: id(8), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(30) },  // referenced in an odd answer shape
      { id: id(9), folder: FORM_UPLOADS_FOLDER, uploaded_on: null },     // no timestamp → never
    ],
    form_submissions: [
      { id: 1, answers: { f1: { id: id(2), name: 'cv.pdf' }, f2: 'text' } },
      // a retyped field / list answer / uppercased id all still count as a reference
      { id: 2, answers: { gone: [{ file: id(8).toUpperCase() }] } },
    ],
    directus_relations: [
      { many_collection: 'teams', many_field: 'team_picture', one_collection: 'directus_files' },
      { many_collection: 'teams', many_field: 'team_picture', one_collection: 'directus_files' },
      { many_collection: 'members', many_field: 'team', one_collection: 'teams' },
    ],
    teams: [{ id: 1, team_picture: id(7) }],
    members: [],
  }
}

describe('form_uploads orphan sweep', () => {
  it('deletes only unreferenced files of that folder older than 24 h', async () => {
    const db = makeDb(formFixture())
    const deleteFiles = vi.fn(async () => {})
    const deleted = await sweepFolderOrphans(db, { folder: FORM_UPLOADS_FOLDER, isReferenced: referencedByFormAnswers, deleteFiles })
    expect(deleted).toEqual([id(1)])
    expect(deleteFiles).toHaveBeenCalledTimes(1)
    expect(deleteFiles).toHaveBeenCalledWith([id(1)])
  })

  it('default minimum age is 24 h and cannot be set below 1 h', async () => {
    expect(ORPHAN_MIN_AGE_HOURS).toBe(24)
    const t = formFixture()
    t.directus_files.push({ id: id(10), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(0.5) })
    const found = await findFolderOrphans(makeDb(t), { folder: FORM_UPLOADS_FOLDER, isReferenced: referencedByFormAnswers, minAgeHours: 0 })
    expect(found).not.toContain(id(10))
    expect(found).toContain(id(3)) // 2 h old passes a 1 h floor
  })

  it('refuses to run without a UUID folder or a reference check', async () => {
    const db = makeDb(formFixture())
    const deleteFiles = vi.fn()
    for (const folder of [undefined, null, '', 'form_uploads', "x' OR 1=1 --"]) {
      await expect(sweepFolderOrphans(db, { folder, isReferenced: referencedByFormAnswers, deleteFiles })).rejects.toThrow(/UUID/)
    }
    await expect(sweepFolderOrphans(db, { folder: FORM_UPLOADS_FOLDER, deleteFiles })).rejects.toThrow(/reference check/)
    expect(deleteFiles).not.toHaveBeenCalled()
  })

  it('deletes nothing when any reference check fails', async () => {
    for (const failOn of ['form_submissions', 'directus_relations', 'teams']) {
      const deleteFiles = vi.fn()
      await expect(sweepFolderOrphans(makeDb(formFixture(), { failOn }), {
        folder: FORM_UPLOADS_FOLDER, isReferenced: referencedByFormAnswers, deleteFiles,
      })).rejects.toThrow(/boom/)
      expect(deleteFiles).not.toHaveBeenCalled()
    }
  })

  it('skips a file moved out of the folder between selection and delete', async () => {
    const t = formFixture()
    const db = makeDb(t)
    const orig = db
    let calls = 0
    const racing = (name) => {
      // the second directus_files read is the pre-delete re-check
      if (name === 'directus_files' && ++calls === 2) t.directus_files[0].folder = OTHER_PRIVATE
      return orig(name)
    }
    racing.raw = db.raw
    const deleteFiles = vi.fn()
    expect(await sweepFolderOrphans(racing, { folder: FORM_UPLOADS_FOLDER, isReferenced: referencedByFormAnswers, deleteFiles })).toEqual([])
    expect(deleteFiles).not.toHaveBeenCalled()
  })

  it('fileRelationColumns lists each file relation once and ignores non-file relations', async () => {
    expect(await fileRelationColumns(makeDb(formFixture()))).toEqual([{ table: 'teams', column: 'team_picture' }])
  })
})

describe('registration-docs orphan sweep', () => {
  const COLS = ['id_upload_front', 'id_upload_back', 'bb_doc_lizenz']
  it('keeps referenced docs and every file outside the registration folder', async () => {
    const t = {
      directus_files: [
        { id: id(1), folder: REG_FOLDER, uploaded_on: ago(30) },       // orphan → deleted
        { id: id(2), folder: REG_FOLDER, uploaded_on: ago(30) },       // id_upload_back
        { id: id(3), folder: REG_FOLDER, uploaded_on: ago(30) },       // bb_doc_lizenz
        { id: id(4), folder: REG_FOLDER, uploaded_on: ago(23) },       // younger than 24 h
        { id: id(5), folder: FORM_UPLOADS_FOLDER, uploaded_on: ago(900) },
        { id: id(6), folder: null, uploaded_on: ago(900) },
      ],
      registrations: [
        { id: 1, id_upload_front: null, id_upload_back: id(2), bb_doc_lizenz: null },
        { id: 2, id_upload_front: null, id_upload_back: null, bb_doc_lizenz: id(3) },
      ],
      directus_relations: [],
    }
    const deleteFiles = vi.fn(async () => {})
    const deleted = await sweepFolderOrphans(makeDb(t), {
      folder: REG_FOLDER, isReferenced: referencedByRegistrationDocs(COLS), deleteFiles,
    })
    expect(deleted).toEqual([id(1)])
    expect(deleteFiles).toHaveBeenCalledWith([id(1)])
  })
})
