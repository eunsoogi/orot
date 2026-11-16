import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosTestBuildSpec } from '../ios-test-config.mjs';

const readSource = (path) => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');

const appSwiftGuard = '#if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)';
const packageSwiftGuard = '#if DEBUG || (OROT_TESTS && targetEnvironment(simulator))';

function assertGuardCount(path, expectedGuard, expectedCount) {
  const fixtureGuards = readSource(path)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#if ') && /DEBUG|OROT_TESTS/.test(line));
  assert.deepEqual(
    fixtureGuards,
    Array(expectedCount).fill(expectedGuard),
    path + ' must use the intended simulator-fixture compilation guard',
  );
}

test('OpenAI simulator fixtures preserve Debug support and opt in to Duo Release', () => {
  assertGuardCount(
    'apps/mobile/ios/OrotMobile/OpenAIProviderModule.m',
    '#if (DEBUG || OROT_TESTS) && TARGET_OS_SIMULATOR',
    1,
  );
  assertGuardCount(
    'apps/mobile/ios/OrotMobile/OpenAIProviderModuleSimulatorFixture.swift',
    appSwiftGuard,
    1,
  );
  assertGuardCount('apps/mobile/ios/OrotMobile/OpenAIProviderModule.swift', appSwiftGuard, 4);
  assertGuardCount(
    'apps/mobile/ios/OrotMobile/OpenAIProviderAuthCoordinator.swift',
    appSwiftGuard,
    2,
  );

  for (const path of [
    'packages/provider-openai/Sources/OpenAIProvider/ChatGPTPlanSimulatorFixture.swift',
    'packages/provider-openai/Sources/OpenAIProvider/ChatGPTPlanFixtureURLProtocol.swift',
    'packages/provider-openai/Sources/OpenAIProvider/ChatGPTSignOutFixtureURLProtocol.swift',
    'packages/provider-openai/Sources/OpenAIProvider/ChatGPTPlanFixtureEvents.swift',
    'packages/provider-openai/Sources/OpenAIProvider/ChatGPTStoredAccount.swift',
  ]) {
    assertGuardCount(path, packageSwiftGuard, 1);
  }

  const duo = iosTestBuildSpec('duo');
  assert.equal(duo.configuration, 'Release');
  assert.match(duo.compilerFlags, /(?:^|\s)-DOROT_TESTS(?:\s|$)/);
  assert.match(duo.preprocessorFlags, /(?:^|\s)OROT_TESTS=1(?:\s|$)/);

  // The test build forwards the same opt-in flags to its Xcode build invocation.
  const buildScript = readSource('scripts/ci/build-ios-tests.mjs');
  assert.ok(buildScript.includes("'OTHER_SWIFT_FLAGS=' + spec.compilerFlags"));
  assert.ok(buildScript.includes("'GCC_PREPROCESSOR_DEFINITIONS=' + spec.preprocessorFlags"));
});

// HTTP URLProtocol fixtures cannot intercept WebSocket traffic. The fixture
// rejection must execute before the socket attempt, outside its fallback catch.
// Permit the transport's do wrapper, not arbitrary statements or moved guards.
const fixtureBeforeSocket =
  /if steerable \{\s*#if \(DEBUG \|\| OROT_TESTS\) && targetEnvironment\(simulator\)\s*guard activeSimulatorFixtureClient == nil else \{\s*throw ChatGPTResponsesError\.unsupportedCapability\("live steering in an HTTP-only fixture"\)\s*\}\s*#endif\s*(?:do \{\s*)?let socket = try await activeClient\.steerableResponse/;

test('live steering rejects HTTP-only fixture credentials before its socket and fallback', () => {
  const module = readSource('apps/mobile/ios/OrotMobile/OpenAIProviderModule.swift');
  assert.match(module, fixtureBeforeSocket);
});

test('fixture socket contract rejects missing, inverted, moved or disabled guards', () => {
  const module = readSource('apps/mobile/ios/OrotMobile/OpenAIProviderModule.swift');
  const guard =
    /#if \(DEBUG \|\| OROT_TESTS\) && targetEnvironment\(simulator\)\s*guard activeSimulatorFixtureClient == nil else \{\s*throw ChatGPTResponsesError\.unsupportedCapability\("live steering in an HTTP-only fixture"\)\s*\}\s*#endif/;
  assert.match(module, guard);
  const guardText = module.match(guard)[0];
  const missing = module.replace(guardText, '');
  const mutations = [
    missing,
    module.replace(
      'guard activeSimulatorFixtureClient == nil',
      'guard activeSimulatorFixtureClient != nil',
    ),
    module.replace(
      guardText,
      guardText.replace('#if (DEBUG || OROT_TESTS) && targetEnvironment(simulator)', '#if false'),
    ),
    module.replace(guardText, 'do {\n' + guardText),
    missing.replace(
      'guard responseRequests.attachSteering',
      guardText + '\nguard responseRequests.attachSteering',
    ),
    module.replace(
      guardText,
      guardText.replace('throw ChatGPTResponsesError', 'print("ignored") // ChatGPTResponsesError'),
    ),
  ];
  for (const mutated of mutations) {
    assert.notEqual(mutated, module);
    assert.doesNotMatch(mutated, fixtureBeforeSocket);
  }
});
