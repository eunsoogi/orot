#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  disableAmbientTracing,
  getLangSmithApiKey,
  isLangSmithUploadEnabled,
} = require('./privacy');

const repositoryRoot = path.resolve(__dirname, '../../..');
const workflowSource = path.join(
  repositoryRoot,
  'apps/mobile/src/agent/visitQuestions/workflow.ts',
);

// Fail before invoking Jest when the issue #30 graph is not part of this checkout.
if (!require('node:fs').existsSync(workflowSource)) {
  process.stderr.write(
    'The actual issue #30 visit-question workflow is not in this checkout. Integrate that workflow before running this evaluation.\n',
  );
  process.exitCode = 2;
} else {
  try {
    if (isLangSmithUploadEnabled(process.env)) getLangSmithApiKey(process.env);
    const childEnvironment = disableAmbientTracing({
      ...process.env,
      OROT_RUN_VISIT_QUESTION_EVAL: '1',
    });
    const integrationTest = path.join(
      repositoryRoot,
      'packages/eval/__tests__/visitQuestionWorkflow.integration.test.ts',
    );
    const jestConfig = path.join(repositoryRoot, 'packages/eval/jest.config.js');
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        '@orot/mobile',
        'exec',
        'jest',
        '--config',
        jestConfig,
        '--runInBand',
        '--runTestsByPath',
        integrationTest,
      ],
      {
        cwd: repositoryRoot,
        env: childEnvironment,
        stdio: 'inherit',
      },
    );
    if (result.error) {
      process.stderr.write(`Could not start the evaluation runner: ${result.error.message}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
