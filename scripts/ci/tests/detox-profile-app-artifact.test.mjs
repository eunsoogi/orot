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
} from './fixtures/detox-profile-app-artifact-fixture.mjs';

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
    assert.match(readFileSync(fixture.outputPath, 'utf8'), /profile_app_reusable=true/);
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

test('rejects a Speech artifact from a different runtime, device, or cache contract', async () => {
  const fixture = prepareFixture({ profile: 'transcription' });
  try {
    const artifact = await produce(fixture);
    assert.equal(artifact.manifest.schemaVersion, 3);
    assert.equal(
      artifact.manifest.buildContext.simulatorTestTarget.deviceType,
      'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation',
    );
    for (const name of [
      'EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER',
      'EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID',
      'DETOX_CACHE_RUNTIME_SUFFIX',
    ]) {
      await assert.rejects(
        consume(fixture, artifact, { ...fixture.environment, [name]: 'different' }),
        /provenance does not match/,
      );
    }
  } finally {
    clean(fixture);
  }
});

test('produces and reuses a distinct Speech app with its profile-specific native settings', async () => {
  const fixture = prepareFixture({ profile: 'transcription' });
  try {
    const artifact = await produce(fixture);
    const consumed = await consume(fixture, artifact);
    assert.equal(artifact.manifest.profile, 'transcription');
    assert.equal(
      artifact.manifest.buildContext.build.configurationName,
      'ios.sim.release.transcription',
    );
    assert.equal(
      artifact.manifest.buildContext.build.entryPoint,
      'e2e/transcriptionProbeEntry.tsx',
    );
    assert.deepEqual(artifact.manifest.buildContext.build.nativeFlags, {
      developmentTeam: 'OROTSIM000',
      forceBundling: '1',
      codeSigningAllowed: 'YES',
      codeSigningIdentity: '-',
      architecture: '$(uname -m)',
      onlyActiveArchitecture: 'YES',
      simulatorEntitlements: 'OrotMobile/OrotMobile.simulator.entitlements',
      otherSwiftFlags: '$(inherited) -DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST',
    });
    assert.equal(consumed.treeSha256, artifact.manifest.app.treeSha256);
    assert.equal(
      readFileSync(join(fixture.appRoot, 'main.jsbundle'), 'utf8'),
      'transcription-bundle',
    );
    assert.match(readFileSync(fixture.outputPath, 'utf8'), /profile_app_reusable=true/);
  } finally {
    clean(fixture);
  }
});

test('rejects an artifact from another compatible profile', async () => {
  const fixture = prepareFixture();
  try {
    const artifact = await produce(fixture);
    await assert.rejects(
      consume(fixture, artifact, fixture.environment, 'transcription'),
      /manifest is incomplete or uses an incompatible profile/,
    );
  } finally {
    clean(fixture);
  }
});

test('rejects Speech build-setting drift before installing a downloaded artifact', async () => {
  const fixture = prepareFixture({ profile: 'transcription' });
  try {
    const artifact = await produce(fixture);
    const configurationPath = join(
      fixture.repositoryRoot,
      'apps/mobile/e2e/transcription.detox.config.js',
    );
    const original = readFileSync(configurationPath, 'utf8');
    writeFixtureFile(
      fixture.repositoryRoot,
      'apps/mobile/e2e/transcription.detox.config.js',
      original.replace('-DOROT_SPEECH_TRANSCRIPTION_SIMULATOR_TEST', '-DOTHER_SIMULATOR_TEST'),
    );
    await assert.rejects(
      consume(fixture, artifact),
      /transcription profile, entry point, or native build flags changed/,
    );
  } finally {
    clean(fixture);
  }
});
