'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const WORKFLOW_SOURCE = 'apps/mobile/src/agent/visitQuestions/workflow.ts';

function gitState(repositoryRoot) {
  const gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const workingTreeClean =
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim().length === 0;
  return { gitRevision, workingTreeClean };
}

/** Keeps the evaluated graph revision separate from the evaluator and dependency toolchain. */
function getEvaluationRevisionMetadata(repositoryRoot, workflowSourceRoot = repositoryRoot) {
  const evaluationTarget = gitState(workflowSourceRoot);
  const evaluationHarness = gitState(repositoryRoot);
  const lockfile = readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'));

  return {
    evaluationTarget: {
      name: 'runVisitQuestionWorkflow',
      sourcePath: WORKFLOW_SOURCE,
      ...evaluationTarget,
    },
    evaluationHarness,
    toolchain: {
      lockfileSha256: createHash('sha256').update(lockfile).digest('hex'),
      nodeVersion: process.version,
    },
  };
}

/** Limits LangSmith metadata to revision and toolchain facts, without fixture content. */
function toLangSmithRevisionMetadata(revisions) {
  return {
    evaluationTargetCommit: revisions.evaluationTarget.gitRevision,
    evaluationTargetPath: revisions.evaluationTarget.sourcePath,
    evaluationTargetWorkingTreeClean: revisions.evaluationTarget.workingTreeClean,
    evaluationHarnessCommit: revisions.evaluationHarness.gitRevision,
    evaluationHarnessWorkingTreeClean: revisions.evaluationHarness.workingTreeClean,
    toolchainLockfileSha256: revisions.toolchain.lockfileSha256,
    toolchainNodeVersion: revisions.toolchain.nodeVersion,
  };
}

module.exports = { getEvaluationRevisionMetadata, toLangSmithRevisionMetadata };
