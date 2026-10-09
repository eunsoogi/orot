#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  disableAmbientTracing,
  getLangSmithApiKey,
  isLangSmithUploadEnabled,
} = require('./privacy');
const { getVisitQuestionProviderConfig } = require('./provider-config.cjs');
const { buildJestArguments } = require('./runner-arguments.cjs');
const { getWorkflowSourceRoot } = require('./source-root.cjs');

const repositoryRoot = path.resolve(__dirname, '../../..');
const workflowSource = path.join(
  getWorkflowSourceRoot(repositoryRoot),
  'apps/mobile/src/agent/visitQuestions/workflow.ts',
);

// Fail before invoking Jest when the configured issue #30 source checkout is incomplete.
if (!require('node:fs').existsSync(workflowSource)) {
  process.stderr.write(
    `The actual issue #30 visit-question workflow was not found at ${workflowSource}. Set OROT_VISIT_QUESTION_SOURCE_ROOT to a checkout containing that file.\n`,
  );
  process.exitCode = 2;
} else {
  try {
    // Validate both remote opt-ins before Jest loads the workflow or can start a provider call.
    getVisitQuestionProviderConfig(process.env);
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
        ...buildJestArguments({ jestConfig, integrationTest }),
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
