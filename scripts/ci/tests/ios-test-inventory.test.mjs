import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('separate Core and Speech runners cover every original case without duplication or silent subsets', () => {
  // Target boundaries stop dependent UI work while preserving the full original inventory.
  for (const [profile, nativeCount, uiCount] of [
    ['core', 13, 6],
    ['speech', 6, 4],
  ]) {
    const all = iosTestInventory(profile);
    const native = iosTestInventory(profile, 'native');
    const ui = iosTestInventory(profile, 'ui');
    assert.equal(native.length, nativeCount);
    assert.equal(ui.length, uiCount);
    assert.deepEqual([...native, ...ui].sort(), [...all].sort());
    assert.equal(new Set([...native, ...ui]).size, all.length);
    assert.ok(native.every((id) => id.startsWith('OrotIntegrationTests/')));
    assert.ok(ui.every((id) => id.startsWith('OrotUITests/')));
  }
  assert.equal(iosTestInventory('speech', 'preparation').length, 1);
  assert.throws(() => iosTestInventory('core', 'preparation'));
  assert.throws(() => iosTestInventory('speech', 'unknown'));
  assert.throws(() => iosTestInventory('provider-data', 'ui'));
});

test('each profile declares unique existing cases and every test method is scheduled', () => {
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
