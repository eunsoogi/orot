import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflowsRoot = join(root, '.github/workflows');
const developerDirectory = '/Applications/Xcode_27.1.app/Contents/Developer';

test('pins every Xcode 27 workflow to the versioned Xcode 27.1 developer directory', () => {
  const workflows = readdirSync(workflowsRoot)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => [name, readFileSync(join(workflowsRoot, name), 'utf8')])
    .filter(([, content]) => /runs-on:\s*xcode-27\b/.test(content));

  assert.ok(workflows.length > 0, 'expected to find the native Xcode 27 workflows');
  for (const [name, content] of workflows) {
    assert.match(
      content,
      new RegExp(`DEVELOPER_DIR: ${developerDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${name} must use the versioned Xcode bundle`,
    );
    assert.doesNotMatch(content, /DEVELOPER_DIR:\s*\/Applications\/Xcode\.app\//);
  }
});

test('keeps the app library search paths off the optional Metal Toolchain', () => {
  const project = readFileSync(
    join(root, 'apps/mobile/ios/OrotMobile.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const searchPaths = [...project.matchAll(/LIBRARY_SEARCH_PATHS = \(([\s\S]*?)\n\s*\);/g)].map(
    (match) => match[1],
  );

  // On hosted Xcode 27.1, TOOLCHAIN_DIR resolves to Metal.xctoolchain, which lacks this Simulator Swift directory.
  assert.equal(searchPaths.length, 2);
  for (const paths of searchPaths) {
    assert.match(paths, /\$\(SDKROOT\)\/usr\/lib\/swift/);
    assert.match(paths, /\$\(inherited\)/);
    assert.doesNotMatch(paths, /\$\((?:DT_)?TOOLCHAIN_DIR\)/);
  }
});

test('uses the same Xcode and Simulator SDK pins for production cache validation', () => {
  const action = readFileSync(
    join(root, '.github/actions/ios-production-validation/action.yml'),
    'utf8',
  );
  assert.deepEqual(
    [...action.matchAll(/EXPECTED_XCODE_VERSION:\s*'([^']+)'/g)].map((match) => match[1]),
    ['27.1', '27.1'],
  );
  assert.deepEqual(
    [...action.matchAll(/EXPECTED_IOS_SIMULATOR_SDK:\s*'([^']+)'/g)].map((match) => match[1]),
    ['27.1', '27.1'],
  );
});

test('documents the pinned developer directory and product filename used by local checks', () => {
  const development = readFileSync(join(root, 'docs/development.md'), 'utf8');
  assert.match(development, /\| Xcode\s+\| 27\.1\s+\|/);
  assert.ok(development.includes(`export DEVELOPER_DIR=${developerDirectory}`));
  assert.ok(development.includes('OrotTests_iphonesimulator27.1-arm64.xctestrun'));
});
