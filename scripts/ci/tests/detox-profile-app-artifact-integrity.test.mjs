// Exercise tampered app rejection and ensure a failed producer publishes no partial artifact.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { writeFixtureFile } from './fixtures/detox-derived-data-cache.mjs';
import {
  clean,
  consume,
  prepareFixture,
  productPath,
  produce,
  sha256,
} from './fixtures/detox-profile-app-artifact-fixture.mjs';

test('rejects a changed app bundle after archive and manifest checks pass', async () => {
  const fixture = prepareFixture();
  try {
    const artifact = await produce(fixture);
    writeFixtureFile(
      fixture.repositoryRoot,
      'apps/mobile/ios/build-detox-release/' + productPath + '/main.jsbundle',
      'tampered-release-bundle',
    );
    execFileSync('tar', [
      '-cf',
      join(fixture.artifactDirectory, 'profile-app.tar'),
      '-C',
      join(fixture.repositoryRoot, 'apps/mobile/ios/build-detox-release'),
      productPath,
    ]);
    const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
    manifest.app.archiveSha256 = sha256(
      readFileSync(join(fixture.artifactDirectory, 'profile-app.tar')),
    );
    const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
    writeFixtureFile(
      fixture.repositoryRoot,
      'artifacts/detox/release-app/manifest.json',
      manifestBytes,
    );
    await assert.rejects(
      consume(fixture, {
        archiveSha256: manifest.app.archiveSha256,
        manifestSha256: sha256(manifestBytes),
      }),
      /app bundle failed its integrity/,
    );
  } finally {
    clean(fixture);
  }
});

test('producer refuses to publish when the Release app product is missing', async () => {
  const fixture = prepareFixture({ buildApp: false });
  try {
    mkdirSync(fixture.artifactDirectory, { recursive: true });
    await assert.rejects(produce(fixture), /invalid app bundle: app_product_missing/);
    assert.deepEqual(readdirSync(fixture.artifactDirectory), []);
  } finally {
    clean(fixture);
  }
});
