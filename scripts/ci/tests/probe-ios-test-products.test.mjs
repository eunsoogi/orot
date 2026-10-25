import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createProductFixture } from './ios-test-products-fixture.mjs';
import { createIosTestProducts } from '../ios-test-products.mjs';

// Exercise the installed consumer verifier using synthetic products; this is not a hosted rejection observation.
test('six deliberate mutations use the real consumer verifier without compiling or altering genuine products', async () => {
  const fixture = createProductFixture();
  try {
    const original = fixture.artifact('producer');
    const manifest = await createIosTestProducts('core', fixture.products, original, fixture.env);
    const scriptPath = fileURLToPath(new URL('../probe-ios-test-products.mjs', import.meta.url));
    const output = fixture.artifact('rejections');
    const result = spawnSync(
      process.execPath,
      [scriptPath, 'core', original, manifest.archiveDigest, manifest.manifestDigest, output],
      { cwd: fixture.source, env: { ...process.env, ...fixture.env }, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(output, 'results.json')));
    assert.equal(report.observations.length, 6);
    assert.ok(report.observations.every((item) => item.rejected === true));
    assert.equal(report.sourceSha, fixture.env.GITHUB_SHA);
    assert.equal(existsSync(join(original, 'verified-products')), false);
    assert.equal(existsSync(join(fixture.source, 'simulator-owner.json')), false);
  } finally {
    fixture.dispose();
  }
});
