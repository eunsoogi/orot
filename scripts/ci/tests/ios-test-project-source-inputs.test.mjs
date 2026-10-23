import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expandedActionSteps } from './fixtures/ios-workflow.mjs';
import {
  projectFilePath,
  restoreEquivalentProjectSerialization,
} from '../ios-test-project-source-inputs.mjs';

const parseJson = (input) => JSON.parse(input.toString('utf8'));

test('equivalent Xcode project dictionary serialization restores the exact committed bytes', () => {
  const original = Buffer.from(
    '{"objects":{"PBXBuildFile":{"isa":"PBXBuildFile"},"PBXGroup":{"isa":"PBXGroup"}}}',
  );
  const generated = Buffer.from(
    '{"objects":{"PBXGroup":{"isa":"PBXGroup"},"PBXBuildFile":{"isa":"PBXBuildFile"}}}',
  );
  assert.deepEqual(restoreEquivalentProjectSerialization(original, generated, parseJson), original);
});

test('Xcode project semantic changes and ordered-list changes remain blocking', () => {
  const original = Buffer.from(
    '{"buildPhases":["sources","resources"],"settings":{"name":"Orot"}}',
  );
  const changedSetting = Buffer.from(
    '{"buildPhases":["sources","resources"],"settings":{"name":"Other"}}',
  );
  const changedOrder = Buffer.from(
    '{"buildPhases":["resources","sources"],"settings":{"name":"Orot"}}',
  );
  assert.throws(
    () => restoreEquivalentProjectSerialization(original, changedSetting, parseJson),
    /changed its meaning/,
  );
  assert.throws(
    () => restoreEquivalentProjectSerialization(original, changedOrder, parseJson),
    /changed its meaning/,
  );
});

test('project input path rejects symlinked checkout components before restoring bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'orot-project-input-'));
  const outside = mkdtempSync(join(tmpdir(), 'orot-project-target-'));
  try {
    const directory = join(root, 'apps/mobile/ios');
    mkdirSync(directory, { recursive: true });
    const target = join(outside, 'OrotMobile.xcodeproj');
    mkdirSync(target);
    writeFileSync(join(target, 'project.pbxproj'), 'outside');
    symlinkSync(target, join(directory, 'OrotMobile.xcodeproj'), 'dir');
    assert.throws(() => projectFilePath(root), /must contain only checkout directories/);
    assert.equal(readFileSync(join(target, 'project.pbxproj'), 'utf8'), 'outside');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('project serialization restore runs only in test-product builds before the source guard', () => {
  const testSteps = expandedActionSteps('.github/actions/ios-test-products-build/action.yml');
  const productionSteps = expandedActionSteps(
    '.github/actions/ios-production-validation/action.yml',
  );
  const indexOf = (steps, command) => steps.findIndex((step) => step.run?.includes(command));
  const restore = indexOf(testSteps, 'ios-test-project-source-inputs.mjs');
  assert.ok(restore > indexOf(testSteps, 'ios-test-source-inputs.mjs'));
  assert.ok(restore < indexOf(testSteps, 'build-ios-tests.mjs'));
  assert.equal(indexOf(productionSteps, 'ios-test-project-source-inputs.mjs'), -1);
});
