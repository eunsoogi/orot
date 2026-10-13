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

const cli = fileURLToPath(new URL('../ios-native-focused-selection-cli.mjs', import.meta.url));
const file = 'apps/mobile/ios/OrotUITests/TestHostConnectionTests.swift';
const identifier = 'OrotUITests/TestHostConnectionTests/testHostLaunches';
const sha = 'a'.repeat(40);

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), 'orot-native-focus-cli-unit-'));
  try {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(
      join(root, file),
      '// Synthetic source-existence unit fixture; no native test is executed.\n',
    );
    const pr = {
      number: 200,
      state: 'open',
      head: { repo: { full_name: 'eunsoogi/orot' }, sha, ref: 'eunsoogi/issue-198-ci-build-reuse' },
    };
    writeFileSync(join(root, 'pr.json'), JSON.stringify(pr));
    writeFileSync(
      join(bin, 'git'),
      `#!${process.execPath}\nif(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['rev-parse','HEAD']))process.exit(2);console.log('${sha}');\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, 'gh'),
      `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync('api-arguments.json',JSON.stringify(process.argv.slice(2)));process.stdout.write(fs.readFileSync('pr.json'));\n`,
      { mode: 0o755 },
    );
    const output = join(root, 'output.txt');
    const run = (args = ['native/core', file, identifier, '200'], overrides = {}) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: bin + ':' + process.env.PATH,
          GITHUB_ACTIONS: 'true',
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'eunsoogi/orot',
          GITHUB_SHA: sha,
          GITHUB_REF_NAME: pr.head.ref,
          GH_TOKEN: 'synthetic-unit-token',
          ...overrides,
        },
      });
    callback({ root, output, pr, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('hosted CLI contract emits only the exact selected target after the read-only PR binding', () =>
  fixture(({ root, output, run }) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'api-arguments.json'), 'utf8')), [
      'api',
      '--method',
      'GET',
      'repos/eunsoogi/orot/pulls/200',
    ]);
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
    const receipt = JSON.parse(result.stdout.replace('IOS_NATIVE_FOCUS_SELECTION ', ''));
    assert.deepEqual(receipt.identifiers, [identifier]);
    assert.equal(receipt.sourceSha, sha);
    assert.equal(receipt.fullValidation, false);
  }));

test('actual checkout mismatch and malformed selectors emit no outputs or PR API requests', () => {
  for (const [args, env] of [
    [['native/core', file, identifier, '200'], { GITHUB_SHA: 'b'.repeat(40) }],
    [['native/core', file, identifier, '200;echo'], {}],
    [['native/core', file, 'testHostLaunches', '200'], {}],
    [['native/core', file, identifier, '200', 'extra'], {}],
    [['native/core', file, identifier, '200'], { GITHUB_ACTIONS: 'false' }],
  ])
    fixture(({ root, output, run }) => {
      const result = run(args, env);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(join(root, 'api-arguments.json')), false);
    });
});

test('closed or foreign/stale PR results fail before products and workflow outputs', () => {
  for (const change of [
    { state: 'closed' },
    { head: { sha: 'b'.repeat(40) } },
    { head: { repo: { full_name: 'other/orot' } } },
  ])
    fixture(({ root, output, pr, run }) => {
      writeFileSync(join(root, 'pr.json'), JSON.stringify({ ...pr, ...change }));
      const result = run();
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(output), false);
      assert.match(result.stderr, /selected open PR head/);
    });
});

test('a selected source symlink is rejected even when it points to an existing fixture', () =>
  fixture(({ root, output, run }) => {
    rmSync(join(root, file));
    symlinkSync(join(root, 'pr.json'), join(root, file));
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /regular repository file/);
    assert.equal(existsSync(output), false);
  }));
