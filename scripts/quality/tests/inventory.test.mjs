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
