import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildInventory, classifyPath } from '../inventory.mjs';

test('does not treat inherited object names as explicit policy entries', () => {
  for (const path of [
    'constructor',
    'toString',
    'scripts/constructor',
    'scripts/toString',
    'scripts/probe.constructor',
    'scripts/probe.toString',
  ]) {
    assert.throws(() => classifyPath(path), /Unclassified repository file/);
  }
});

test('retains explicit exclusions and supported source classification', () => {
  const lockfile = classifyPath('pnpm-lock.yaml');
  assert.equal(lockfile.kind, 'excluded');
  assert.match(lockfile.reason, /dependency-resolution data/);

  assert.deepEqual(classifyPath('apps/mobile/src/Example.swift'), {
    path: 'apps/mobile/src/Example.swift',
    kind: 'surface',
    surface: 'swift',
  });
});

test('classifies the pinned React Native Codegen patch with focused validation', () => {
  // The patch must keep its exact hunk context, so its behavior is checked through install and build.
  const codegenPatch = classifyPath('vendor/patches/@react-native__codegen@0.87.1.patch');

  assert.equal(codegenPatch.kind, 'excluded');
  assert.match(codegenPatch.reason, /version-pinned third-party diff/i);
  assert.match(codegenPatch.validation, /Codegen empty-State/);
  assert.match(codegenPatch.validation, /empty-ShadowNodes regressions/);
  assert.match(codegenPatch.validation, /clean iOS compilation/);
});

test('classifies the pinned Slider and DateTimePicker warning repairs with native validation', () => {
  const sliderPatch = classifyPath('vendor/patches/@react-native-community__slider@5.2.2.patch');
  const dateTimePickerPatch = classifyPath(
    'vendor/patches/@react-native-community__datetimepicker@9.2.2.patch',
  );

  for (const patch of [sliderPatch, dateTimePickerPatch]) {
    assert.equal(patch.kind, 'excluded');
    assert.match(patch.reason, /version-pinned third-party diff/i);
    assert.match(patch.validation, /Frozen pnpm installation/);
    assert.match(patch.validation, /warning-gated Duo Release build/);
  }
  assert.match(sliderPatch.validation, /image and quantization regressions/);
  assert.match(dateTimePickerPatch.validation, /converter and pod-source regressions/);
});

test('classifies the pinned p-queue timer patch with bundle validation', () => {
  const pQueuePatch = classifyPath('vendor/patches/p-queue@6.6.2.patch');

  assert.equal(pQueuePatch.kind, 'excluded');
  assert.match(pQueuePatch.reason, /version-pinned third-party diff/i);
  assert.match(pQueuePatch.validation, /p-queue Hermes timer regression/);
  assert.match(pQueuePatch.validation, /clean Release app compilation/);
});

test('classifies the pinned Metro WorkerFarm patch with Release bundle validation', () => {
  const metroPatch = classifyPath('vendor/patches/metro@0.87.1.patch');

  assert.equal(metroPatch.kind, 'excluded');
  assert.match(metroPatch.reason, /version-pinned third-party diff/i);
  assert.match(metroPatch.validation, /Metro WorkerFarm color-environment regression/);
  assert.match(metroPatch.validation, /clean Release app compilation/);
});

test('ignores tracked paths that are deleted from the working tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orot-quality-inventory-'));
  try {
    await writeFile(join(root, 'present.yml'), 'name: present\n');
    const inventory = await buildInventory({
      trackedPaths: ['removed.yml', 'present.yml'],
      root,
    });
    assert.deepEqual(inventory, [{ path: 'present.yml', kind: 'surface', surface: 'yaml' }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
