import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../ios-focused-selection-cli.mjs', import.meta.url));
const file = 'apps/mobile/ios/OrotUITests/TestHostConnectionTests.swift';
const identifier = 'OrotUITests/TestHostConnectionTests/testHostLaunches';
const sha = 'a'.repeat(40);

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'orot-ios-focus-cli-unit-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(
      join(root, file),
      '// Synthetic source-existence fixture; no XCTest is executed.\n',
    );
    writeFileSync(
      join(bin, 'git'),
      `#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['rev-parse','HEAD']))process.exit(2);console.log('${sha}');\n`,
      { mode: 0o755 },
    );
    const output = join(root, 'output.txt');
    const run = (args = ['ios/core', file, identifier], overrides = {}) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: bin + ':' + process.env.PATH,
          GITHUB_ACTIONS: 'true',
          GITHUB_OUTPUT: output,
          GITHUB_SHA: sha,
          ...overrides,
        },
      });
    callback({ root, output, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('hosted CLI emits the exact selected target after binding the checked-out SHA', () =>
  fixture(({ output, run }) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const values = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
    assert.equal(values.profile, 'core');
    assert.equal(values.identifier, identifier);
    assert.equal(values.prepareUi, 'true');
    assert.equal(values.expectedCount, '1');
    const receipt = JSON.parse(result.stdout.replace('IOS_FOCUS_SELECTION ', ''));
    assert.deepEqual(receipt.identifiers, [identifier]);
    assert.equal(receipt.sourceSha, sha);
    assert.equal(receipt.fullValidation, false);
  }));

test('checkout mismatch, malformed selectors and a PR-number argument emit no outputs', () => {
  for (const [args, env] of [
    [['ios/core', file, identifier], { GITHUB_SHA: 'b'.repeat(40) }],
    [['ios/core', file, identifier + ';echo']],
    [['ios/core', file, 'testHostLaunches']],
    [['ios/core', file, identifier, '217']],
    [['ios/core', file, identifier], { GITHUB_ACTIONS: 'false' }],
  ])
    fixture(({ output, run }) => {
      const result = run(args, env);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(output), false);
    });
});

test('a selected source symlink is rejected even when it points to an existing fixture', () =>
  fixture(({ root, output, run }) => {
    rmSync(join(root, file));
    const target = join(root, 'target.swift');
    writeFileSync(target, '// Source fixture.\n');
    symlinkSync(target, join(root, file));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /regular repository file/);
    assert.equal(existsSync(output), false);
  }));
