#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getVisitQuestionProviderConfig } = require('./provider-config.cjs');
const { disableAmbientTracing } = require('./privacy');

// Reuse the repository's TS runtime without adding a dependency or native test runner.
const root = path.resolve(__dirname, '../../..');
try {
  getVisitQuestionProviderConfig(process.env);
  if (!process.env.OROT_COMPARISON_OUTPUT)
    throw new Error('Set OROT_COMPARISON_OUTPUT to a JSON output path.');
  if (process.env.OROT_VISIT_QUESTION_SOURCE_ROOT)
    throw new Error(
      'Comparison requires one integrated checkout; unset OROT_VISIT_QUESTION_SOURCE_ROOT.',
    );
  if (process.env.OROT_LANGSMITH_EVAL === '1')
    throw new Error(
      'Comparison does not upload LangSmith experiments. Use the separate graph evaluator.',
    );
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@orot/mobile',
      'exec',
      'jest',
      '--config',
      path.join(root, 'packages/eval/jest.config.js'),
      '--runInBand',
      '--runTestsByPath',
      path.join(root, 'packages/eval/__tests__/workflowComparison.test.ts'),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: disableAmbientTracing({ ...process.env, OROT_RUN_WORKFLOW_COMPARISON: '1' }),
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
