import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';

test('each profile declares unique existing cases and every test method is scheduled', () => {
  const seen = new Set();
  for (const profile of ['core', 'speech', 'provider-data']) {
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
