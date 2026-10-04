import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  DATA_VOLUME,
  ROOT_VOLUME,
  isGitHubHostedMacOS,
  parseMdutilStatus,
  runSpotlightExperiment,
  verifyRunnerVolumeTopology,
} from '../detox-spotlight-experiment.mjs';
import { isDirectExecution } from '../run-detox-spotlight-experiment.mjs';

const runnerPath = fileURLToPath(new URL('../run-detox-spotlight-experiment.mjs', import.meta.url));

const mdutilOutput = (volume, status) => `${volume}:\n\t${status}\n`;

test('recognizes direct Node execution when the script path is relative', () => {
  const relativeRunnerPath = relative(process.cwd(), runnerPath);

  assert.equal(isDirectExecution(pathToFileURL(runnerPath).href, relativeRunnerPath), true);
  assert.equal(isDirectExecution(pathToFileURL(runnerPath).href, `${relativeRunnerPath}.other`), false);
});

test('parses a combined multiline CRLF status by exact volume block', () => {
  const output = '/:\r\n\tIndex is read-only.\r\n/System/Volumes/Data:\r\n\tIndexing enabled.\r\n';

  assert.equal(parseMdutilStatus(ROOT_VOLUME, output), 'read-only');
  assert.equal(parseMdutilStatus(DATA_VOLUME, output), 'enabled');
});

test('parses the supported single-line and multiline status forms', () => {
  assert.equal(parseMdutilStatus(DATA_VOLUME, `${DATA_VOLUME}: Indexing disabled.\n`), 'disabled');
  assert.equal(parseMdutilStatus(DATA_VOLUME, mdutilOutput(DATA_VOLUME, 'Indexing enabled.')), 'enabled');
  assert.equal(parseMdutilStatus(DATA_VOLUME, mdutilOutput(DATA_VOLUME, 'Index is read-only.')), 'read-only');
});

test('returns unknown for a different volume, missing status, duplicate block, or conflicting statuses', () => {
  assert.equal(parseMdutilStatus(DATA_VOLUME, '/Volumes/Other:\n\tIndexing disabled.\n'), 'unknown');
  assert.equal(parseMdutilStatus(DATA_VOLUME, `${DATA_VOLUME}:\n\tSpotlight unavailable.\n`), 'unknown');
  assert.equal(parseMdutilStatus(DATA_VOLUME, `Error: metadata service unavailable\n${mdutilOutput(DATA_VOLUME, 'Indexing enabled.')}`), 'unknown');
  assert.equal(parseMdutilStatus(DATA_VOLUME, `${mdutilOutput(DATA_VOLUME, 'Indexing enabled.')}${mdutilOutput(DATA_VOLUME, 'Indexing enabled.')}`), 'unknown');
  assert.equal(parseMdutilStatus(DATA_VOLUME, `${mdutilOutput(DATA_VOLUME, 'Indexing enabled.')}${'\tIndexing disabled.\n'}`), 'unknown');
});

test('only enabled Data status runs one fixed Data-volume suppression and verifies disabled', () => {
  const mdutilResponses = [
    { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing disabled.') },
  ];
  const mdutilCalls = [];
  const sudoCalls = [];
  const evidence = [];
  const result = runSpotlightExperiment({
    runMdutil(volume) {
      mdutilCalls.push(volume);
      return mdutilResponses.shift();
    },
    runSudo(args) {
      sudoCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    },
    onEvidence: (entry) => evidence.push(entry),
  });

  assert.deepEqual(mdutilCalls, [[ROOT_VOLUME], [DATA_VOLUME], [DATA_VOLUME]]);
  assert.deepEqual(sudoCalls, [['-n', '/usr/bin/mdutil', '-i', 'off', DATA_VOLUME]]);
  assert.equal(result.rootStatus, 'read-only');
  assert.equal(result.dataStatus, 'enabled');
  assert.equal(result.outcome, 'disabled-and-verified');
  assert.equal(result.attempted, true);
  assert.equal(result.verified, true);
  const rawIndex = evidence.findIndex((entry) => entry.type === 'raw' && entry.name === 'data-before');
  const parsedIndex = evidence.findIndex((entry) => entry.type === 'state' && entry.name === 'data-before');
  const actionIndex = evidence.findIndex((entry) => entry.type === 'action');
  assert.ok(rawIndex >= 0 && rawIndex < parsedIndex && parsedIndex < actionIndex);
});

test('already-disabled Data is recorded without running a privileged command', () => {
  const sudoCalls = [];
  const mdutilResponses = [
    { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing disabled.') },
  ];
  const result = runSpotlightExperiment({
    runMdutil: () => mdutilResponses.shift(),
    runSudo: (args) => sudoCalls.push(args),
  });

  assert.equal(result.outcome, 'already-disabled');
  assert.equal(result.attempted, false);
  assert.equal(result.verified, false);
  assert.deepEqual(sudoCalls, []);
});

test('read-only, unknown, and failed Data observations are unavailable and never mutate', () => {
  const cases = [
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Index is read-only.') },
    { status: 0, stdout: `${DATA_VOLUME}:\n\tUnexpected Spotlight response.\n` },
    { status: 7, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.'), stderr: 'mdutil denied the query' },
  ];

  for (const dataResponse of cases) {
    const mdutilResponses = [
      { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
      dataResponse,
    ];
    const sudoCalls = [];
    const result = runSpotlightExperiment({
      runMdutil: () => mdutilResponses.shift(),
      runSudo: (args) => sudoCalls.push(args),
    });

    assert.equal(result.outcome, 'unavailable');
    assert.equal(result.attempted, false);
    assert.deepEqual(sudoCalls, []);
  }
});

test('a root query error is only observed and does not block enabled Data verification', () => {
  const mdutilResponses = [
    { status: 1, stdout: '/: error\n', stderr: 'root observation failed' },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing disabled.') },
  ];
  const sudoCalls = [];
  const result = runSpotlightExperiment({
    runMdutil: () => mdutilResponses.shift(),
    runSudo: (args) => {
      sudoCalls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.rootStatus, 'command-failure');
  assert.equal(result.outcome, 'disabled-and-verified');
  assert.equal(result.verified, true);
  assert.equal(sudoCalls.length, 1);
});

test('records an attempted suppression and failed readback without hiding the action failure', () => {
  const mdutilResponses = [
    { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.') },
    { status: 0, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.') },
  ];
  const result = runSpotlightExperiment({
    runMdutil: () => mdutilResponses.shift(),
    runSudo: () => ({ status: 1, stdout: '', stderr: 'permission denied' }),
  });

  assert.equal(result.outcome, 'attempted-unverified');
  assert.equal(result.attempted, true);
  assert.equal(result.verified, false);
  assert.equal(result.dataAfter.status, 'enabled');
  assert.equal(result.suppression.exitCode, 1);
});

test('a nonzero status query cannot trigger suppression even when its output says enabled', () => {
  const mdutilResponses = [
    { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
    { status: 1, stdout: mdutilOutput(DATA_VOLUME, 'Indexing enabled.'), stderr: 'query failed' },
  ];
  const sudoCalls = [];
  const result = runSpotlightExperiment({
    runMdutil: () => mdutilResponses.shift(),
    runSudo: (args) => sudoCalls.push(args),
  });

  assert.equal(result.dataStatus, 'command-failure');
  assert.equal(result.outcome, 'unavailable');
  assert.deepEqual(sudoCalls, []);
});

test('a successful query with a global error before an enabled block cannot trigger suppression', () => {
  const mdutilResponses = [
    { status: 0, stdout: mdutilOutput(ROOT_VOLUME, 'Index is read-only.') },
    { status: 0, stdout: `Error: metadata service unavailable\n${mdutilOutput(DATA_VOLUME, 'Indexing enabled.')}` },
  ];
  const sudoCalls = [];
  const result = runSpotlightExperiment({
    runMdutil: () => mdutilResponses.shift(),
    runSudo: (args) => sudoCalls.push(args),
  });

  assert.equal(result.dataStatus, 'unknown');
  assert.equal(result.outcome, 'unavailable');
  assert.deepEqual(sudoCalls, []);
});

test('only the GitHub-hosted macOS CI environment may inspect the runner volume topology', () => {
  const supported = {
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'macOS',
    RUNNER_ENVIRONMENT: 'github-hosted',
    CI: 'true',
  };

  assert.equal(isGitHubHostedMacOS(supported), true);
  assert.equal(isGitHubHostedMacOS({ ...supported, RUNNER_ENVIRONMENT: 'self-hosted' }), false);
  assert.equal(isGitHubHostedMacOS({ ...supported, RUNNER_OS: 'Linux' }), false);
});

test('requires resolved workspace and CoreSimulator directories on the verified Data volume', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS', RUNNER_ENVIRONMENT: 'github-hosted', CI: 'true' };
  const paths = { data: '/System/Volumes/Data', workspace: '/Volumes/Data/runner/work', simulatorData: '/Volumes/Data/runner/CoreSimulator' };
  const mountPoints = { data: DATA_VOLUME, workspace: DATA_VOLUME, simulatorData: DATA_VOLUME };

  assert.deepEqual(verifyRunnerVolumeTopology({
    env,
    paths,
    mountPoints,
    devices: { data: 42, workspace: 42, simulatorData: 42 },
  }), { available: true, reason: 'verified-data-volume' });
  assert.deepEqual(verifyRunnerVolumeTopology({
    env,
    paths,
    mountPoints: { ...mountPoints, workspace: '/' },
    devices: { data: 42, workspace: 42, simulatorData: 42 },
  }), { available: false, reason: 'mount-point-mismatch' });
  assert.deepEqual(verifyRunnerVolumeTopology({
    env,
    paths: { ...paths, data: '/' },
    mountPoints,
    devices: { data: 42, workspace: 42, simulatorData: 42 },
  }), { available: false, reason: 'data-volume-path-not-exact' });
  assert.deepEqual(verifyRunnerVolumeTopology({
    env,
    paths,
    mountPoints,
    devices: { data: 42, workspace: 43, simulatorData: 42 },
  }), { available: false, reason: 'workspace-or-simulator-data-on-different-volume' });
  assert.deepEqual(verifyRunnerVolumeTopology({
    env,
    paths: { ...paths, simulatorData: '' },
    devices: { data: 42, workspace: 42, simulatorData: 42 },
    mountPoints,
  }), {
    available: false,
    reason: 'required-path-missing',
  });
  assert.deepEqual(verifyRunnerVolumeTopology({ env, paths, devices: { data: 42, workspace: 42, simulatorData: 42 } }), {
    available: false,
    reason: 'mount-point-unavailable',
  });
});
