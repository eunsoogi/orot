import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPath } from '../inventory.mjs';

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
  assert.match(codegenPatch.validation, /Codegen empty-State regression/);
  assert.match(codegenPatch.validation, /clean iOS compilation/);
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
