import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mobileRoot = path.join(repositoryRoot, 'apps/mobile');

function listJestSuites(args) {
  const output = execFileSync('pnpm', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => path.isAbsolute(line))
    .map((suite) => path.normalize(suite))
    .sort();
}

function mobileE2eFixtureEntries() {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps/mobile/e2e'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );

  return files
    .split(/\r?\n/)
    .filter((file) => /(?:^|\/)[^/]*Entry\.[cm]?[jt]sx?$/i.test(file))
    .map((file) => path.resolve(repositoryRoot, file));
}

function usesJestTestNaming(suite) {
  const relativePath = path.relative(mobileRoot, suite).split(path.sep).join('/');

  // Match Jest's standard testMatch shape without accepting Metro entry modules as suites.
  return (
    /(?:^|\/)__tests__\/.+\.[jt]sx?$/.test(relativePath) ||
    /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[jt]sx?$/.test(relativePath)
  );
}

test('default mobile Jest discovery includes every suite and excludes fixture entries', () => {
  // Compare the real package script with raw Jest discovery so a new test file cannot be hidden by its default route.
  const defaultSuites = listJestSuites(['--filter', '@orot/mobile', 'test:unit', '--listTests']);
  const allSuites = listJestSuites([
    '--filter',
    '@orot/mobile',
    'exec',
    'jest',
    '--config',
    'jest.config.js',
    '--runInBand',
    '--listTests',
  ]);

  assert.equal(new Set(defaultSuites).size, defaultSuites.length);
  assert.equal(new Set(allSuites).size, allSuites.length);
  assert.deepEqual(defaultSuites, allSuites);
  assert.ok(allSuites.every(usesJestTestNaming));

  const requiredHelperSuites = [
    path.join(mobileRoot, 'e2e/microphoneMeteringProbeSupport.test.ts'),
    path.join(mobileRoot, 'e2e/transcription/recordingExportProbeDiagnostics.test.ts'),
  ];
  for (const suite of requiredHelperSuites) {
    assert.equal(defaultSuites.filter((discovered) => discovered === suite).length, 1);
  }

  // Metro fixture entry modules are runtime inputs, not Jest suites.
  const discoveredSet = new Set(allSuites);
  assert.deepEqual(
    mobileE2eFixtureEntries().filter((entry) => discoveredSet.has(entry)),
    [],
  );
});
