import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const collectScript = fileURLToPath(
  new URL('../collect-simulator-diagnostics.sh', import.meta.url),
);

test('missing Detox test log is reported without a sed error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-diagnostics-'));
  const outputLog = join(directory, 'artifacts', 'simulator.log');
  try {
    const result = spawnSync('bash', [collectScript, join(directory, 'e2e-test.log'), outputLog], {
      encoding: 'utf8',
    });
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
    writeFileSync(
      testLog,
      `detox[123] i appointments.test.js is assigned to ${simulatorId} (undefined)\n`,
    );
    writeFileSync(
      fakeXcrun,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$*" > "$XCRUN_CAPTURE"',
        "printf 'captured simulator log\\n'",
      ].join('\n'),
      { mode: 0o755 },
    );

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
    writeFileSync(
      fakeXcrun,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$*" > "$XCRUN_CAPTURE"',
        "printf 'captured simulator log\\n'",
      ].join('\n'),
      { mode: 0o755 },
    );

    const result = spawnSync(
      'bash',
      [collectScript, join(directory, 'missing-e2e.log'), outputLog, identityPath],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: [binDirectory, process.env.PATH].join(':'),
          XCRUN_CAPTURE: argsPath,
        },
      },
    );

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

test('captures diagnostics for the dedicated Next Visit Questions Simulator', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-next-visit-diagnostics-'));
  const artifacts = join(directory, 'artifacts');
  const binDirectory = join(directory, 'bin');
  const fakeXcrun = join(binDirectory, 'xcrun');
  const testLog = join(artifacts, 'e2e-test.log');
  const outputLog = join(artifacts, 'simulator.log');
  const identityPath = join(artifacts, 'simulator.udid');
  const baselinePath = join(artifacts, 'simulator-baseline.json');
  const targetPath = join(artifacts, 'simulator-targets.txt');
  const callsPath = join(directory, 'xcrun-calls.log');
  const simulatorId = 'A5BC9CEB-DCB4-40BF-B43B-EFE5B1DBBD8F';
  const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-27-0';
  const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro';
  const inventory = JSON.stringify({
    devices: {
      [runtime]: [
        {
          udid: simulatorId,
          name: 'iPhone 18 Pro',
          deviceTypeIdentifier: deviceType,
          state: 'Booted',
        },
      ],
    },
  });

  try {
    mkdirSync(artifacts, { recursive: true });
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(identityPath, `${simulatorId}\n`);
    writeFileSync(baselinePath, `${inventory}\n`);
    writeFileSync(
      testLog,
      `next-visit-questions.e2e.js is assigned to ${simulatorId} (undefined)\n`,
    );
    writeFileSync(
      fakeXcrun,
      [
        '#!/usr/bin/env bash',
        'printf \'%s\\n\' "$*" >> "$XCRUN_CALLS"',
        'if [[ "$*" == "simctl list devices --json" ]]; then',
        `  printf '%s\\n' '${inventory}'`,
        'elif [[ "$1 $2" == "simctl spawn" ]]; then',
        '  printf "captured Simulator log for %s\\n" "$3"',
        'else',
        '  exit 97',
        'fi',
      ].join('\n'),
      { mode: 0o755 },
    );

    const result = spawnSync(
      'bash',
      [
        collectScript,
        testLog,
        outputLog,
        identityPath,
        'next-visit-questions',
        baselinePath,
        targetPath,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: [binDirectory, process.env.PATH].join(':'),
          XCRUN_CALLS: callsPath,
          EXPECTED_IOS_SIMULATOR_RUNTIME_IDENTIFIER: runtime,
          EXPECTED_DETOX_SIMULATOR_DEVICE_TYPE_ID: deviceType,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(targetPath, 'utf8'), `${simulatorId}\n`);
    assert.match(
      readFileSync(join(artifacts, 'simulator-inventory.log'), 'utf8'),
      /DETOX_SIMULATOR_INVENTORY profile=next-visit-questions workers=1 targets=1/,
    );
    assert.match(
      readFileSync(outputLog, 'utf8'),
      new RegExp(`captured Simulator log for ${simulatorId}`),
    );
    assert.deepEqual(readFileSync(callsPath, 'utf8').trim().split('\n'), [
      'simctl list devices --json',
      `simctl spawn ${simulatorId} log show --last 20m --style compact --predicate process == "Orot"`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
