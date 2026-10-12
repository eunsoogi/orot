import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { runRunner, runnerSource } from './run-detox-e2e-test-support.mjs';

test('runs Release and OpenAI Debug under separate artifact paths', () => {
  const { result, calls, artifactsPath } = runRunner();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^profile=release /);
  assert.match(calls[1], /^profile=openai-provider /);
  assert.match(calls[0], /ios\.sim\.release/);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], new RegExp(`${artifactsPath}/release`));
  assert.match(
    calls[1],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[1], /ios\.sim\.debug\.openai-provider/);
  assert.match(calls[1], new RegExp(`${artifactsPath}/openai-provider`));
});

test('runs only the selected Release profile on its dedicated Simulator', () => {
  const simulatorId = 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'release',
    simulatorId,
    openaiSimulatorId: '',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=release /);
  assert.match(calls[0], /ios\.sim\.release/);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], new RegExp(`${artifactsPath}/release`));
});

test('runs only the Debug-only OpenAI probe on its dedicated Simulator', () => {
  const simulatorId = '';
  const openaiSimulatorId = '11111111-2222-4333-8444-555555555555';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'openai-provider',
    simulatorId,
    openaiSimulatorId,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=openai-provider /);
  assert.match(
    calls[0],
    /--config-path \.\.\/\.\.\/scripts\/ci\/detox-e2e-profile\.detox\.config\.cjs/,
  );
  assert.match(calls[0], /ios\.sim\.debug\.openai-provider/);
  assert.match(calls[0], new RegExp(`${artifactsPath}/openai-provider`));
});

test('runs only the transcription probe with its separately prepared Simulator', () => {
  const simulatorId = '';
  const transcriptionSimulatorId = '22222222-3333-4444-8555-666666666666';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'transcription',
    simulatorId,
    openaiSimulatorId: '',
    transcriptionSimulatorId,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=transcription /);
  assert.match(calls[0], /ios\.sim\.release\.transcription/);
  assert.match(calls[0], new RegExp(`${artifactsPath}/transcription`));
});

test('fails closed when the transcription profile lacks its dedicated Simulator', () => {
  const { result, calls } = runRunner({
    profile: 'transcription',
    simulatorId: '',
    openaiSimulatorId: '',
    transcriptionSimulatorId: '',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated speech transcription Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('runs only the Next Visit Questions probe on its dedicated Simulator', () => {
  const simulatorId = 'F1E2D3C4-B5A6-4789-ABCD-0123456789AB';
  const { result, calls, artifactsPath } = runRunner({
    profile: 'next-visit-questions',
    openaiSimulatorId: '',
    transcriptionSimulatorId: '',
    nextVisitSimulatorId: simulatorId,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^profile=next-visit-questions /);
  assert.match(calls[0], /ios\.sim\.debug\.next-visit-questions/);
  assert.ok(calls[0].includes(join(artifactsPath, 'next-visit-questions')));
  assert.ok(result.stdout.includes('simulator=' + simulatorId));
});

test('fails closed when Next Visit Questions lacks its dedicated Simulator', () => {
  const { result, calls } = runRunner({
    profile: 'next-visit-questions',
    openaiSimulatorId: '',
    transcriptionSimulatorId: '',
    nextVisitSimulatorId: '',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated Next Visit Questions Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('can record bounded process and memory samples when explicitly enabled', () => {
  const { result, calls, resourceSamples, samplerCalls } = runRunner({
    profile: 'release',
    resourceLog: true,
    logLevel: 'info',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(calls[0], /--loglevel info/);
  assert.match(result.stderr, /real/);
  assert.match(resourceSamples, /DETOX_RESOURCE_SAMPLE profile=release phase=before/);
  assert.match(resourceSamples, /DETOX_RESOURCE_SAMPLE profile=release phase=after/);
  assert.match(resourceSamples, /Pages free:/);
  assert.match(resourceSamples, /Pageins:/);
  assert.match(resourceSamples, /Pageouts:/);
  assert.match(runnerSource, /resource_sample_limit=180/);
  assert.match(runnerSource, /sample_index < resource_sample_limit/);
  assert.match(resourceSamples, /DETOX_TOP_SAMPLE cpu_is_delta_between_two_samples/);
  assert.match(resourceSamples, /CPU usage:/);
  assert.match(resourceSamples, /vm\.swapusage/);
  for (const command of ['ps', 'top', 'vm_stat', 'sysctl', 'uname']) {
    assert.match(samplerCalls, new RegExp(`^${command}(?: |$)`, 'm'));
  }
});

test('keeps sampling after the first minute so late Speech work remains observable', () => {
  const { result, resourceSamples } = runRunner({
    profile: 'transcription',
    resourceLog: true,
    sustainedSampling: true,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const running = [...resourceSamples.matchAll(/phase=running sample=(\d+)/g)];
  assert.ok(running.length > 4, resourceSamples);
  assert.match(resourceSamples, /profile=transcription phase=running sample=5/);
  assert.match(resourceSamples, /profile=transcription phase=after/);
});

test('still runs Debug after a Release failure and fails if either invocation fails', () => {
  for (const statuses of [
    { releaseStatus: '1', debugStatus: '0' },
    { releaseStatus: '0', debugStatus: '2' },
  ]) {
    const { result, calls } = runRunner(statuses);
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 2);
  }
});

test('fails closed when no dedicated Simulator was prepared', () => {
  const { result, calls } = runRunner({ simulatorId: '', openaiSimulatorId: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated Release Detox Simulator UDID/);
  assert.deepEqual(calls, []);
});

test('fails closed in CI when the app configurations disagree on Simulator identity', () => {
  const { result, calls } = runRunner({
    ci: 'true',
    simulatorId: 'A1B2C3D4-E5F6-47A8-9012-3456789ABCDE',
    openaiSimulatorId: '11111111-2222-4333-8444-555555555555',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must use the same dedicated Simulator/);
  assert.deepEqual(calls, []);
});
