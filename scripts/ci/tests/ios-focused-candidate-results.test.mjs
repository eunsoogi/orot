import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { selectFocusedIosTests } from '../ios-focused-selection.mjs';
import { verifyFocusedIosResults } from '../ios-focused-results.mjs';

test('candidate result rejects a different selection, manifest or observed runtime', () => {
  const input = [
    'ios/core',
    'apps/mobile/ios/OrotIntegrationTests/ProgressIndicatorIntegrationTests.swift',
    'OrotIntegrationTests/ProgressIndicatorIntegrationTests/testAnimationFollowsWindowAndRequestLifetime',
  ];
  const selection = selectFocusedIosTests(...input);
  const sha = 'a'.repeat(40);
  const udid = '11111111-2222-3333-4444-555555555555';
  const config = iosTestConfig('core');
  const root = mkdtempSync(join(tmpdir(), 'orot-candidate-result-'));
  try {
    mkdirSync(join(root, 'product-artifact'));
    mkdirSync(join(root, 'selection'));
    const manifest = JSON.stringify({
      context: {
        sourceSha: sha,
        runId: '123',
        attempt: '1',
        spec: { configuration: selection.configuration, compatibleExecutions: ['core'] },
      },
    });
    writeFileSync(join(root, 'product-artifact/manifest.json'), manifest);
    const receipt = {
      ...selection,
      headSha: sha,
      runId: '123',
      attempt: '1',
      cohorts: [],
      fullValidation: false,
    };
    writeFileSync(join(root, 'selection/ios-candidate-selection.json'), JSON.stringify(receipt));
    const owner = {
      profile: 'core',
      name: 'OrotTests-core-123-1',
      udid,
      runtime: config.runtime,
      device: config.device,
    };
    writeFileSync(join(root, 'simulator-owner.json'), JSON.stringify(owner));
    writeFileSync(
      join(root, 'simulator-owner.json.preparation.jsonl'),
      JSON.stringify({
        event: 'pre-boot-inventory',
        device: { udid, deviceTypeIdentifier: config.device, isAvailable: true },
        runtime: { identifier: config.runtime, buildversion: 'build', isAvailable: true },
      }),
    );
    writeFileSync(
      join(root, 'results.json'),
      JSON.stringify({
        observations: selection.identifiers.map((identifier) => ({
          identifier,
          result: 'Passed',
          duration: 1,
        })),
      }),
    );
    const context = {
      sourceSha: sha,
      runId: '123',
      attempt: '1',
      candidate: true,
      manifestDigest: createHash('sha256').update(manifest).digest('hex'),
    };
    const verify = (options = context) => verifyFocusedIosResults(...input, root, options);
    assert.equal(verify().runtimes[0].udid, udid);
    assert.throws(() => verify({ ...context, manifestDigest: 'f'.repeat(64) }), /digest mismatch/);
    writeFileSync(
      join(root, 'selection/ios-candidate-selection.json'),
      JSON.stringify({ ...receipt, attempt: '2' }),
    );
    assert.throws(() => verify(), /selection receipt/);
    writeFileSync(join(root, 'selection/ios-candidate-selection.json'), JSON.stringify(receipt));
    rmSync(join(root, 'simulator-owner.json.preparation.jsonl'));
    assert.throws(() => verify());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
