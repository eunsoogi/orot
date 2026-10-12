import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep focused runs on the profile-owned Jest file and pass test titles as literal arguments.
const profileFiles = {
  release: ['release-e2e.test.js', 'release-e2e-data.test.js'],
  'openai-provider': ['openai-provider.e2e.js'],
  transcription: ['transcription.e2e.js'],
  'next-visit-questions': ['next-visit-questions.e2e.js'],
};

function escapeRegexFragment(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveFocusedDetoxScenario(profile, file, testName) {
  const allowedFiles = profileFiles[profile];
  if (!allowedFiles) throw new Error(`Unsupported focused Detox profile: ${profile}`);
  const selectedFile = file || (profile === 'release' ? '' : allowedFiles[0]);
  if (!allowedFiles.includes(selectedFile)) {
    throw new Error(`${selectedFile || 'A scenario file'} is not supported for profile ${profile}`);
  }
  if (typeof testName !== 'string' || testName.trim() !== testName || testName.length === 0) {
    throw new Error('A non-empty focused Detox test name is required');
  }
  if (testName.length > 500) {
    throw new Error('Focused Detox test name must be 500 characters or fewer');
  }
  if (/\p{Cc}/u.test(testName)) {
    throw new Error('Focused Detox test name cannot contain control characters');
  }
  return {
    file: selectedFile,
    relativePath: `e2e/${selectedFile}`,
    testNamePattern: escapeRegexFragment(testName),
  };
}

export function buildFocusedDetoxArguments(profile, file, testName) {
  const { relativePath, testNamePattern } = resolveFocusedDetoxScenario(profile, file, testName);
  return ['--runTestsByPath', relativePath, '--testNamePattern', testNamePattern];
}

function validateFromWorkflow(profile, file, testName) {
  const scenario = resolveFocusedDetoxScenario(profile, file, testName);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `scenario_file=${scenario.file}\ntest_name_pattern=${scenario.testNamePattern}\n`,
    );
  }
  process.stdout.write(`Focused Detox selection: ${profile}/${scenario.file}\n`);
}

function runFocusedDetox(profile, file, testName, forwardedArgs) {
  const separator = forwardedArgs.indexOf('--');
  if (separator < 0) throw new Error('Focused Detox runner requires a -- argument separator');
  const focusOptions = buildFocusedDetoxArguments(profile, file, testName);
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@orot/mobile',
      'exec',
      '--',
      'detox',
      'test',
      '--config-path',
      '../../scripts/ci/detox-e2e-profile.detox.config.cjs',
      ...forwardedArgs.slice(separator + 1),
      ...focusOptions,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

// The summary guard imports the allowlist and argument builder without invoking the CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, profile, file, testName, ...forwardedArgs] = process.argv.slice(2);
  try {
    if (mode === 'validate') validateFromWorkflow(profile, file, testName);
    else if (mode === 'run') runFocusedDetox(profile, file, testName, forwardedArgs);
    else
      throw new Error(
        'Usage: focused-detox-scenario.mjs <validate|run> <profile> <file> <test-name>',
      );
  } catch (error) {
    process.stderr.write(`Focused Detox scenario rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
