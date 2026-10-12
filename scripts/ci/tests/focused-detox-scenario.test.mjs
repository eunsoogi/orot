import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFocusedDetoxArguments,
  resolveFocusedDetoxScenario,
} from '../focused-detox-scenario.mjs';

test('focus accepts only the scenario file assigned to the selected profile', () => {
  assert.deepEqual(
    resolveFocusedDetoxScenario('release', 'release-e2e-data.test.js', 'appointment'),
    {
      file: 'release-e2e-data.test.js',
      relativePath: 'e2e/release-e2e-data.test.js',
      testNamePattern: 'appointment',
    },
  );
  assert.deepEqual(resolveFocusedDetoxScenario('transcription', '', 'exports transcript'), {
    file: 'transcription.e2e.js',
    relativePath: 'e2e/transcription.e2e.js',
    testNamePattern: 'exports transcript',
  });
  assert.throws(
    () => resolveFocusedDetoxScenario('transcription', 'release-e2e-data.test.js', 'appointment'),
    /not supported for profile/,
  );
  assert.throws(
    () => resolveFocusedDetoxScenario('release', '', 'appointment'),
    /not supported for profile/,
  );
});

test('focus treats the supplied test title as a literal and reports one file', () => {
  const title = 'launches [the app] with (sample) data';
  const focused = resolveFocusedDetoxScenario('openai-provider', '', title);
  assert.equal(focused.file, 'openai-provider.e2e.js');
  assert.equal(focused.relativePath, 'e2e/openai-provider.e2e.js');
  assert.equal(focused.testNamePattern, 'launches \\[the app\\] with \\(sample\\) data');

  const args = buildFocusedDetoxArguments('openai-provider', '', title);
  assert.deepEqual(args.slice(-4), [
    '--runTestsByPath',
    'e2e/openai-provider.e2e.js',
    '--testNamePattern',
    focused.testNamePattern,
  ]);
});

test('focus rejects empty, oversized, or multiline test selectors', () => {
  assert.throws(() => resolveFocusedDetoxScenario('openai-provider', '', ''), /required/);
  assert.throws(
    () => resolveFocusedDetoxScenario('openai-provider', '', 'title\nother'),
    /control/,
  );
  assert.throws(() => resolveFocusedDetoxScenario('openai-provider', '', 'x'.repeat(501)), /500/);
});
