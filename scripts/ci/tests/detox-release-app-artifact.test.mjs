// Exercise required artifact rejection, provenance matching, and successful Release app reuse.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { writeFixtureFile } from './fixtures/detox-derived-data-cache.mjs';
import {
  artifactFiles,
  clean,
  consume,
  prepareFixture,
  produce,
  sha256,
} from './fixtures/detox-release-app-artifact-fixture.mjs';

test('rejects an empty downloaded artifact location', async () => {
  const fixture = prepareFixture({ buildApp: false });
  try {
    mkdirSync(fixture.artifactDirectory, { recursive: true });
    await assert.rejects(
      consume(fixture, { archiveSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64) }),
      /app archive is missing/,
    );
  } finally {
    clean(fixture);
  }
});

test('produces and installs one verified Release app artifact for the same run', async () => {
  const fixture = prepareFixture();
  try {
    const artifact = await produce(fixture);
    const consumed = await consume(fixture, artifact);
    assert.equal(consumed.treeSha256, artifact.manifest.app.treeSha256);
    assert.equal(readFileSync(join(fixture.appRoot, 'main.jsbundle'), 'utf8'), 'release-bundle');
    assert.match(readFileSync(fixture.outputPath, 'utf8'), /release_app_reusable=true/);
    for (const name of artifactFiles) {
      assert.ok(readFileSync(join(fixture.artifactDirectory, name)));
    }
  } finally {
    clean(fixture);
  }
});

test('rejects a profile or build configuration mismatch even when the manifest digest is current', async () => {
  const fixture = prepareFixture();
  try {
    const artifact = await produce(fixture);
    const manifestPath = join(fixture.artifactDirectory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.profile = 'openai-provider';
    let bytes = JSON.stringify(manifest, null, 2) + '\n';
    writeFixtureFile(fixture.repositoryRoot, 'artifacts/detox/release-app/manifest.json', bytes);
    await assert.rejects(
      consume(fixture, { ...artifact, manifestSha256: sha256(bytes) }),
      /manifest is incomplete or uses an incompatible profile/,
    );
    manifest.profile = 'release';
    manifest.buildContext.build.configuration = 'Debug';
    bytes = JSON.stringify(manifest, null, 2) + '\n';
    writeFixtureFile(fixture.repositoryRoot, 'artifacts/detox/release-app/manifest.json', bytes);
    await assert.rejects(
      consume(fixture, { ...artifact, manifestSha256: sha256(bytes) }),
      /provenance does not match/,
    );
  } finally {
    clean(fixture);
  }
});

test('rejects artifacts when run, source, or build-input fingerprints change', async () => {
  const fixture = prepareFixture();
  try {
    const artifact = await produce(fixture);
    await assert.rejects(
      consume(fixture, artifact, {
        ...fixture.environment,
        GITHUB_RUN_ID: '38185573170',
      }),
      /provenance does not match/,
    );
    await assert.rejects(
      consume(fixture, artifact, {
        ...fixture.environment,
        GITHUB_RUN_ATTEMPT: '2',
      }),
      /provenance does not match/,
    );
    await assert.rejects(
      consume(fixture, artifact, {
        ...fixture.environment,
        EXPECTED_DETOX_BUILD_INPUT_FINGERPRINT: 'c'.repeat(64),
      }),
      /provenance does not match/,
    );
    await assert.rejects(
      consume(fixture, artifact, { ...fixture.environment, GITHUB_SHA: 'd'.repeat(40) }),
      /GITHUB_SHA does not match/,
    );
  } finally {
    clean(fixture);
  }
});
