import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installDetoxHostSamplerStubs } from './detox-host-sampling-stubs.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const runner = join(repositoryRoot, 'scripts/ci/run-detox-e2e.sh');
export const runnerSource = readFileSync(runner, 'utf8');

// Share the fake-host harness so routing tests can assert Detox arguments without starting a Simulator.
export function runRunner({
  profile = 'both',
  releaseStatus = '0',
  debugStatus = '0',
  transcriptionStatus = '0',
  nextVisitStatus = '0',
  ci = '',
  resourceLog = false,
  sustainedSampling = false,
  logLevel = 'info',
  focusedScenarioName = '',
  releaseShard = '',
  releaseSharding = 'false',
  simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
  openaiSimulatorId = simulatorId,
  transcriptionSimulatorId = simulatorId,
  nextVisitSimulatorId = simulatorId,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'orot-detox-runs-'));
  const fakePnpm = join(directory, 'pnpm');
  const callsPath = join(directory, 'calls.log');
  const samplerCallsPath = join(directory, 'sampler-calls.log');
  const artifactsPath = join(directory, 'artifacts');
  const resourceLogPath = join(directory, 'detox-resource-samples.log');
  writeFileSync(
    fakePnpm,
    [
      '#!/usr/bin/env bash',
      'printf \'profile=%s %s\\n\' "${OROT_DETOX_TEST_PROFILE:-}" "$*" >> "$DETOX_CALL_LOG"',
      "printf 'Test Suites: 1 passed, 1 total\\nTests: 1 passed, 1 total\\n'",
      ...(sustainedSampling
        ? [
            // End the fake workload at the observed sampling boundary, not a host-dependent wall time.
            'for ((tick=0; tick<1000; tick++)); do',
            '  samples=$(<"$OROT_DETOX_RESOURCE_LOG_PATH")',
            '  [[ "$samples" == *"phase=running sample=5 "* ]] && break',
            '  /bin/sleep 0.01',
            'done',
          ]
        : []),
      'if [[ "$*" == *"ios.sim.release.transcription"* ]]; then exit "$TRANSCRIPTION_STATUS"; fi',
      'if [[ "$*" == *"ios.sim.release"* ]]; then exit "$RELEASE_STATUS"; fi',
      'if [[ "$*" == *"ios.sim.debug.openai-provider"* ]]; then exit "$DEBUG_STATUS"; fi',
      'if [[ "$*" == *"ios.sim.debug.next-visit-questions"* ]]; then exit "$NEXT_VISIT_STATUS"; fi',
      'exit 97',
    ].join('\n'),
    { mode: 0o755 },
  );
  installDetoxHostSamplerStubs(directory);
  if (sustainedSampling) {
    // Advance the sampler's logical seconds without a minute-long wrapper test.
    writeFileSync(join(directory, 'sleep'), '#!/usr/bin/env bash\n/bin/sleep 0.01\n', {
      mode: 0o755,
    });
  }

  const args = profile === 'both' ? [] : [profile];
  const result = spawnSync('bash', [runner, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [directory, process.env.PATH].join(':'),
      DETOX_ARTIFACTS_LOCATION: artifactsPath,
      DETOX_CALL_LOG: callsPath,
      DETOX_SAMPLER_CALLS: samplerCallsPath,
      RELEASE_STATUS: releaseStatus,
      DEBUG_STATUS: debugStatus,
      TRANSCRIPTION_STATUS: transcriptionStatus,
      NEXT_VISIT_STATUS: nextVisitStatus,
      CI: ci,
      GITHUB_ACTIONS: 'false',
      OROT_DETOX_TEST_TIME_COMMAND: join(directory, 'time'),
      OROT_DETOX_RESOURCE_LOG_PATH: resourceLog ? resourceLogPath : '',
      OROT_DETOX_RESOURCE_SAMPLING: resourceLog ? 'true' : 'false',
      OROT_DETOX_TEST_LOG_LEVEL: logLevel,
      OROT_DETOX_FOCUSED_SCENARIO_NAME: focusedScenarioName,
      OROT_DETOX_RELEASE_SHARD: releaseShard,
      OROT_DETOX_RELEASE_SHARDING: releaseSharding,
      OROT_DETOX_SIMULATOR_UDID: simulatorId,
      OROT_OPENAI_PROVIDER_SIMULATOR_UDID: openaiSimulatorId,
      OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID: transcriptionSimulatorId,
      OROT_NEXT_VISIT_QUESTIONS_SIMULATOR_UDID: nextVisitSimulatorId,
    },
  });
  const calls = existsSync(callsPath)
    ? readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean)
    : [];
  const resourceSamples = existsSync(resourceLogPath) ? readFileSync(resourceLogPath, 'utf8') : '';
  const samplerCalls = existsSync(samplerCallsPath) ? readFileSync(samplerCallsPath, 'utf8') : '';
  rmSync(directory, { recursive: true, force: true });
  return { result, calls, artifactsPath, resourceSamples, samplerCalls };
}
