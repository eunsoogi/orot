import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { expandedActionSteps } from './fixtures/ios-workflow.mjs';
import { verifyAppleModelSymbols } from '../verify-apple-model-product.mjs';

const mock = '_OBJC_CLASS_$_OrotAppleModelMock';
const sdk = '_$s16FoundationModels20LanguageModelSessionC';

test('production requires real SDK calls and cannot contain the test mock endpoint', () => {
  assert.deepEqual(verifyAppleModelSymbols('production', sdk), {
    profile: 'production',
    modelExecution: 'apple-sdk',
    mockEndpoint: false,
    realSession: true,
  });
  for (const symbols of ['', mock, sdk + '\n' + mock])
    assert.throws(() => verifyAppleModelSymbols('production', symbols), /boundary/);
});

test('integration test products must contain the mock and cannot silently invoke the real session', () => {
  assert.equal(verifyAppleModelSymbols('integration-test', mock).modelExecution, 'mock');
  for (const symbols of ['', sdk, mock + '\n' + sdk])
    assert.throws(() => verifyAppleModelSymbols('integration-test', symbols), /boundary/);
  assert.throws(() => verifyAppleModelSymbols('unknown', mock), /Unknown/);
});

test('general CI requires neither host model eligibility nor CLI legal consent', () => {
  for (const name of readdirSync('.github/workflows').filter((name) => name.endsWith('.yml'))) {
    const source = readFileSync('.github/workflows/' + name, 'utf8');
    assert.doesNotMatch(source, /ios-apple-model-host|FM_CLI_CONSENT|cli_consent/);
  }
});

test('production and test symbol guards run before their respective receipts and publication', () => {
  const steps = [
    ...expandedActionSteps('.github/actions/ios-production-validation/action.yml'),
    ...expandedActionSteps('.github/actions/ios-test-products-build/action.yml'),
  ];
  const indexOf = (command) => steps.findIndex((step) => step.run?.includes(command));
  const production = indexOf('verify-apple-model-product.mjs production');
  const integration = indexOf('verify-apple-model-product.mjs integration-test');
  assert.ok(production > indexOf('build-ios-simulator-app.sh build'));
  // The same guard checks cached production binaries; a cache hit cannot skip the boundary.
  assert.equal(steps[production].if, undefined);
  assert.ok(production < indexOf('ios-production-receipt.mjs write'));
  assert.ok(integration > indexOf('build-ios-tests.mjs'));
  assert.ok(integration < indexOf('ios-test-products.mjs create'));
  for (const index of [production, integration]) {
    assert.equal(steps[index]['continue-on-error'], undefined);
  }
  assert.equal(steps[integration].if, undefined);
});
