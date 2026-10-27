import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { iosTestInventory } from '../ios-test-inventory.mjs';
import { swiftSuiteExtensions } from './swift-suite-extensions.mjs';

function assertTestMethodDeclared(identifier) {
  const [target, suite, method] = identifier.split('/');
  const base = `apps/mobile/ios/${target}/${suite}`;
  const sourcePath = ['swift', 'm']
    .map((extension) => `${base}.${extension}`)
    .find((path) => existsSync(path));
  assert.ok(sourcePath, `Missing test source for ${identifier}`);
  if (sourcePath.endsWith('.swift')) {
    const source = readFileSync(sourcePath, 'utf8');
    const methods = swiftTestMethodsInDeclaration(source, suite, 'class');
    for (const [extensionFile, extensionSuite] of swiftSuiteExtensions) {
      if (extensionFile.startsWith(`${target}/`) && extensionSuite === suite)
        methods.push(
          ...swiftTestMethodsInDeclaration(
            readFileSync(`apps/mobile/ios/${extensionFile}`, 'utf8'),
            suite,
            'extension',
          ),
        );
    }
    assert.ok(methods.includes(method), identifier);
    return;
  }
  assert.ok(readFileSync(sourcePath, 'utf8').includes(`- (void)${method}`), identifier);
}

test('separate Core and Speech runners cover every registered boundary without duplication or silent subsets', () => {
  // Target boundaries stop dependent UI work while preserving the full original inventory.
  for (const [profile, integrationCount, uiCount] of [
    ['core', 63, 17],
    ['speech', 6, 1],
  ]) {
    const all = iosTestInventory(profile);
    const integration = iosTestInventory(profile, 'integration');
    const ui = iosTestInventory(profile, 'ui');
    assert.equal(integration.length, integrationCount);
    assert.equal(ui.length, uiCount);
    const remaining =
      profile === 'speech'
        ? iosTestInventory(profile, 'journey').slice(1)
        : [
            ...iosTestInventory(profile, 'isolation'),
            ...iosTestInventory(profile, 'recording-persistence'),
            ...iosTestInventory(profile, 'state-persistence'),
            ...iosTestInventory(profile, 'encounter-review-persistence'),
          ];
    assert.deepEqual([...integration, ...ui, ...remaining].sort(), [...all].sort());
    assert.equal(new Set([...integration, ...ui, ...remaining]).size, all.length);
    assert.ok(integration.every((id) => id.startsWith('OrotIntegrationTests/')));
    assert.ok(ui.every((id) => id.startsWith('OrotUITests/')));
  }
  assert.equal(iosTestInventory('speech', 'preparation').length, 1);
  const authentication = iosTestInventory('core', 'authentication');
  assert.deepEqual(authentication, [
    'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testKeychainQueryUsesFreshContextAndBlocksProtectedLookupWithoutUi',
    'OrotIntegrationTests/KeychainAuthenticationIntegrationTests/testProtectedKeychainReadUsesPromptedContextAfterBiometricMatch',
  ]);
  assert.ok(authentication.every((identifier) => !iosTestInventory('core').includes(identifier)));
  for (const identifier of [
    'OrotIntegrationTests/ProgressIndicatorIntegrationTests/testAnimationFollowsWindowAndRequestLifetime',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testBackAndHomeNeverExposeRootTabSelectionToAccessibility',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testPrimaryNavigationActionsKeepTheirMinimumNativeTargetSize',
    'OrotIntegrationTests/NavigationLayoutIntegrationTests/testContextualPrimaryActionPreservesButtonIdentityAcrossSaveStateUpdates',
  ])
    assert.ok(iosTestInventory('core', 'integration').includes(identifier), identifier);
  assert.ok(
    iosTestInventory('core', 'integration').includes(
      'OrotIntegrationTests/WindowPresentationAnchorIntegrationTests/testBridgeFallbackUsesTheSingleForegroundKeyWindow',
    ),
  );
  assert.ok(
    iosTestInventory('core', 'ui').includes(
      'OrotUITests/RootNavigationUITests/testContextualNavigationRemainsAboveKeyboardAndHomeDismissesIt',
    ),
  );
  assert.throws(() => iosTestInventory('core', 'preparation'));
  assert.throws(() => iosTestInventory('core', 'journey'));
  assert.throws(() => iosTestInventory('speech', 'authentication'));
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
    'duo',
  ]) {
    const inventory = iosTestInventory(profile);
    assert.ok(inventory.length > 0);
    assert.equal(new Set(inventory).size, inventory.length);
    for (const identifier of inventory) {
      seen.add(identifier);
      assertTestMethodDeclared(identifier);
    }
  }
  for (const identifier of iosTestInventory('speech', 'preparation')) {
    seen.add(identifier);
    assertTestMethodDeclared(identifier);
  }
  for (const identifier of iosTestInventory('core', 'authentication')) {
    seen.add(identifier);
    assertTestMethodDeclared(identifier);
  }
  for (const target of ['OrotIntegrationTests', 'OrotUITests']) {
    for (const file of readdirSync(`apps/mobile/ios/${target}`).filter(
      (file) => file.endsWith('.swift') || file.endsWith('.m'),
    )) {
      const source = readFileSync(`apps/mobile/ios/${target}/${file}`, 'utf8');
      if (file.endsWith('.swift')) {
        const extensionSuite = swiftSuiteExtensions.get(`${target}/${file}`);
        const suite = extensionSuite ?? file.slice(0, file.lastIndexOf('.'));
        const methods = extensionSuite
          ? swiftTestMethodsInDeclaration(source, suite, 'extension')
          : [...source.matchAll(/func (test\w+)\(/g)].map((match) => match[1]);
        assertSwiftTestMethodsScheduled(target, file, suite, methods, seen, source);
        continue;
      }
      for (const match of source.matchAll(/-\s*\(void\)\s*(test\w+)\b/g))
        assert.ok(
          seen.has(`${target}/${file.slice(0, file.lastIndexOf('.'))}/${match[1]}`),
          `Unscheduled test ${file}/${match[1]}`,
        );
    }
  }
  assert.throws(() => iosTestInventory('unknown'));
});

function swiftTestMethodsInDeclaration(source, suite, kind, withPositions = false) {
  const code = maskSwiftCommentsAndStrings(source);
  const declaration =
    /^\s*(?:(?:final|public|private|internal|open)\s+)?(class|extension)\s+([A-Za-z_]\w*)\b[^\n{]*\{/gm;
  const suiteDeclaration = [...code.matchAll(declaration)].find(
    (match) => match[1] === kind && match[2] === suite && swiftBraceDepth(code, match.index) === 0,
  );
  if (!suiteDeclaration) return [];
  const openIndex = suiteDeclaration.index + suiteDeclaration[0].lastIndexOf('{');
  const closeIndex = swiftClosingBrace(code, openIndex);
  assert.notEqual(closeIndex, -1, `Unclosed Swift ${kind} ${suite}`);
  const body = code.slice(openIndex + 1, closeIndex);
  return [...body.matchAll(/\bfunc\s+(test\w+)\s*\(/g)]
    .filter((match) => swiftBraceDepth(body, match.index) === 0)
    .map((match) => (withPositions ? openIndex + 1 + match.index : match[1]));
}

function maskSwiftCommentsAndStrings(source) {
  return source.replace(
    /#"(?:\\.|[^"\\])*"#|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (value) => value.replace(/[^\n]/g, ' '),
  );
}

function swiftBraceDepth(source, end) {
  let depth = 0;
  for (let index = 0; index < end; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
  }
  return depth;
}

function swiftClosingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function assertSwiftTestMethodsScheduled(target, file, suite, methods, seen, source) {
  if (source && swiftSuiteExtensions.has(`${target}/${file}`)) {
    const mappedPositions = new Set(
      swiftTestMethodsInDeclaration(source, suite, 'extension', true),
    );
    for (const match of maskSwiftCommentsAndStrings(source).matchAll(/\bfunc\s+(test\w+)\s*\(/g))
      assert.ok(mappedPositions.has(match.index), `Unmapped test ${file}/${match[1]}`);
  }
  for (const method of methods)
    assert.ok(seen.has(`${target}/${suite}/${method}`), `Unscheduled test ${file}/${method}`);
}

test('keeps extension methods scheduled and rejects unmapped same-named methods', () => {
  const source = `
    extension RootNavigationUITests {
      let sourceText = "func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}"
      // func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}
      /*
      func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}
      */
      func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}
      final class NestedSettingsTests: XCTestCase {
        func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}
      }
    }
    final class OtherSettingsUITests: XCTestCase {
      func testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText() {}
    }
  `;
  const methods = swiftTestMethodsInDeclaration(source, 'RootNavigationUITests', 'extension');
  assert.deepEqual(methods, ['testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText']);
  const seen = new Set([`OrotUITests/RootNavigationUITests/${methods[0]}`]);
  assert.throws(
    () =>
      assertSwiftTestMethodsScheduled(
        'OrotUITests',
        'RootSettingsNavigationUITests.swift',
        'RootNavigationUITests',
        methods,
        seen,
        source,
      ),
    /Unmapped test RootSettingsNavigationUITests\.swift\/testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText/,
  );
  const unscheduledSource = `extension RootNavigationUITests {
    func testUnregisteredSettingsExtensionMethod() {}
  }`;
  assert.throws(
    () =>
      assertSwiftTestMethodsScheduled(
        'OrotUITests',
        'RootSettingsNavigationUITests.swift',
        'RootNavigationUITests',
        swiftTestMethodsInDeclaration(unscheduledSource, 'RootNavigationUITests', 'extension'),
        seen,
      ),
    /Unscheduled test RootSettingsNavigationUITests\.swift\/testUnregisteredSettingsExtensionMethod/,
  );
});
