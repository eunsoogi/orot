import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../../..');

describe('manual evaluation runner timeout', () => {
  it('passes an extended Jest timeout without starting the graph or external services', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'orot-eval-runner-'));
    try {
      const sourceRoot = path.join(sandbox, 'source');
      const workflowPath = path.join(
        sourceRoot,
        'apps/mobile/src/agent/visitQuestions/workflow.ts',
      );
      fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
      fs.writeFileSync(workflowPath, '// synthetic path for runner preflight');

      const bin = path.join(sandbox, 'bin');
      const capturePath = path.join(sandbox, 'jest-arguments.txt');
      const fakePnpm = path.join(bin, 'pnpm');
      fs.mkdirSync(bin);
      fs.writeFileSync(
        fakePnpm,
        '#!/bin/sh\nprintf "%s\\n" "$@" > "$OROT_TEST_CAPTURE_ARGS_FILE"\n',
      );
      fs.chmodSync(fakePnpm, 0o755);

      const runner = spawnSync(
        process.execPath,
        [path.join(repositoryRoot, 'scripts/evaluation/visit-questions/run.cjs')],
        {
          cwd: repositoryRoot,
          env: {
            PATH: [bin, process.env.PATH ?? ''].join(path.delimiter),
            OROT_LANGSMITH_EVAL: '0',
            OROT_TEST_CAPTURE_ARGS_FILE: capturePath,
            OROT_VISIT_QUESTION_PROVIDER: 'scripted',
            OROT_VISIT_QUESTION_SOURCE_ROOT: sourceRoot,
          },
          encoding: 'utf8',
        },
      );

      expect(runner.error).toBeUndefined();
      expect(runner.status).toBe(0);
      expect(fs.readFileSync(capturePath, 'utf8').split(/\r?\n/)).toContain('--testTimeout=360000');
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
