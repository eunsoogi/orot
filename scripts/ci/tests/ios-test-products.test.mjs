import assert from 'node:assert/strict';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createIosTestProducts, verifyIosTestProducts } from '../ios-test-products.mjs';
import { createProductFixture } from './ios-test-products-fixture.mjs';

test('round-trips exact Release products for a compatible Speech consumer without a compiler fallback', async () => {
  const fixture = createProductFixture();
  try {
    const directory = fixture.artifact('roundtrip');
    const manifest = await createIosTestProducts('core', fixture.products, directory, fixture.env);
    const testRun = await verifyIosTestProducts(
      'speech',
      directory,
      manifest.archiveDigest,
      manifest.manifestDigest,
      fixture.env,
    );
    assert.ok(existsSync(testRun));
    assert.equal(fixture.readManifest(directory).context.sourceSha, fixture.env.GITHUB_SHA);
    assert.equal(fixture.readManifest(directory).context.profile, 'ios-test-release');
  } finally {
    fixture.dispose();
  }
});
test('rejects missing, stale-run, changed-source and incompatible Debug consumer provenance', async () => {
  const fixture = createProductFixture();
  try {
    const directory = fixture.artifact('provenance');
    const manifest = await createIosTestProducts('core', fixture.products, directory, fixture.env);
    const verify = (profile, env = fixture.env) =>
      verifyIosTestProducts(
        profile,
        directory,
        manifest.archiveDigest,
        manifest.manifestDigest,
        env,
      );
    await assert.rejects(
      verifyIosTestProducts('core', directory, '', '', fixture.env),
      /digests are required/,
    );
    await assert.rejects(
      verify('core', { ...fixture.env, GITHUB_RUN_ATTEMPT: '2' }),
      /provenance mismatch/,
    );
    await assert.rejects(
      verify('core', { ...fixture.env, GITHUB_SHA: 'f'.repeat(40) }),
      /source\/run identity mismatch/,
    );
    await assert.rejects(verify('provider-data'), /provenance mismatch/);
    writeFileSync(join(fixture.source, 'apps/mobile/uncommitted-source.ts'), 'modified source');
    await assert.rejects(verify('core'), /source inputs differ/);
  } finally {
    fixture.dispose();
  }
});
test('rejects tampered manifests and product archives before installing any verified products', async () => {
  const fixture = createProductFixture();
  try {
    for (const name of ['manifest', 'archive']) {
      const directory = fixture.artifact('tamper-' + name);
      const manifest = await createIosTestProducts(
        'core',
        fixture.products,
        directory,
        fixture.env,
      );
      appendFileSync(
        join(directory, name === 'manifest' ? 'manifest.json' : 'ios-test-products.tar'),
        'tampered',
      );
      await assert.rejects(
        verifyIosTestProducts(
          'core',
          directory,
          manifest.archiveDigest,
          manifest.manifestDigest,
          fixture.env,
        ),
        /digest mismatch/,
      );
      assert.equal(existsSync(join(directory, 'verified-products')), false);
    }
  } finally {
    fixture.dispose();
  }
});
