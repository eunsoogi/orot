import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestConfig } from '../ios-test-config.mjs';

const read = (path) => readFileSync(path, 'utf8');
const project = read('apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj');
const helpers = [
  'NativeCacheOwnerFixture.mm',
  'NativeCacheTestModule.mm',
  'NativeCacheFixtureSetup.mm',
];

test('only the three guarded native owner sources consume the test compiler setting', () => {
  const consumers = project
    .split('\n')
    .filter((line) => line.includes('OROT_NATIVE_CACHE_TEST_FLAGS'));
  assert.equal(consumers.length, helpers.length);
  for (const name of helpers) {
    const line = consumers.find((value) => value.includes(`${name} in Sources`));
    assert.ok(line, `Missing per-file SQLCipher setting for ${name}`);
    assert.match(line, /isa = PBXBuildFile;/);
    assert.match(line, /COMPILER_FLAGS = "\$\(OROT_NATIVE_CACHE_TEST_FLAGS\)"/);
    assert.match(
      read(`apps/mobile/ios/OrotMobile/${name}`),
      /#if defined\(OROT_TESTS\) && TARGET_OS_SIMULATOR/,
    );
  }
  // Normal product builds do not define this setting. Do not broaden app-wide
  // header paths, preprocessor flags, linkage, or any pod's build configuration.
  assert.doesNotMatch(project, /OROT_NATIVE_CACHE_TEST_FLAGS\s*=/);
  assert.doesNotMatch(project, /OP_SQLITE_USE_SQLCIPHER|cpp\/sqlcipher/);
});

test('test runner supplies a quoted installed-package search path, not a machine-specific path', () => {
  const expected =
    '-DOP_SQLITE_USE_SQLCIPHER=1 -I"$(SRCROOT)/../node_modules/@op-engineering/op-sqlite/cpp/sqlcipher"';
  for (const profile of ['core', 'backup', 'fixtures', 'local-model', 'duo'])
    assert.equal(iosTestConfig(profile).nativeCacheTestFlags, expected);
  const runner = read('scripts/ci/build-ios-tests.mjs');
  assert.match(runner, /'OROT_NATIVE_CACHE_TEST_FLAGS=' \+ spec.nativeCacheTestFlags/);
  assert.equal((runner.match(/OROT_NATIVE_CACHE_TEST_FLAGS=/g) ?? []).length, 1);
  // Quoting retains SRCROOT paths containing spaces. pnpm resolves the installed
  // package symlink; actual Apple compiler argv/header tracing is a native gate.
});

test('trace and vendor owner use the same sqlite include resolution', () => {
  const trace = read('apps/mobile/ios/OrotMobile/NativeCacheTestTrace.h');
  assert.match(trace, /#if !defined\(OP_SQLITE_USE_SQLCIPHER\)/);
  assert.match(trace, /#error "Native owner tests require the SQLCipher fixture compiler setting"/);
  assert.match(trace, /#include <sqlite3.h>/);
  assert.doesNotMatch(trace, /#include "[^"\n]*sqlite3.h"/);
});
