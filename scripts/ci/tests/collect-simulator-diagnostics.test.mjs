import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const collectScript = fileURLToPath(new URL('../collect-simulator-diagnostics.sh', import.meta.url));

test('missing Detox test log is reported without a sed error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-diagnostics-'));
  const outputLog = join(directory, 'artifacts', 'simulator.log');
  try {
    const result = spawnSync('bash', [collectScript, join(directory, 'e2e-test.log'), outputLog], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(readFileSync(outputLog, 'utf8'), /Detox test log was not created/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('captures logs by the assigned UDID when Detox reports an unknown device name', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-diagnostics-'));
  const binDirectory = join(directory, 'bin');
  const fakeXcrun = join(binDirectory, 'xcrun');
  const testLog = join(directory, 'e2e-test.log');
  const outputLog = join(directory, 'artifacts', 'simulator.log');
  const argsPath = join(directory, 'xcrun-args.txt');
  const simulatorId = 'A5BC9CEB-DCB4-40BF-B43B-EFE5B1DBBD8F';
  try {
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(testLog, `detox[123] i appointments.test.js is assigned to ${simulatorId} (undefined)\n`);
    writeFileSync(fakeXcrun, [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" > "$XCRUN_CAPTURE"',
      'printf \'captured simulator log\\n\'',
    ].join('\n'), { mode: 0o755 });

    const result = spawnSync('bash', [collectScript, testLog, outputLog], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [binDirectory, process.env.PATH].join(':'),
        XCRUN_CAPTURE: argsPath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(argsPath, 'utf8').trim(),
      `simctl spawn ${simulatorId} log show --last 20m --style compact --predicate process == "Orot"`,
    );
    assert.match(readFileSync(outputLog, 'utf8'), /captured simulator log/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('uses the recorded dedicated UDID when Detox never assigns a test', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-diagnostics-'));
  const binDirectory = join(directory, 'bin');
  const fakeXcrun = join(binDirectory, 'xcrun');
  const outputLog = join(directory, 'artifacts', 'simulator.log');
  const argsPath = join(directory, 'xcrun-args.txt');
  const identityPath = join(directory, 'simulator.udid');
  const simulatorId = 'A5BC9CEB-DCB4-40BF-B43B-EFE5B1DBBD8F';
  try {
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(identityPath, `${simulatorId}\n`);
    writeFileSync(fakeXcrun, [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" > "$XCRUN_CAPTURE"',
      'printf \'captured simulator log\\n\'',
    ].join('\n'), { mode: 0o755 });

    const result = spawnSync('bash', [collectScript, join(directory, 'missing-e2e.log'), outputLog, identityPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [binDirectory, process.env.PATH].join(':'),
        XCRUN_CAPTURE: argsPath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(argsPath, 'utf8').trim(),
      `simctl spawn ${simulatorId} log show --last 20m --style compact --predicate process == "Orot"`,
    );
    assert.match(readFileSync(outputLog, 'utf8'), /captured simulator log/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
