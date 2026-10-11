import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTERNAL_WRITES_ENV, externalWritesEnv,
} from '../../extensions/kscw-endpoints/src/external-accounts.js';

// vm-push-game.mjs moves a REAL fixture in VolleyManager (updateGame) — there is no
// staging, and dev holds the same club credentials. It must write only when its spawner
// (game-scheduling.js → runVmPush) hands it KSCW_EXTERNAL_WRITES=1, and the spawner
// builds that env with externalWritesEnv(), which is empty off prod. These cases tie the
// two halves together: whatever the spawner's helper produces is what the worker obeys.

// Re-imported per case because the flag is computed at module load. Importing must NOT
// run main() (no BOOKING_ID here — the entrypoint guard keeps it from exiting).
const loadWith = async (env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const mod = await import(`../vm-push-game.mjs?write-guard=${encodeURIComponent(JSON.stringify(env))}`);
  process.env = saved;
  return mod;
};

const PROD = { PUBLIC_URL: 'https://directus.kscw.ch' };
const DEV = { PUBLIC_URL: 'https://directus-dev.kscw.ch' };

describe('vm-push-game — fail-closed write guard', () => {
  test('both sides agree on the variable name', () => {
    assert.equal(EXTERNAL_WRITES_ENV, 'KSCW_EXTERNAL_WRITES');
  });

  test('no flag → dry run', async () => {
    const m = await loadWith({ KSCW_EXTERNAL_WRITES: '', DRY_RUN: '' });
    assert.equal(m.isDryRun(), true);
  });

  test('the prod spawner env → a real write', async () => {
    const spawnerEnv = externalWritesEnv('VM_GAME_ALLOW_DEV_WRITE', PROD);
    assert.deepEqual(spawnerEnv, { KSCW_EXTERNAL_WRITES: '1' });
    const m = await loadWith({ KSCW_EXTERNAL_WRITES: '', DRY_RUN: '', ...spawnerEnv });
    assert.equal(m.isDryRun(), false);
  });

  test('the dev spawner env → dry run, even with the per-writer opt-in alone', async () => {
    const spawnerEnv = externalWritesEnv('VM_GAME_ALLOW_DEV_WRITE', { ...DEV, VM_GAME_ALLOW_DEV_WRITE: '1' });
    assert.deepEqual(spawnerEnv, {});
    const m = await loadWith({ KSCW_EXTERNAL_WRITES: '', DRY_RUN: '', ...spawnerEnv });
    assert.equal(m.isDryRun(), true);
  });

  test('a supervised dev write needs the override AND the per-writer opt-in', async () => {
    const env = { ...DEV, KSCW_ALLOW_EXTERNAL_ON_DEV: '1', VM_GAME_ALLOW_DEV_WRITE: '1' };
    const m = await loadWith({ KSCW_EXTERNAL_WRITES: '', DRY_RUN: '', ...externalWritesEnv('VM_GAME_ALLOW_DEV_WRITE', env) });
    assert.equal(m.isDryRun(), false);
  });

  test('DRY_RUN=1 wins over the flag', async () => {
    const m = await loadWith({ KSCW_EXTERNAL_WRITES: '1', DRY_RUN: '1' });
    assert.equal(m.isDryRun(), true);
  });
});
