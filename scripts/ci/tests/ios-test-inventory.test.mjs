import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory, localNavigationBoundaryTests } from '../ios-test-inventory.mjs';

test('separate Speech runners cover every original case without duplication or silent subsets', () => {
  const all = iosTestInventory('speech');
  const native = iosTestInventory('speech', 'native');
  const ui = iosTestInventory('speech', 'ui');
  assert.equal(native.length, 6);
  assert.equal(ui.length, 4);
  assert.deepEqual([...native, ...ui].sort(), [...all].sort());
  assert.equal(new Set([...native, ...ui]).size, all.length);
  assert.ok(native.every((id) => id.startsWith('OrotIntegrationTests/')));
  assert.ok(ui.every((id) => id.startsWith('OrotUITests/')));
  assert.equal(iosTestInventory('speech', 'preparation').length, 1);
  assert.throws(() => iosTestInventory('core', 'preparation'));
  assert.throws(() => iosTestInventory('speech', 'unknown'));
  assert.throws(() => iosTestInventory('core', 'ui'));
});

test('each method is scheduled or one of the two explicit local boundary diagnostics', () => {
  const seen = new Set();
  for (const profile of [
    'core',
    'speech',
    'provider-data',
    'backup',
    'fixtures',
    'health-import',
    'microphone',
    'local-model',
    'provider-selection',
  ]) {
    const inventory = iosTestInventory(profile);
    assert.ok(inventory.length > 0);
    assert.equal(new Set(inventory).size, inventory.length);
    for (const identifier of inventory) {
      seen.add(identifier);
      const [target, suite, method] = identifier.split('/');
      const source = readFileSync(`apps/mobile/ios/${target}/${suite}.swift`, 'utf8');
      assert.ok(source.includes(`func ${method}(`), identifier);
    }
  }
  for (const identifier of iosTestInventory('speech', 'preparation')) {
    seen.add(identifier);
    const [target, suite, method] = identifier.split('/');
    const source = readFileSync(`apps/mobile/ios/${target}/${suite}.swift`, 'utf8');
    assert.ok(source.includes(`func ${method}(`), identifier);
  }
  // Exact identifiers prevent a prefix exception from hiding missing maintained coverage.
  assert.deepEqual(localNavigationBoundaryTests, [
    'OrotUITests/NavigationBoundaryUITests/testUIKitBoundaryShortThenFullEdgeBack',
    'OrotUITests/NavigationBoundaryUITests/testRNSBoundaryShortThenFullEdgeBack',
  ]);
  for (const identifier of localNavigationBoundaryTests) {
    assert.ok(!seen.has(identifier), `Local diagnostic was scheduled: ${identifier}`);
    const [target, suite, method] = identifier.split('/');
    const source = readFileSync(`apps/mobile/ios/${target}/${suite}.swift`, 'utf8');
    assert.ok(source.includes(`func ${method}(`), identifier);
    seen.add(identifier);
  }
  for (const target of ['OrotIntegrationTests', 'OrotUITests']) {
    for (const file of readdirSync(`apps/mobile/ios/${target}`).filter((file) =>
      file.endsWith('.swift'),
    )) {
      const source = readFileSync(`apps/mobile/ios/${target}/${file}`, 'utf8');
      for (const match of source.matchAll(/func (test\w+)\(/g))
        assert.ok(
          seen.has(`${target}/${file.slice(0, -6)}/${match[1]}`),
          `Unscheduled test ${file}/${match[1]}`,
        );
    }
  }
  assert.throws(() => iosTestInventory('unknown'));
});
