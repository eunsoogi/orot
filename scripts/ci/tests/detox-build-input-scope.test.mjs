import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import {
  computeDetoxCacheFingerprints,
  listChangedDetoxBuildInputs,
} from '../detox-cache-fingerprint.mjs';
import { createFixtureRepository, writeFixtureFile } from './fixtures/detox-derived-data-cache.mjs';

test('host-only Detox tests do not invalidate bundled app outputs', () => {
  const root = createFixtureRepository();
  try {
    const initial = computeDetoxCacheFingerprints(root);
    for (const path of ['apps/mobile/e2e/smoke.test.js', 'apps/mobile/e2e/calendar.detox.e2e.js']) {
      writeFixtureFile(root, path, `changed host test: ${path}`);
    }
    const afterHostTestChanges = computeDetoxCacheFingerprints(root);
    assert.equal(afterHostTestChanges.buildInputs, initial.buildInputs);
    assert.deepEqual(listChangedDetoxBuildInputs(root), []);

    writeFixtureFile(root, 'apps/mobile/e2e/e2eRouterEntry.tsx', 'changed app bundle entry');
    const afterBundleEntryChange = computeDetoxCacheFingerprints(root);
    assert.notEqual(afterBundleEntryChange.buildInputs, initial.buildInputs);
    assert.deepEqual(listChangedDetoxBuildInputs(root), ['apps/mobile/e2e/e2eRouterEntry.tsx']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
