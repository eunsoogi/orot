import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { iosTestCohortTasks } from '../ios-test-cohorts.mjs';
const read = (path) => readFileSync(path, 'utf8');
const app = (name) => read(`apps/mobile/ios/OrotMobile/${name}`);

test('owner helper, module and trace are absent outside test Simulator compilation', () => {
  for (const name of [
    'NativeCacheOwnerFixture.h',
    'NativeCacheOwnerFixture.mm',
    'NativeCacheFixtureState.h',
    'NativeCacheFixtureSetup.mm',
    'NativeCacheTestTrace.h',
    'NativeCacheTestModule.mm',
  ])
    assert.match(app(name), /#if defined\(OROT_TESTS\) && TARGET_OS_SIMULATOR/);
  const module = app('NativeCacheTestModule.mm');
  assert.ok(module.indexOf('#if defined(OROT_TESTS)') < module.indexOf('RCT_EXPORT_MODULE'));
  assert.match(module, /count != 0/);
  assert.doesNotMatch(module, /RCT_EXPORT_METHOD|RCT_EXTERN_METHOD/);
});

test('test compilation supplies one common native definition and only a friend declaration', () => {
  assert.match(iosTestConfig('core').preprocessorFlags, /OROT_TESTS=1/);
  assert.match(
    read('scripts/ci/build-ios-tests.mjs'),
    /'GCC_PREPROCESSOR_DEFINITIONS=' \+ spec.preprocessorFlags/,
  );
  assert.match(
    read('vendor/patches/@op-engineering__op-sqlite@18.2.5.patch'),
    /\+#if defined\(OROT_TESTS\)\n\+ {2}friend struct OrotNativeCacheTestAccess;\n\+#endif/,
  );
  // Exact compile-command evidence for both the pod and app remains a Mac gate.
});

test('active trace waits for actual interruption and observes all handles before close', () => {
  const trace = app('NativeCacheTestTrace.h');
  assert.match(trace, /noexcept/);
  assert.match(trace, /sqlite3_is_interrupted/);
  assert.match(trace, /sqlite3_next_stmt/);
  assert.match(trace, /sqlite3_stmt_busy/);
  assert.match(trace, /timedOut = true/);
  assert.doesNotMatch(trace, /sqlite3_expanded_sql|sleep_for|usleep|printf|NSLog/);
  const owner = app('NativeCacheOwnerFixture.mm');
  assert.match(owner, /SQLITE_STMTSTATUS_RUN, 0/);
  assert.match(owner, /owner->invalidate\(\)/);
  assert.match(owner, /opsqlite::orotCacheEligible/);
  assert.doesNotMatch(owner, /opsqlite::invalidate\(/);
});

test('actual owner case is registered exactly once without replacing the prior close-delete case', () => {
  for (const name of [
    'testNativePeriodStatementCachePreservesOwnerBoundaries',
    'testNativePeriodCacheInterruptsAndInvalidatesActualOwner',
  ]) {
    const identifier = `OrotIntegrationTests/HermesDomainIntegrationTests/${name}`;
    assert.equal(iosTestInventory('core').filter((value) => value === identifier).length, 1);
    assert.equal(
      iosTestCohortTasks('core-integration')
        .flatMap((task) => task.identifiers)
        .filter((value) => value === identifier).length,
      1,
    );
  }
});
