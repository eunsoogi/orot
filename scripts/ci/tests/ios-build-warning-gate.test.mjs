import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createWarningMarkerScanner } from '../warning-marker-scanner.mjs';

// Exercise the wrapper as a process to cover the streams, exit status, and signals CI uses.
const gate = resolve('scripts/ci/fail-on-warning.mjs');

function runGate(source) {
  return spawnSync(process.execPath, [gate, '--', process.execPath, '-e', source], {
    cwd: resolve('.'),
    encoding: 'utf8',
  });
}

test('passes a clean command and forwards stdout and stderr', () => {
  const result = runGate(
    'console.log("build passed"); console.log("source includes console.warn in an example"); console.error("note: retained");',
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /build passed/);
  assert.match(result.stdout, /console\.warn/);
  assert.match(result.stderr, /note: retained/);
  assert.match(
    result.stderr,
    /IOS_WARNING_GATE occurrences=0 child_status=0 signal=none result=passed/,
  );
});

test('fails on compiler, linker, build-system, runtime, and dependency warnings', () => {
  const result = runGate(
    'console.log("SwiftCompile: warning: unused value"); console.error("libtool: warning: empty member"); console.log("warning: Run script phase has no output dependencies"); console.log("Metro WARN: missing browser global"); console.error("[!] CocoaPods script phase notice"); console.log("DVTAssertions: Warning metadata unavailable"); console.error("WARNING: uppercase diagnostic");',
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /SwiftCompile: warning: unused value/);
  assert.match(result.stdout, /warning: Run script phase has no output dependencies/);
  assert.match(result.stdout, /Metro WARN: missing browser global/);
  assert.match(result.stderr, /libtool: warning: empty member/);
  assert.match(result.stderr, /\[!\] CocoaPods script phase notice/);
  assert.match(result.stderr, /WARNING: uppercase diagnostic/);
  assert.match(
    result.stderr,
    /IOS_WARNING_GATE occurrences=7 child_status=0 signal=none result=failed/,
  );
});

test('propagates a warning failure through the CI log wrapper', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ios-warning-ci-'));
  const log = join(directory, 'build.log');

  try {
    const result = spawnSync(
      'bash',
      [
        'scripts/ci/run-command.sh',
        'warning-gate-test',
        log,
        '--',
        process.execPath,
        gate,
        '--',
        process.execPath,
        '-e',
        'console.log("warning: build system diagnostic");',
      ],
      { cwd: resolve('.'), encoding: 'utf8' },
    );

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /warning: build system diagnostic/);
    assert.match(readFileSync(log, 'utf8'), /IOS_WARNING_GATE .*result=failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves a command failure when no warning is emitted', () => {
  const result = runGate('process.exitCode = 17;');

  assert.equal(result.status, 17);
  assert.doesNotMatch(result.stderr, /IOS_WARNING_GATE .*result=passed/);
});

test('counts markers split across chunks once per output stream', () => {
  const scanner = createWarningMarkerScanner();

  scanner.scan('stdout', Buffer.from('prefix warn'));
  assert.equal(scanner.occurrences, 0);
  scanner.scan('stdout', Buffer.from('ings are normal text\n'));
  assert.equal(scanner.occurrences, 0);
  scanner.scan('stdout', Buffer.from('SwiftCompile warning'));
  assert.equal(scanner.occurrences, 0);
  scanner.scan('stdout', Buffer.from(': split marker\n'));
  assert.equal(scanner.occurrences, 1);
  scanner.scan('stderr', Buffer.from('Build phase WARN'));
  assert.equal(scanner.occurrences, 1);
  scanner.scan('stderr', Buffer.from(': separate stream\n'));

  assert.equal(scanner.occurrences, 2);
});

test('forwards termination and waits for the build child to exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-ios-warning-signal-'));
  const marker = join(directory, 'child-closed');
  const source = [
    'const fs = require("node:fs");',
    'process.on("SIGTERM", () => setTimeout(() => { fs.writeFileSync(process.env.OROT_CHILD_MARKER, "closed"); process.exit(0); }, 50));',
    'console.log("child-ready");',
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const child = spawn(
    process.execPath,
    [gate, '--', process.execPath, '--input-type=commonjs', '-e', source],
    {
      cwd: resolve('.'),
      detached: true,
      env: { ...process.env, OROT_CHILD_MARKER: marker },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let resolveReady;
  let rejectReady;
  const ready = new Promise((accept, reject) => {
    resolveReady = accept;
    rejectReady = reject;
  });
  const closed = once(child, 'close');
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
    if (stdout.includes('child-ready')) resolveReady();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  child.once('error', rejectReady);
  const timeout = setTimeout(
    () => rejectReady(new Error('warning-gate child did not start')),
    5000,
  );

  try {
    await ready;
    assert.equal(child.kill('SIGTERM'), true);
    const [code, signal] = await closed;

    assert.equal(code, 143);
    assert.equal(signal, null);
    assert.equal(existsSync(marker), true);
    assert.match(
      stderr,
      /IOS_WARNING_GATE occurrences=0 child_status=143 signal=SIGTERM result=failed/,
    );
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await closed;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all four iOS build profile paths use the warning gate', () => {
  const testBuild = readFileSync(resolve('scripts/ci/build-ios-tests.mjs'), 'utf8');
  const productionBuild = readFileSync(resolve('scripts/ci/build-ios-simulator-app.sh'), 'utf8');
  const testProductsAction = readFileSync(
    resolve('.github/actions/ios-test-products-build/action.yml'),
    'utf8',
  );
  const platformDependenciesAction = readFileSync(
    resolve('.github/actions/ios-platform-dependencies/action.yml'),
    'utf8',
  );
  const productionAction = readFileSync(
    resolve('.github/actions/ios-production-validation/action.yml'),
    'utf8',
  );
  const oauthBuild = readFileSync(resolve('.github/workflows/ios-oauth-build.yml'), 'utf8');
  const policyWorkflow = readFileSync(resolve('.github/workflows/policy-check.yml'), 'utf8');

  assert.match(testBuild, /fail-on-warning\.mjs/);
  assert.match(testProductsAction, /build-ios-tests\.mjs/);
  assert.match(platformDependenciesAction, /fail-on-warning\.mjs/);
  assert.match(platformDependenciesAction, /ios:pods --deployment/);
  assert.match(productionBuild, /fail-on-warning\.mjs/);
  assert.match(productionAction, /build-ios-simulator-app\.sh build/);
  assert.equal(oauthBuild.match(/fail-on-warning\.mjs/g)?.length, 2);
  assert.match(policyWorkflow, /node --test scripts\/ci\/tests\/\*\.test\.mjs/);
});
