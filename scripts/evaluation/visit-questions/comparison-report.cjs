'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { getEvaluationRevisionMetadata } = require('./revision.cjs');

/** An explicit ancestor identifies the dependency; caller must bind it to the merged RAG PR. */
function integrationEvidence(root, revision) {
  if (!revision)
    return { status: 'unverified', reason: 'No integrated RAG revision was supplied.' };
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error('Integrated RAG revision must be a full commit SHA.');
  execFileSync('git', ['merge-base', '--is-ancestor', revision, 'HEAD'], { cwd: root });
  return {
    status: 'ancestor-verified',
    revision,
    caveat: 'Bind this SHA to the authenticated merged RAG PR.',
  };
}

function buildComparisonReport(root, fixture, config, cases, integratedRevision) {
  const revisions = getEvaluationRevisionMetadata(root);
  const integration = integrationEvidence(root, integratedRevision);
  const successful = cases.every((item) =>
    item.paths.every((row) => row.executionStatus === 'completed'),
  );
  return {
    schemaVersion: 'orot.workflow-comparison.v1',
    executionStatus: successful ? 'completed' : 'partial',
    evidenceClass:
      config.mode === 'test-adapter' ? 'protocol-fixture-only' : 'synthetic-provider-measurement',
    finalComparisonEligible:
      config.mode === 'openai-api' &&
      successful &&
      integration.status === 'ancestor-verified' &&
      revisions.evaluationHarness.workingTreeClean,
    fixtureSeed: 'orot-visit-questions-eval-v1',
    fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    provider: { mode: config.mode, model: config.model },
    integration,
    ...revisions,
    protocol: {
      paths: ['full-context', 'simple-rag', 'langgraph'],
      order: 'fixed; single sample per case/path; no statistical significance claim',
      simpleRetrievalLimitPerSource: 8,
      latencyScope:
        'retrieval, generation, graph validation and store cleanup; excludes common fixture/corpus preparation',
      monetaryCost: { status: 'unmeasured', reason: 'No versioned provider pricing supplied.' },
      langSmith: { status: 'not-uploaded' },
    },
    cases,
  };
}

module.exports = { buildComparisonReport, integrationEvidence };
