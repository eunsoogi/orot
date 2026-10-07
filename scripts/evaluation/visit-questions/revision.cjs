'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const WORKFLOW_SOURCE = 'apps/mobile/src/agent/visitQuestions/workflow.ts';

/** Keeps the evaluated graph revision separate from its dependency toolchain. */
function getEvaluationRevisionMetadata(repositoryRoot) {
  const gitRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const workingTreeClean =
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim().length === 0;
  const lockfile = readFileSync(path.join(repositoryRoot, 'pnpm-lock.yaml'));

  return {
    evaluationTarget: {
      name: 'runVisitQuestionWorkflow',
      sourcePath: WORKFLOW_SOURCE,
      gitRevision,
      workingTreeClean,
    },
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
    toolchainLockfileSha256: revisions.toolchain.lockfileSha256,
    toolchainNodeVersion: revisions.toolchain.nodeVersion,
  };
}

module.exports = { getEvaluationRevisionMetadata, toLangSmithRevisionMetadata };
