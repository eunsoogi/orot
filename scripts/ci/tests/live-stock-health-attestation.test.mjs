import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  chatHealthDescriptorBytes,
  expectedNativeFile,
} from '../live-stock-health-attestation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const stock = 'apps/mobile/src/conversationTools/healthContextToolDefinition.ts';
const topics = 'apps/mobile/src/healthEvidence/healthContext/types.ts';
const guide = 'packages/agent-runtime/src/multiAgent/guidedSchema.ts';
const native = 'apps/mobile/ios/OrotMobile/LiveStockHealthAttestation.swift';

test('the build uses the exact regenerated stock declaration and attestation', () => {
  const result = expectedNativeFile(root);
  assert.equal(result.current, result.expected);
  const generated = JSON.parse(chatHealthDescriptorBytes(root));
  assert.equal(generated.name, 'local-health-context');
  assert.deepEqual(generated.parameters.properties.window.properties.doseHistory.required, [
    'page',
    'pageSize',
  ]);
  const project = readFileSync(
    join(root, 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
    'utf8',
  );
  assert.match(project, /Verify generated Chat health descriptor[^]*?Sources/);
  assert.match(project, /verify-live-stock-health-attestation\.sh/);
});

test('a stock schema edit invalidates the checked native artifact until regeneration', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'live-stock-attestation-'));
  try {
    for (const path of [stock, topics, guide, native]) {
      mkdirSync(dirname(join(fixture, path)), { recursive: true });
      cpSync(join(root, path), join(fixture, path));
    }
    const original = readFileSync(join(fixture, stock), 'utf8');
    const changed = original.replace(
      'Positive local calendar days',
      'Positive relative calendar days',
    );
    assert.notEqual(changed, original);
    writeFileSync(join(fixture, stock), changed);
    const generated = expectedNativeFile(fixture);
    assert.notEqual(generated.current, generated.expected);
    writeFileSync(join(fixture, native), generated.expected);
    const fresh = expectedNativeFile(fixture);
    assert.equal(fresh.current, fresh.expected);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
